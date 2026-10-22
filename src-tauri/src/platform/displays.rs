// Contrôles → Écrans (1.2.5) : ce que fait Windows+P, l'écran principal, et
// éteindre seulement l'écran.
//
//   - le mode d'affichage (« PC seul », « Dupliquer », « Étendre »,
//     « Deuxième écran seul ») : SetDisplayConfig avec SDC_TOPOLOGY_*, comme
//     le panneau de Windows+P ; le mode actuel vient de QueryDisplayConfig
//     (QDC_DATABASE_CURRENT) ;
//   - l'écran principal : tous les écrans glissent pour que le nouveau soit
//     en (0, 0), puis CDS_SET_PRIMARY (ChangeDisplaySettingsEx, appliqué
//     d'un coup à la fin) ; Windows garde le choix ;
//   - éteindre l'écran : WM_SYSCOMMAND / SC_MONITORPOWER (2). Le PC continue
//     de tourner ; un mouvement de souris ou une touche le rallume.
//
// Les noms des écrans viennent de DisplayConfigGetDeviceInfo (« DELL
// U2720Q ») ; l'écran du portable s'appelle « Écran intégré ».

// Sous Linux, seule la logique pure sert (aux tests).
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;

/// Les quatre modes de Windows+P.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// « PC seul » : l'écran intégré (ou le premier) seulement.
    Internal,
    /// « Dupliquer ».
    Clone,
    /// « Étendre ».
    Extend,
    /// « Deuxième écran uniquement ».
    External,
}

impl Mode {
    pub fn from_id(id: &str) -> Option<Mode> {
        match id {
            "internal" => Some(Mode::Internal),
            "clone" => Some(Mode::Clone),
            "extend" => Some(Mode::Extend),
            "external" => Some(Mode::External),
            _ => None,
        }
    }

    /// DISPLAYCONFIG_TOPOLOGY_ID → le mode (0 ou une valeur inconnue : None).
    pub fn from_topology(id: i32) -> Option<Mode> {
        match id {
            1 => Some(Mode::Internal),
            2 => Some(Mode::Clone),
            4 => Some(Mode::Extend),
            8 => Some(Mode::External),
            _ => None,
        }
    }

    /// Le drapeau SDC_TOPOLOGY_* correspondant.
    pub fn sdc_flag(self) -> u32 {
        match self {
            Mode::Internal => 1,
            Mode::Clone => 2,
            Mode::Extend => 4,
            Mode::External => 8,
        }
    }
}

/// Ce que l'onglet montre : le mode, et combien d'écrans sont branchés.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Layout {
    pub mode: Option<Mode>,
    /// Écrans branchés (actifs ou non) : sous 2, les modes ne servent à rien.
    pub connected: u32,
}

/// Un écran du bureau (actif).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Display {
    /// Le nom GDI (« \\.\DISPLAY1 ») : sert à le désigner.
    pub id: String,
    pub name: String,
    pub primary: bool,
    pub internal: bool,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Les nouvelles positions pour que `id` devienne l'écran principal : tout
/// glisse pour que son coin haut gauche soit en (0, 0). None : écran inconnu.
pub fn primary_shift(list: &[Display], id: &str) -> Option<Vec<(String, i32, i32)>> {
    let target = list.iter().find(|d| d.id == id)?;
    let (dx, dy) = (target.x, target.y);
    Some(list.iter().map(|d| (d.id.clone(), d.x - dx, d.y - dy)).collect())
}

#[cfg(windows)]
pub use self::win::*;

#[cfg(not(windows))]
pub use self::stub::*;

#[cfg(windows)]
mod win {
    use super::{primary_shift, Display, Layout, Mode};
    use ::windows::core::PCWSTR;
    use ::windows::Win32::Devices::Display::{
        DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig, SetDisplayConfig, DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
        DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_LVDS,
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED, DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SOURCE_DEVICE_NAME, DISPLAYCONFIG_TARGET_DEVICE_NAME, DISPLAYCONFIG_TOPOLOGY_ID,
        DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY, QDC_ALL_PATHS, QDC_DATABASE_CURRENT, QDC_ONLY_ACTIVE_PATHS, QUERY_DISPLAY_CONFIG_FLAGS, SDC_APPLY, SET_DISPLAY_CONFIG_FLAGS,
    };
    use ::windows::Win32::Foundation::{ERROR_SUCCESS, HWND, LPARAM, WPARAM};
    use ::windows::Win32::Graphics::Gdi::{
        ChangeDisplaySettingsExW, EnumDisplayDevicesW, EnumDisplaySettingsW, CDS_NORESET, CDS_SET_PRIMARY, CDS_UPDATEREGISTRY, DEVMODEW, DISPLAY_DEVICEW, DISPLAY_DEVICE_ATTACHED_TO_DESKTOP,
        DISPLAY_DEVICE_PRIMARY_DEVICE, DISP_CHANGE_SUCCESSFUL, DM_POSITION, ENUM_CURRENT_SETTINGS,
    };
    use ::windows::Win32::UI::WindowsAndMessaging::{PostMessageW, SC_MONITORPOWER, WM_SYSCOMMAND};

