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
// « Copier pour le support » met dans le presse-papiers un résumé à coller
// dans un ticket. Le journal ne contient jamais ces informations.

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

const ID: &str = "system";
const TICK: Duration = Duration::from_secs(2);
const DISK_EVERY: Duration = Duration::from_secs(30);
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

    fn invoke(&self, ctx: &ModuleContext, command: &str, _args: Value) -> Result<Value, String> {
        match command {
            "snapshot" => Ok(snapshot(&self.state)),
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
        let mut s = state.lock().unwrap();
        s.cpu_brand = sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default();
        s.cpu_cores = sys.cpus().len();
    }
    let mut last_disks: Option<Instant> = None;
    loop {
        std::thread::sleep(TICK);
        if !super::is_active(&app, ID) {
            continue; // module désactivé : on ne mesure rien
        }
        let step = catch_unwind(AssertUnwindSafe(|| {
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            {
                let mut s = state.lock().unwrap();
                s.cpu_usage = sys.global_cpu_usage();
                s.mem_total = sys.total_memory();
                s.mem_used = sys.used_memory();
            }
            if last_disks.is_none_or(|t| t.elapsed() >= DISK_EVERY) {
                last_disks = Some(Instant::now());
                super::with_context(&app, ID, |ctx| check_disks(ctx, &state));
            }
        }));
        if step.is_err() {
            log::warn("système : erreur inattendue pendant une mesure, on continue");
        }
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
        let mut s = state.lock().unwrap();
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
        let s = state.lock().unwrap();
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
