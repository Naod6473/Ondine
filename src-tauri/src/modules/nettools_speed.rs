// Module « Réseau » : le test de débit Internet (1.2.3), SEULEMENT au clic.
//
// Le serveur : les points de mesure publics de Cloudflare, ceux de
// https://speed.cloudflare.com (le même service que leur page de test,
// documenté dans leur projet libre « speedtest ») :
//   - GET  https://speed.cloudflare.com/__down?bytes=N  renvoie N octets ;
//   - POST https://speed.cloudflare.com/__up            reçoit ce qu'on envoie.
// Cloudflare a des points de présence presque partout : la mesure se fait
// vers le plus proche, sans compte ni clé. Il voit votre adresse IP (comme
// n'importe quel site), rien d'autre : les octets envoyés sont des zéros.
//
// Trois temps, environ 20 secondes en tout :
//   1. latence : 5 petites requêtes, on garde la médiane ;
//   2. réception : 4 flux en parallèle pendant 8 s (250 Mo au plus) ;
//   3. envoi : 2 flux pendant 6 s (60 Mo au plus).
// Pendant le test, « nettools.speed » part sur le bus 4 fois par seconde :
// { phase: "ping" | "down" | "up", mbps, progress (0 à 1, tout le test), ping }
// puis { phase: "done", down, up, ping, server } (ou "error", "stopped").
// Le front s'en sert pour le liseré de l'île, qui tourne d'autant plus vite
// que le débit est élevé. « Arrêter » coupe tout de suite (commande speed_stop).

use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::services::log;

pub const SERVER: &str = "speed.cloudflare.com";
const BASE: &str = "https://speed.cloudflare.com";
const PINGS: usize = 5;
const DOWN_STREAMS: usize = 4;
const DOWN_FOR: Duration = Duration::from_secs(8);
const DOWN_MAX: u64 = 250 * 1024 * 1024;
/// La taille de chaque demande de téléchargement (un flux en enchaîne plusieurs).
const DOWN_CHUNK: u64 = 25 * 1024 * 1024;
const UP_STREAMS: usize = 2;
const UP_FOR: Duration = Duration::from_secs(6);
const UP_MAX: u64 = 60 * 1024 * 1024;
const UP_CHUNK: u64 = 8 * 1024 * 1024;
const REPORT_EVERY: Duration = Duration::from_millis(250);

/// Un test à la fois ; « Arrêter » met `stop`.
#[derive(Default)]
pub struct SpeedTest {
    running: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
}

/// Mégabits par seconde pour `bytes` en `secs` secondes.
pub fn mbps(bytes: u64, secs: f64) -> f64 {
    if secs <= 0.0 {
        return 0.0;
    }
    (bytes as f64 * 8.0) / secs / 1_000_000.0
}

/// La médiane (les temps de réponse : un seul raté ne fausse pas la latence).
pub fn median(values: &mut [f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(|a, b| a.total_cmp(b));
    let n = values.len();
    Some(if n % 2 == 1 { values[n / 2] } else { (values[n / 2 - 1] + values[n / 2]) / 2.0 })
}

/// L'avancement de tout le test (0 à 1) : latence 10 %, réception 50 %, envoi 40 %.
pub fn overall(phase: &str, frac: f64) -> f64 {
    let f = frac.clamp(0.0, 1.0);
    match phase {
        "ping" => 0.1 * f,
        "down" => 0.1 + 0.5 * f,
        "up" => 0.6 + 0.4 * f,
        _ => 1.0,
    }
}

fn agent() -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    ureq::Agent::config_builder()
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
        .timeout_global(Some(Duration::from_secs(30)))
        .https_only(true)
        .max_redirects(0)
        .build()
        .into()
}