    fn text(buf: &[u16]) -> String {
        let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..n])
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Les chemins d'affichage (et le mode, avec QDC_DATABASE_CURRENT).
    fn query(flags: QUERY_DISPLAY_CONFIG_FLAGS) -> Option<(Vec<DISPLAYCONFIG_PATH_INFO>, Option<i32>)> {
        unsafe {
            for _ in 0..3 {
                let (mut np, mut nm) = (0u32, 0u32);
                if GetDisplayConfigBufferSizes(flags, &mut np, &mut nm) != ERROR_SUCCESS {
                    return None;
                }
                let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); np as usize];
                let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); nm as usize];
                let mut topology = DISPLAYCONFIG_TOPOLOGY_ID(0);
                let want_topology = flags == QDC_DATABASE_CURRENT;
                let r = QueryDisplayConfig(flags, &mut np, paths.as_mut_ptr(), &mut nm, modes.as_mut_ptr(), want_topology.then_some(&mut topology as *mut _));
                // ERROR_INSUFFICIENT_BUFFER : un écran vient d'arriver, on recommence.
                if r == ERROR_SUCCESS {
                    paths.truncate(np as usize);
                    return Some((paths, want_topology.then_some(topology.0)));
                }
            }
            None
        }
    }

    fn internal(tech: DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY) -> bool {
        tech == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL || tech == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED || tech == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED || tech == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_LVDS
    }

    pub fn layout() -> Layout {
        let mode = query(QDC_DATABASE_CURRENT).and_then(|(_, t)| t).and_then(Mode::from_topology);
        // Les écrans branchés : les cibles disponibles, chacune comptée une fois.
        let mut targets: Vec<(i32, u32, u32)> = Vec::new();
        if let Some((paths, _)) = query(QDC_ALL_PATHS) {
            for p in paths {
                let t = &p.targetInfo;
                let key = (t.adapterId.HighPart, t.adapterId.LowPart, t.id);
                if t.targetAvailable.as_bool() && !targets.contains(&key) {
                    targets.push(key);
                }
            }
        }
        Layout { mode, connected: targets.len() as u32 }
    }

    pub fn set_mode(mode: Mode) -> Result<(), String> {
        let r = unsafe { SetDisplayConfig(None, None, SET_DISPLAY_CONFIG_FLAGS(SDC_APPLY.0 | mode.sdc_flag())) };
        if r == 0 {
            Ok(())
        } else {
            Err(format!("Windows a refusé ce mode d'affichage (code {r}) : un seul écran est-il branché ?"))
        }
    }

    /// Le nom lisible de chaque écran actif, par nom GDI.
    fn names() -> Vec<(String, String, bool)> {
        let mut out = Vec::new();
        let Some((paths, _)) = query(QDC_ONLY_ACTIVE_PATHS) else { return out };
        for p in paths {
            unsafe {
                let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
                source.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
                source.header.size = std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
                source.header.adapterId = p.sourceInfo.adapterId;
                source.header.id = p.sourceInfo.id;
                if DisplayConfigGetDeviceInfo(&mut source.header) != 0 {
                    continue;
                }
                let mut target = DISPLAYCONFIG_TARGET_DEVICE_NAME::default();
                target.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
                target.header.size = std::mem::size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32;
                target.header.adapterId = p.targetInfo.adapterId;
                target.header.id = p.targetInfo.id;
                let friendly = if DisplayConfigGetDeviceInfo(&mut target.header) == 0 { text(&target.monitorFriendlyDeviceName) } else { String::new() };
                out.push((text(&source.viewGdiDeviceName), friendly, internal(p.targetInfo.outputTechnology)));
            }
        }
        out
    }

    fn settings(device: &[u16]) -> Option<DEVMODEW> {
        let mut dm = DEVMODEW { dmSize: std::mem::size_of::<DEVMODEW>() as u16, ..Default::default() };
        unsafe { EnumDisplaySettingsW(PCWSTR(device.as_ptr()), ENUM_CURRENT_SETTINGS, &mut dm) }.as_bool().then_some(dm)
    }

    pub fn list() -> Vec<Display> {
        let names = names();
        let mut out = Vec::new();
        for i in 0..16u32 {
            let mut dev = DISPLAY_DEVICEW { cb: std::mem::size_of::<DISPLAY_DEVICEW>() as u32, ..Default::default() };
            if !unsafe { EnumDisplayDevicesW(PCWSTR::null(), i, &mut dev, 0) }.as_bool() {
                break;
            }
            if dev.StateFlags.0 & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP.0 == 0 {
                continue;
            }
            let id = text(&dev.DeviceName);
            let Some(dm) = settings(&dev.DeviceName) else { continue };
            let pos = unsafe { dm.Anonymous1.Anonymous2.dmPosition };
            let (friendly, internal) = names.iter().find(|(gdi, _, _)| *gdi == id).map(|(_, n, i)| (n.clone(), *i)).unwrap_or_default();
            let name = if internal {
                "Écran intégré".to_string()
            } else if friendly.trim().is_empty() {
                format!("Écran {}", out.len() + 1)
            } else {
                friendly
            };
            out.push(Display {
                id,
                name,
                primary: dev.StateFlags.0 & DISPLAY_DEVICE_PRIMARY_DEVICE.0 != 0,
                internal,
                x: pos.x,
                y: pos.y,
                width: dm.dmPelsWidth,
                height: dm.dmPelsHeight,
            });
        }
        out
    }

    pub fn set_primary(id: &str) -> Result<(), String> {
        let list = list();
        let moves = primary_shift(&list, id).ok_or("écran introuvable (débranché ?)")?;
        for (dev, x, y) in &moves {
            let name = wide(dev);
            let Some(mut dm) = settings(&name) else { continue };
            dm.dmFields = DM_POSITION;
            dm.Anonymous1.Anonymous2.dmPosition.x = *x;
            dm.Anonymous1.Anonymous2.dmPosition.y = *y;
            let mut flags = CDS_UPDATEREGISTRY.0 | CDS_NORESET.0;
            if dev == id {
                flags |= CDS_SET_PRIMARY.0;
            }
            let r = unsafe { ChangeDisplaySettingsExW(PCWSTR(name.as_ptr()), Some(&dm), None, ::windows::Win32::Graphics::Gdi::CDS_TYPE(flags), None) };
            if r != DISP_CHANGE_SUCCESSFUL {
                return Err(format!("Windows a refusé de déplacer un écran (code {})", r.0));
            }
        }
        // Tout d'un coup.
        let r = unsafe { ChangeDisplaySettingsExW(PCWSTR::null(), None, None, ::windows::Win32::Graphics::Gdi::CDS_TYPE(0), None) };
        if r != DISP_CHANGE_SUCCESSFUL {
            return Err(format!("Windows n'a pas appliqué le changement d'écran principal (code {})", r.0));
        }
        Ok(())
    }

    /// Éteint les écrans (le PC continue). Un peu plus tard, pour que le clic
    /// qui l'a demandé ne rallume pas tout de suite.
    pub fn screen_off() -> Result<(), String> {
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(600));
            // HWND_BROADCAST : la fenêtre du bureau s'en occupe.
            let _ = unsafe { PostMessageW(Some(HWND(0xffff as *mut _)), WM_SYSCOMMAND, WPARAM(SC_MONITORPOWER as usize), LPARAM(2)) };
        });
        Ok(())
    }
}

