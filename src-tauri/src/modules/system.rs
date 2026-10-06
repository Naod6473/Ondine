// Module « Système » (phase Outils IT) : l'état du PC d'un coup d'œil.
//
// Processeur, mémoire, disques, cartes réseau (adresses IP, MAC), batterie,
// nom du PC, version de Windows, durée depuis le démarrage. Tout est lu sur
// le PC lui-même (crate `sysinfo`, et Windows pour la batterie) : rien ne
// part sur Internet.
//
// Un fil de fond mesure le processeur et la mémoire toutes les 2 s (il faut
// deux mesures espacées pour calculer un pourcentage de processeur) et
// surveille les disques toutes les 30 s : s'il reste trop peu de place, il
// prévient une fois (« system.disk-low »), puis de nouveau seulement si la
// place est revenue entre-temps.
//
// Il surveille aussi la batterie (« system.battery-low » sous le seuil choisi,
// « system.battery-full » quand la charge est finie) et le processeur : s'il
// reste longtemps très occupé, « system.cpu-busy » { on: true } (Ondine
// transpire), puis { on: false } quand il se calme.
//
// « Copier pour le support » met dans le presse-papiers un résumé à coller
// dans un ticket. Le journal ne contient jamais ces informations.
//
// « Préparer un ticket » : ta description + ce résumé (+ l'image copiée, si tu
// le demandes, par exemple une capture Win+Maj+S) dans un dossier
// Documents\Ondine\Tickets\Ticket <date>, et le texte dans le presse-papiers.
// Rien n'est envoyé : tu joins le dossier toi-même. Annulable (Corbeille).

use crate::sync::LockExt;
use std::collections::HashSet;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sysinfo::{Disks, Networks, System};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::{files, log};
use crate::services::perf::{self, Loop};

const ID: &str = "system";
const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

/// Ce que le fil de fond mesure.
#[derive(Default)]
struct State {
    cpu_usage: f32,
    cpu_brand: String,
    cpu_cores: usize,
    mem_total: u64,
    mem_used: u64,
    /// Disques déjà signalés comme pleins (point de montage).
    warned: HashSet<String>,
    battery: BatteryWatch,
    cpu: CpuWatch,
}

/// Ce qu'on a déjà dit de la batterie (pour ne prévenir qu'une fois).
#[derive(Default, Debug, PartialEq)]
struct BatteryWatch {
    low_said: bool,
    full_said: bool,
}

/// Ce qu'il faut annoncer pour la batterie, selon l'état lu et le seuil (0 = jamais).
#[derive(Debug, PartialEq)]
enum BatteryNews {
    Low(u8),
    Full,
}

fn battery_news(w: &mut BatteryWatch, b: &platform::Battery, low_pct: u8, full_alert: bool) -> Option<BatteryNews> {
    let pct = b.percent?;
    // Branché : plus d'alerte « faible » à venir ; à 100 %, « chargée » une fois.
    if b.plugged {
        w.low_said = false;
        if full_alert && pct >= 100 && !w.full_said {
            w.full_said = true;
            return Some(BatteryNews::Full);
        }
        return None;
    }
    // Débranché : on pourra de nouveau dire « chargée » la prochaine fois.
    w.full_said = false;
    if low_pct > 0 && pct <= low_pct && !w.low_said {
        w.low_said = true;
        return Some(BatteryNews::Low(pct));
    }
    None
}

/// Le processeur est « très occupé » après BUSY_FOR (≈ 20 s) de mesures
/// au-dessus de BUSY_PCT, et « calme » après autant de mesures sous CALM_PCT.
/// Le nombre de mesures dépend du rythme (mode de performance) : `busy_ticks`.
const BUSY_PCT: f32 = 85.0;
const CALM_PCT: f32 = 60.0;
const BUSY_FOR: Duration = Duration::from_secs(20);

/// Combien de mesures de suite font BUSY_FOR à ce rythme (10 × 2 s en équilibré), 3 au moins.
fn busy_ticks(tick: Duration) -> u32 {
    let tick = tick.as_millis().max(1);
    ((BUSY_FOR.as_millis() + tick - 1) / tick).max(3) as u32
}

#[derive(Default)]
struct CpuWatch {
    busy: bool,
    streak: u32,
}