impl SpeedTest {
    /// Lance le test dans un fil ; Err s'il tourne déjà. `emit` publie chaque
    /// nouvelle sur le bus (« nettools.speed »).
    pub fn start(&self, app: &AppHandle, emit: impl Fn(&AppHandle, Value) + Send + 'static) -> Result<(), String> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err("un test de débit est déjà en cours".into());
        }
        self.stop.store(false, Ordering::SeqCst);
        let (app, stop, running) = (app.clone(), self.stop.clone(), self.running.clone());
        std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&app, &stop, &emit)));
            let payload = match result {
                Ok(Ok(v)) => v,
                Ok(Err(_)) if stop.load(Ordering::SeqCst) => json!({ "phase": "stopped" }),
                Ok(Err(e)) => {
                    log::info("réseau : test de débit interrompu");
                    json!({ "phase": "error", "error": e })
                }
                Err(_) => json!({ "phase": "error", "error": "erreur interne" }),
            };
            running.store(false, Ordering::SeqCst);
            emit(&app, payload);
        });
        Ok(())
    }

    pub fn busy(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Le test complet ; Err si Internet ne répond pas (ou « Arrêter »).
fn run(app: &AppHandle, stop: &Arc<AtomicBool>, emit: &dyn Fn(&AppHandle, Value)) -> Result<Value, String> {
    let agent = agent();
    let stopped = || stop.load(Ordering::SeqCst);

    // 1. Latence.
    let mut times = Vec::new();
    for i in 0..PINGS {
        if stopped() {
            return Err("arrêté".into());
        }
        let t = Instant::now();
        let mut resp = agent.get(&format!("{BASE}/__down?bytes=0")).header("Accept-Encoding", "identity").call().map_err(|e| format!("{SERVER} ne répond pas ({e})"))?;
        let _ = std::io::copy(&mut resp.body_mut().as_reader(), &mut std::io::sink());
        times.push(t.elapsed().as_secs_f64() * 1000.0);
        emit(app, json!({ "phase": "ping", "progress": overall("ping", (i + 1) as f64 / PINGS as f64), "mbps": 0 }));
    }
    let ping = median(&mut times).unwrap_or(0.0).round();

    // 2. Réception, puis 3. envoi.
    let down = measure(app, &agent, stop, emit, "down", ping)?;
    let up = measure(app, &agent, stop, emit, "up", ping)?;
    log::info("réseau : test de débit terminé");
    Ok(json!({ "phase": "done", "down": round1(down), "up": round1(up), "ping": ping, "server": SERVER, "progress": 1 }))
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// Un sens (réception ou envoi) : plusieurs flux, un compteur commun d'octets,
/// un rapport toutes les 250 ms. Renvoie le débit moyen (Mbit/s).
fn measure(app: &AppHandle, agent: &ureq::Agent, stop: &Arc<AtomicBool>, emit: &dyn Fn(&AppHandle, Value), phase: &'static str, ping: f64) -> Result<f64, String> {
    let (streams, for_, max) = if phase == "down" { (DOWN_STREAMS, DOWN_FOR, DOWN_MAX) } else { (UP_STREAMS, UP_FOR, UP_MAX) };
    let bytes = Arc::new(AtomicU64::new(0));
    let enough = Arc::new(AtomicBool::new(false));
    let errors = Arc::new(AtomicU64::new(0));
    let start = Instant::now();
    std::thread::scope(|scope| {
        for _ in 0..streams {
            let (agent, bytes, enough, errors) = (agent.clone(), bytes.clone(), enough.clone(), errors.clone());
            scope.spawn(move || {
                while !enough.load(Ordering::SeqCst) {
                    let ok = if phase == "down" { download(&agent, &bytes, &enough) } else { upload(&agent, &bytes, &enough) };
                    if !ok {
                        errors.fetch_add(1, Ordering::SeqCst);
                        if errors.load(Ordering::SeqCst) > 6 {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(200));
                    }
                }
            });
        }
        // Le fil qui mesure : rapports, fin du temps, plafond, « Arrêter ».
        let mut last = (Instant::now(), 0u64);
        let mut smooth = 0.0;
        loop {
            std::thread::sleep(REPORT_EVERY);
            let now = bytes.load(Ordering::SeqCst);
            let elapsed = start.elapsed();
            let instant = mbps(now - last.1, last.0.elapsed().as_secs_f64());
            last = (Instant::now(), now);
            // Lissé : le chiffre affiché ne saute pas à chaque rapport.
            smooth = if smooth == 0.0 { instant } else { smooth * 0.7 + instant * 0.3 };
            emit(app, json!({ "phase": phase, "mbps": round1(smooth), "ping": ping, "progress": overall(phase, elapsed.as_secs_f64() / for_.as_secs_f64()) }));
            if stop.load(Ordering::SeqCst) || elapsed >= for_ || now >= max || errors.load(Ordering::SeqCst) > 6 {
                enough.store(true, Ordering::SeqCst);
                break;
            }
        }
    });
    if stop.load(Ordering::SeqCst) {
        return Err("arrêté".into());
    }
    let total = bytes.load(Ordering::SeqCst);
    if total == 0 {
        return Err(format!("{SERVER} ne répond pas"));
    }
    Ok(mbps(total, start.elapsed().as_secs_f64()))
}

/// Une demande de téléchargement : lit jusqu'à la fin ou jusqu'à `enough`.
fn download(agent: &ureq::Agent, bytes: &AtomicU64, enough: &AtomicBool) -> bool {
    let Ok(resp) = agent.get(&format!("{BASE}/__down?bytes={DOWN_CHUNK}")).header("Accept-Encoding", "identity").call() else { return false };
    let mut reader = resp.into_body().into_reader();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        if enough.load(Ordering::SeqCst) {
            return true;
        }
        match reader.read(&mut buf) {
            Ok(0) => return true,
            Ok(n) => {
                bytes.fetch_add(n as u64, Ordering::SeqCst);
            }
            Err(_) => return false,
        }
    }
}

/// Des zéros qui comptent ce qui a été lu (donc envoyé), et s'arrêtent à `enough`.
struct Zeros {
    left: u64,
    bytes: Arc<AtomicU64>,
    enough: Arc<AtomicBool>,
}

impl Read for Zeros {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.left == 0 {
            return Ok(0);
        }
        if self.enough.load(Ordering::SeqCst) {
            return Err(std::io::Error::other("assez"));
        }
        let n = (buf.len() as u64).min(self.left).min(64 * 1024) as usize;
        buf[..n].fill(0);
        self.left -= n as u64;
        self.bytes.fetch_add(n as u64, Ordering::SeqCst);
        Ok(n)
    }
}