#[cfg(not(windows))]
mod stub {
    use super::{Display, Layout, Mode};

    pub fn layout() -> Layout {
        Layout { mode: None, connected: 0 }
    }

    pub fn set_mode(_mode: Mode) -> Result<(), String> {
        Err("seulement sous Windows".into())
    }

    pub fn list() -> Vec<Display> {
        Vec::new()
    }

    pub fn set_primary(_id: &str) -> Result<(), String> {
        Err("seulement sous Windows".into())
    }

    pub fn screen_off() -> Result<(), String> {
        Err("seulement sous Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(id: &str, x: i32, y: i32, primary: bool) -> Display {
        Display { id: id.into(), name: id.into(), primary, internal: false, x, y, width: 1920, height: 1080 }
    }

    #[test]
    fn modes_round_trip() {
        for id in ["internal", "clone", "extend", "external"] {
            let m = Mode::from_id(id).unwrap();
            assert_eq!(Mode::from_topology(m.sdc_flag() as i32), Some(m));
            assert_eq!(serde_json::to_value(m).unwrap(), serde_json::json!(id));
        }
        assert_eq!(Mode::from_id("autre"), None);
        assert_eq!(Mode::from_topology(0), None);
    }

    #[test]
    fn new_primary_moves_to_origin() {
        let list = [d("A", 0, 0, true), d("B", 1920, -200, false)];
        let moves = primary_shift(&list, "B").unwrap();
        assert_eq!(moves, vec![("A".to_string(), -1920, 200), ("B".to_string(), 0, 0)]);
        assert!(primary_shift(&list, "C").is_none());
    }
}