/// Renvoie Some(nouvel état) quand le processeur devient très occupé ou se calme.
fn cpu_news(w: &mut CpuWatch, usage: f32, needed: u32) -> Option<bool> {
    let pushing = if w.busy { usage < CALM_PCT } else { usage > BUSY_PCT };
    w.streak = if pushing { w.streak + 1 } else { 0 };
    if w.streak >= needed {
        w.streak = 0;
        w.busy = !w.busy;
        return Some(w.busy);
    }
    None
}

type Shared = Arc<Mutex<State>>;

#[derive(Default)]
pub struct SystemInfo {
    state: Shared,
}

impl RustModule for SystemInfo {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/system/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let (app, state) = (app.clone(), self.state.clone());
        std::thread::spawn(move || watch(app, state));
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "snapshot" => Ok(snapshot(&self.state)),
            // { description, withImage } → { folder }
            "ticket" => ticket(ctx, &snapshot(&self.state), &args),
            "copy_support" => {
                ctx.require("clipboard")?;
                files::copy_text(&support_text(&snapshot(&self.state)))?;
                log::info("système : résumé copié pour le support");
                Ok(Value::Null)
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

// ── Le fil de fond ───────────────────────────────────────────────────────────

fn watch(app: AppHandle, state: Shared) {
    let mut sys = System::new();
    sys.refresh_cpu_all(); // le nom du processeur et le nombre de cœurs
    {
        let mut s = state.locked();
        s.cpu_brand = sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default();
        s.cpu_cores = sys.cpus().len();
    }
    let mut last_disks: Option<Instant> = None;
    loop {
        // Toutes les 2 s (1 s en haute, 5 s en éco : services/perf.rs).
        std::thread::sleep(perf::every(Loop::System));
        if !super::is_active(&app, ID) {
            continue; // module désactivé : on ne mesure rien
        }
        let step = catch_unwind(AssertUnwindSafe(|| {
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            {
                let mut s = state.locked();
                s.cpu_usage = sys.global_cpu_usage();
                s.mem_total = sys.total_memory();
                s.mem_used = sys.used_memory();
            }
            super::with_context(&app, ID, |ctx| check_cpu(ctx, &state));
            if last_disks.is_none_or(|t| t.elapsed() >= perf::every(Loop::SystemDisks)) {
                last_disks = Some(Instant::now());
                super::with_context(&app, ID, |ctx| {
                    check_disks(ctx, &state);
                    check_battery(ctx, &state);
                });
            }
        }));
        if step.is_err() {
            log::warn("système : erreur inattendue pendant une mesure, on continue");
        }
    }
}

/// Prévient quand la batterie est faible, ou chargée.
fn check_battery(ctx: &ModuleContext, state: &Shared) {
    let Some(b) = platform::battery() else { return };
    let settings = ctx.settings();
    let low = settings.get("batteryLowPct").and_then(Value::as_u64).unwrap_or(20).min(50) as u8;
    let full = settings.get("batteryFullAlert").and_then(Value::as_bool).unwrap_or(true);
    let news = battery_news(&mut state.locked().battery, &b, low, full);
    match news {
        Some(BatteryNews::Low(pct)) => ctx.emit("system.battery-low", json!({ "percent": pct })),
        Some(BatteryNews::Full) => ctx.emit("system.battery-full", json!({})),
        None => {}
    }
}

/// Prévient quand le processeur reste très occupé, puis quand il se calme.
fn check_cpu(ctx: &ModuleContext, state: &Shared) {
    let mut s = state.locked();
    let usage = s.cpu_usage;
    if let Some(on) = cpu_news(&mut s.cpu, usage, busy_ticks(perf::every(Loop::System))) {
        drop(s);
        ctx.emit("system.cpu-busy", json!({ "on": on }));
    }
}

/// Prévient quand un disque fixe passe sous le seuil de place libre (réglage).
fn check_disks(ctx: &ModuleContext, state: &Shared) {
    let threshold = ctx.settings().get("diskAlertPct").and_then(Value::as_f64).unwrap_or(10.0).clamp(0.0, 50.0);
    if threshold <= 0.0 {
        return;
    }
    let disks = Disks::new_with_refreshed_list();
    for d in disks.list() {
        if d.is_removable() || d.total_space() == 0 {
            continue;
        }
        let mount = d.mount_point().display().to_string();
        let free_pct = d.available_space() as f64 * 100.0 / d.total_space() as f64;
        let mut s = state.locked();
        if free_pct < threshold {
            if s.warned.insert(mount.clone()) {
                ctx.emit(
                    "system.disk-low",
                    json!({ "mount": mount, "freePct": free_pct.round(), "freeGb": round1(d.available_space() as f64 / GIB) }),
                );
            }
        } else if free_pct > threshold + 2.0 {
            // De la place est revenue : on pourra prévenir de nouveau.
            s.warned.remove(&mount);
        }
    }
}

// ── La photo de l'état du PC ─────────────────────────────────────────────────

fn snapshot(state: &Shared) -> Value {
    let (cpu_usage, cpu_brand, cpu_cores, mem_total, mem_used) = {
        let s = state.locked();
        (s.cpu_usage, s.cpu_brand.clone(), s.cpu_cores, s.mem_total, s.mem_used)
    };

    let disks: Vec<Value> = Disks::new_with_refreshed_list()
        .list()
        .iter()
        .filter(|d| d.total_space() > 0)
        .map(|d| {
            json!({
                "mount": d.mount_point().display().to_string(),
                "label": d.name().to_string_lossy(),
                "totalGb": round1(d.total_space() as f64 / GIB),
                "freeGb": round1(d.available_space() as f64 / GIB),
                "removable": d.is_removable(),
            })
        })
        .collect();

    // Les cartes réseau utiles : branchées, avec au moins une adresse qui n'est
    // pas « locale à la machine » (127.0.0.1, ::1) ni une IPv6 de lien (fe80::).
    let networks = Networks::new_with_refreshed_list();
    let mut net: Vec<Value> = networks
        .list()
        .iter()
        .filter_map(|(name, data)| {
            let ips: Vec<String> = data
                .ip_networks()
                .iter()
                .filter(|n| !n.addr.is_loopback() && !is_link_local(&n.addr))
                .map(|n| n.addr.to_string())
                .collect();
            if ips.is_empty() {
                return None;
            }
            let mut ips = ips;
            ips.sort_by_key(|ip| ip.contains(':')); // IPv4 d'abord
            Some(json!({ "name": name, "ips": ips, "mac": data.mac_address().to_string() }))
        })
        .collect();
    net.sort_by_key(|n| n["name"].as_str().unwrap_or_default().to_lowercase());

    json!({
        "host": System::host_name().unwrap_or_default(),
        "user": std::env::var("USERNAME").unwrap_or_default(),
        "domain": std::env::var("USERDOMAIN").unwrap_or_default(),
        "os": System::long_os_version().unwrap_or_default(),
        "osBuild": System::kernel_version().unwrap_or_default(),
        "uptimeSecs": System::uptime(),
        "cpu": { "brand": cpu_brand, "cores": cpu_cores, "usage": (cpu_usage * 10.0).round() / 10.0 },
        "mem": { "totalGb": round1(mem_total as f64 / GIB), "usedGb": round1(mem_used as f64 / GIB) },
        "disks": disks,
        "net": net,
        "battery": platform::battery().map(|b| json!({ "percent": b.percent, "charging": b.charging, "plugged": b.plugged })),
    })
}

fn is_link_local(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => v4.is_link_local(),
        // fe80::/10
        std::net::IpAddr::V6(v6) => (v6.segments()[0] & 0xffc0) == 0xfe80,
    }
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// « 3 j 4 h », « 5 h 12 min », « 7 min ».
fn uptime_text(secs: u64) -> String {
    let (d, h, m) = (secs / 86_400, (secs % 86_400) / 3600, (secs % 3600) / 60);
    if d > 0 {
        format!("{d} j {h} h")
    } else if h > 0 {
        format!("{h} h {m} min")
    } else {
        format!("{m} min")
    }
}

/// Le texte copié pour un ticket de support.
/// Prépare le dossier du ticket (voir en tête de fichier).
fn ticket(ctx: &ModuleContext, snap: &Value, args: &Value) -> Result<Value, String> {
    ctx.require("files")?;
    ctx.require("clipboard")?;
    let description = args.get("description").and_then(Value::as_str).unwrap_or("").trim();
    if description.is_empty() {
        return Err("décris le problème en quelques mots".into());
    }
    if description.chars().count() > 5000 {
        return Err("description trop longue (5000 caractères au plus)".into());
    }
    // L'image d'abord : si on la demande et qu'il n'y en a pas, on s'arrête avant d'écrire quoi que ce soit.
    let png = if args.get("withImage").and_then(Value::as_bool).unwrap_or(false) {
        if platform::clipboard_is_sensitive() {
            return Err("le contenu copié est marqué sensible : on n'y touche pas".into());
        }
        let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("presse-papiers indisponible : {e}"))?;
        let img = clipboard.get_image().map_err(|_| "aucune image copiée : fais d'abord ta capture (Win+Maj+S)".to_string())?;
        let mut out = std::io::Cursor::new(Vec::new());
        image::write_buffer_with_format(&mut out, &img.bytes, img.width as u32, img.height as u32, image::ExtendedColorType::Rgba8, image::ImageFormat::Png)
            .map_err(|e| format!("image illisible : {e}"))?;
        Some(out.into_inner())
    } else {
        None
    };

    let base = platform::documents_dir().ok_or("dossier Documents introuvable")?.join("Ondine").join("Tickets");
    std::fs::create_dir_all(&base).map_err(|e| format!("impossible de créer {} : {e}", base.display()))?;
    let base = ctx.check_path(&base.display().to_string())?;
    let t = platform::local_time();
    let name = format!("Ticket {:04}-{:02}-{:02} {:02}.{:02}.{:02}", t.year, t.month, t.day, t.hour, t.minute, t.second);
    let dir = files::unique_dest(&base, name.as_ref());
    std::fs::create_dir(&dir).map_err(|e| format!("impossible de créer le dossier du ticket : {e}"))?;

    let mut text = format!("Problème\r\n--------\r\n{}\r\n\r\nInfos du poste\r\n--------------\r\n{}", description.replace('\n', "\r\n"), support_text(snap));
    if png.is_some() {
        text.push_str("\r\n\r\nCapture jointe : capture.png");
    }
    let written = std::fs::write(dir.join("ticket.txt"), &text).and_then(|_| match &png {
        Some(bytes) => std::fs::write(dir.join("capture.png"), bytes),
        None => Ok(()),
    });
    if let Err(e) = written {
        let _ = files::to_trash(std::slice::from_ref(&dir));
        return Err(format!("écriture du ticket impossible : {e}"));
    }
    files::copy_text(&text)?;
    let _ = files::open_folder(&dir);
    log::info("système : ticket préparé");
    let undo_dir = dir.clone();
    ctx.offer_undo("Ticket préparé", crate::services::undo::DEFAULT_WINDOW, Box::new(move || files::to_trash(&[undo_dir])));
    Ok(json!({ "folder": dir.display().to_string() }))
}

fn support_text(s: &Value) -> String {
    let str_of = |v: &Value| v.as_str().unwrap_or_default().to_string();
    let mut out = vec![
        format!("Poste : {}", str_of(&s["host"])),
        format!("Utilisateur : {}\\{}", str_of(&s["domain"]), str_of(&s["user"])),
        format!("Système : {} (build {})", str_of(&s["os"]), str_of(&s["osBuild"])),
        format!("Allumé depuis : {}", uptime_text(s["uptimeSecs"].as_u64().unwrap_or(0))),
        format!(
            "Processeur : {} ({} cœurs logiques), {} % utilisé",
            str_of(&s["cpu"]["brand"]),
            s["cpu"]["cores"],
            s["cpu"]["usage"]
        ),
        format!("Mémoire : {} Go utilisés sur {} Go", s["mem"]["usedGb"], s["mem"]["totalGb"]),
    ];
    for d in s["disks"].as_array().into_iter().flatten() {
        out.push(format!("Disque {} : {} Go libres sur {} Go", str_of(&d["mount"]), d["freeGb"], d["totalGb"]));
    }
    for n in s["net"].as_array().into_iter().flatten() {
        let ips: Vec<String> = n["ips"].as_array().into_iter().flatten().map(str_of).collect();
        out.push(format!("Réseau {} : {} (MAC {})", str_of(&n["name"]), ips.join(", "), str_of(&n["mac"])));
    }
    if let Some(b) = s["battery"].as_object() {
        out.push(format!(
            "Batterie : {} %{}",
            b["percent"],
            if b["charging"].as_bool() == Some(true) { " (en charge)" } else { "" }
        ));
    }
    out.join("\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn battery_news_once() {
        let mut w = BatteryWatch::default();
        let b = |percent, plugged| platform::Battery { percent: Some(percent), charging: plugged, plugged };
        assert_eq!(battery_news(&mut w, &b(50, false), 20, true), None);
        assert_eq!(battery_news(&mut w, &b(20, false), 20, true), Some(BatteryNews::Low(20)));
        assert_eq!(battery_news(&mut w, &b(15, false), 20, true), None); // déjà dit
        assert_eq!(battery_news(&mut w, &b(80, true), 20, true), None);
        assert_eq!(battery_news(&mut w, &b(100, true), 20, true), Some(BatteryNews::Full));
        assert_eq!(battery_news(&mut w, &b(100, true), 20, true), None);
        assert_eq!(battery_news(&mut w, &b(19, false), 20, true), Some(BatteryNews::Low(19)));
        // Seuil 0 : jamais.
        let mut w = BatteryWatch::default();
        assert_eq!(battery_news(&mut w, &b(5, false), 0, true), None);
    }

    #[test]
    fn cpu_busy_needs_a_streak() {
        const N: u32 = 10;
        let mut w = CpuWatch::default();
        for _ in 0..N - 1 {
            assert_eq!(cpu_news(&mut w, 95.0, N), None);
        }
        assert_eq!(cpu_news(&mut w, 95.0, N), Some(true));
        assert_eq!(cpu_news(&mut w, 30.0, N), None);
        assert_eq!(cpu_news(&mut w, 95.0, N), None); // la série repart de zéro
        for _ in 0..N - 1 {
            cpu_news(&mut w, 30.0, N);
        }
        assert_eq!(cpu_news(&mut w, 30.0, N), Some(false));
    }

    #[test]
    fn cpu_busy_lasts_about_20_s_in_every_mode() {
        let ms = Duration::from_millis;
        assert_eq!(busy_ticks(ms(2_000)), 10); // équilibré : comme avant
        assert_eq!(busy_ticks(ms(1_000)), 20); // haute
        assert_eq!(busy_ticks(ms(5_000)), 4); // éco
        assert_eq!(busy_ticks(ms(60_000)), 3); // jamais moins de 3 mesures
    }

    #[test]
    fn uptime_reads_well() {
        assert_eq!(uptime_text(7 * 60), "7 min");
        assert_eq!(uptime_text(5 * 3600 + 12 * 60), "5 h 12 min");
        assert_eq!(uptime_text(3 * 86_400 + 4 * 3600 + 59), "3 j 4 h");
    }

    #[test]
    fn link_local_addresses_are_hidden() {
        assert!(is_link_local(&"fe80::1".parse().unwrap()));
        assert!(is_link_local(&"169.254.10.2".parse().unwrap()));
        assert!(!is_link_local(&"192.168.1.20".parse().unwrap()));
        assert!(!is_link_local(&"2a01:cb00::1".parse().unwrap()));
    }

    #[test]
    fn support_text_has_the_basics() {
        let s = json!({
            "host": "PC-SIMON", "user": "simon", "domain": "MAISON", "os": "Windows 11 Pro", "osBuild": "26100",
            "uptimeSecs": 3700, "cpu": { "brand": "Intel i5", "cores": 8, "usage": 12.5 },
            "mem": { "totalGb": 16.0, "usedGb": 7.2 },
            "disks": [{ "mount": "C:\\", "freeGb": 120.3, "totalGb": 476.0 }],
            "net": [{ "name": "Wi-Fi", "ips": ["192.168.1.20"], "mac": "AA:BB:CC:DD:EE:FF" }],
            "battery": null
        });
        let t = support_text(&s);
        assert!(t.contains("Poste : PC-SIMON"));
        assert!(t.contains("MAISON\\simon"));
        assert!(t.contains("Allumé depuis : 1 h 1 min"));
        assert!(t.contains("Wi-Fi : 192.168.1.20 (MAC AA:BB:CC:DD:EE:FF)"));
        assert!(!t.contains("Batterie"));
    }
}