/// Un envoi de UP_CHUNK octets (coupé à `enough`).
fn upload(agent: &ureq::Agent, bytes: &Arc<AtomicU64>, enough: &Arc<AtomicBool>) -> bool {
    let body = Zeros { left: UP_CHUNK, bytes: bytes.clone(), enough: enough.clone() };
    let r = agent
        .post(&format!("{BASE}/__up"))
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", UP_CHUNK.to_string())
        .send(ureq::SendBody::from_owned_reader(body));
    r.is_ok() || enough.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rates_and_medians() {
        assert_eq!(mbps(12_500_000, 1.0), 100.0);
        assert_eq!(mbps(0, 1.0), 0.0);
        assert_eq!(mbps(10, 0.0), 0.0);
        assert_eq!(median(&mut [30.0, 10.0, 200.0]), Some(30.0));
        assert_eq!(median(&mut [10.0, 20.0]), Some(15.0));
        assert_eq!(median(&mut []), None);
    }

    #[test]
    fn progress_covers_the_whole_test() {
        assert_eq!(overall("ping", 0.0), 0.0);
        assert!((overall("ping", 1.0) - 0.1).abs() < 1e-9);
        assert!((overall("down", 1.0) - 0.6).abs() < 1e-9);
        assert!((overall("up", 2.0) - 1.0).abs() < 1e-9, "borné");
        assert_eq!(overall("done", 0.0), 1.0);
    }

    #[test]
    fn zeros_count_what_is_sent() {
        let bytes = Arc::new(AtomicU64::new(0));
        let enough = Arc::new(AtomicBool::new(false));
        let mut z = Zeros { left: 100_000, bytes: bytes.clone(), enough: enough.clone() };
        let mut sink = Vec::new();
        z.read_to_end(&mut sink).unwrap();
        assert_eq!(sink.len(), 100_000);
        assert_eq!(bytes.load(Ordering::SeqCst), 100_000);
        let mut z = Zeros { left: 100_000, bytes, enough: enough.clone() };
        enough.store(true, Ordering::SeqCst);
        assert!(z.read(&mut [0u8; 10]).is_err(), "« assez » coupe l'envoi");
    }
}
