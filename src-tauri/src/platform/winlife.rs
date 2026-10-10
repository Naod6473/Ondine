// Les autres fenêtres de Windows, pour « Ondine et les fenêtres » (module
// windowlife, island/dodge.rs) : la fenêtre au premier plan et sa place, les
// bulles de notification, la session verrouillée, quelques pixels de l'écran,
// et les seuls gestes permis sur une autre fenêtre : la coller à un bord
// (comme Windows + flèche), l'agrandir, la restaurer, la réduire. Jamais la
// fermer.
//
// Les rectangles sont en px physiques de l'écran (gauche, haut, droite, bas),
// sans les bordures invisibles de Windows 10/11 (DWMWA_EXTENDED_FRAME_BOUNDS).

/// Une fenêtre principale.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Win {
    pub hwnd: isize,
    /// Gauche, haut, droite, bas (px physiques, sans bordure invisible).
    pub rect: (i32, i32, i32, i32),
    pub maximized: bool,
    pub minimized: bool,
    /// Une fenêtre d'Ondine elle-même (île, réglages, mascotte…).
    pub own: bool,
    pub title: String,
    pub class: String,
    /// Le rectangle de son écran, et celui de la zone de travail (sans barre des tâches).
    pub monitor: (i32, i32, i32, i32),
    pub work: (i32, i32, i32, i32),
}

#[cfg(windows)]
mod imp {
    use super::Win;
    use ::windows::core::BOOL;
    use ::windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use ::windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use ::windows::Win32::Graphics::Gdi::{GetDC, GetMonitorInfoW, GetPixel, MonitorFromWindow, ReleaseDC, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use ::windows::Win32::System::StationsAndDesktops::{CloseDesktop, OpenInputDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_SWITCHDESKTOP};
    use ::windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow,
        IsWindowVisible, IsZoomed, SetWindowPos, ShowWindow, SystemParametersInfoW, GWL_EXSTYLE, GW_OWNER, SPI_GETCLIENTAREAANIMATION, SWP_NOACTIVATE, SWP_NOZORDER,
        SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, WS_EX_TOOLWINDOW,
    };

    fn h(hwnd: isize) -> HWND {
        HWND(hwnd as *mut _)
    }

    fn rect4(r: RECT) -> (i32, i32, i32, i32) {
        (r.left, r.top, r.right, r.bottom)
    }

    /// Le rectangle visible (sans les bordures invisibles), sinon celui de Windows.
    fn bounds(w: HWND) -> Option<RECT> {
        let mut r = RECT::default();
        let dwm = unsafe { DwmGetWindowAttribute(w, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut _ as *mut _, std::mem::size_of::<RECT>() as u32) };
        if dwm.is_ok() {
            return Some(r);
        }
        unsafe { GetWindowRect(w, &mut r) }.ok().map(|_| r)
    }

    /// Cachée par Windows (bureau virtuel, appli UWP suspendue) bien que « visible ».
    fn cloaked(w: HWND) -> bool {
        let mut c = 0u32;
        let ok = unsafe { DwmGetWindowAttribute(w, DWMWA_CLOAKED, &mut c as *mut _ as *mut _, 4) }.is_ok();
        ok && c != 0
    }

    fn text(w: HWND) -> (String, String) {
        let mut t = [0u16; 256];
        let mut c = [0u16; 128];
        let nt = unsafe { GetWindowTextW(w, &mut t) }.max(0) as usize;
        let nc = unsafe { GetClassNameW(w, &mut c) }.max(0) as usize;
        (String::from_utf16_lossy(&t[..nt]), String::from_utf16_lossy(&c[..nc]))
    }

    fn describe(w: HWND) -> Option<Win> {
        if w.0.is_null() || !unsafe { IsWindow(Some(w)) }.as_bool() {
            return None;
        }
        let r = bounds(w)?;
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(w, Some(&mut pid)) };
        let (title, class) = text(w);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let mon = unsafe { MonitorFromWindow(w, MONITOR_DEFAULTTONEAREST) };
        let _ = unsafe { GetMonitorInfoW(mon, &mut mi) };
        Some(Win {
            hwnd: w.0 as isize,
            rect: rect4(r),
            maximized: unsafe { IsZoomed(w) }.as_bool(),
            minimized: unsafe { IsIconic(w) }.as_bool(),
            own: pid == std::process::id(),
            title,
            class,
            monitor: rect4(mi.rcMonitor),
            work: rect4(mi.rcWork),
        })
    }

    pub fn foreground() -> Option<Win> {
        describe(unsafe { GetForegroundWindow() })
    }

    /// Les fenêtres principales visibles (titre, sans propriétaire, pas une
    /// fenêtre outil, pas cachée par Windows), de la plus haute à la plus basse.
    pub fn top_windows() -> Vec<Win> {
        unsafe extern "system" fn collect(w: HWND, lparam: LPARAM) -> BOOL {
            let list = unsafe { &mut *(lparam.0 as *mut Vec<isize>) };
            unsafe {
                let tool = (GetWindowLongPtrW(w, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0) != 0;
                if IsWindowVisible(w).as_bool() && !tool && GetWindow(w, GW_OWNER).is_err() {
                    list.push(w.0 as isize);
                }
            }
            BOOL(1)
        }
        let mut raw: Vec<isize> = Vec::new();
        let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut raw as *mut _ as isize)) };
        raw.into_iter().filter(|w| !cloaked(h(*w))).filter_map(|w| describe(h(w))).filter(|w| !w.title.is_empty()).collect()
    }

    /// Les bulles de notification de Windows affichées en ce moment : des
    /// fenêtres « Windows.UI.Core.CoreWindow » visibles, petites, dans le coin
    /// bas droit de leur écran (heuristique : Windows n'a pas d'API pour ça).
    pub fn toast_rects() -> Vec<(i32, i32, i32, i32)> {
        unsafe extern "system" fn collect(w: HWND, lparam: LPARAM) -> BOOL {
            let list = unsafe { &mut *(lparam.0 as *mut Vec<isize>) };
            if unsafe { IsWindowVisible(w) }.as_bool() {
                list.push(w.0 as isize);
            }
            BOOL(1)
        }
        let mut raw: Vec<isize> = Vec::new();
        let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut raw as *mut _ as isize)) };
        raw.into_iter()
            .filter(|w| !cloaked(h(*w)))
            .filter_map(|w| describe(h(w)))
            .filter(|w| w.class == "Windows.UI.Core.CoreWindow" && super::looks_like_toast(w.rect, w.work))
            .map(|w| w.rect)
            .collect()
    }

    /// « Réduire les animations » de Windows (Accessibilité → Effets visuels) :
    /// c'est aussi ce que la page voit comme prefers-reduced-motion.
    pub fn reduced_motion() -> bool {
        let mut on = BOOL(1);
        let ok = unsafe { SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, Some(&mut on as *mut _ as *mut _), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)) }.is_ok();
        ok && !on.as_bool()
    }

    /// La session est verrouillée (ou l'écran de connexion est affiché) : le
    /// bureau « normal » n'est plus celui qui reçoit le clavier.
    pub fn session_locked() -> bool {
        match unsafe { OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_SWITCHDESKTOP) } {
            Ok(d) => {
                let _ = unsafe { CloseDesktop(d) };
                false
            }
            Err(_) => true,
        }
    }

    /// La luminosité moyenne (0 à 1) de quelques points d'un rectangle de l'écran.
    pub fn brightness(r: (i32, i32, i32, i32)) -> Option<f64> {
        let dc = unsafe { GetDC(None) };
        if dc.is_invalid() {
            return None;
        }
        let mut sum = 0.0;
        let mut n = 0.0;
        for (fx, fy) in super::SAMPLES {
            let x = r.0 + ((r.2 - r.0) as f64 * fx) as i32;
            let y = r.1 + ((r.3 - r.1) as f64 * fy) as i32;
            let c = unsafe { GetPixel(dc, x, y) }.0;
            if c == u32::MAX {
                continue; // CLR_INVALID : hors de l'écran
            }
            sum += super::luma((c & 0xff) as u8, ((c >> 8) & 0xff) as u8, ((c >> 16) & 0xff) as u8);
            n += 1.0;
        }
        unsafe { ReleaseDC(None, dc) };
        (n > 0.0).then(|| sum / n)
    }

    /// Une fenêtre qu'on a le droit de bouger : existe, visible, pas à Ondine.
    fn movable(hwnd: isize) -> Result<HWND, String> {
        let w = h(hwnd);
        let info = describe(w).ok_or("fenêtre introuvable")?;
        if info.own || !unsafe { IsWindowVisible(w) }.as_bool() {
            return Err("fenêtre refusée".into());
        }
        Ok(w)
    }

    /// Colle la fenêtre à ce rectangle visible (px physiques), en tenant compte
    /// de ses bordures invisibles. Une fenêtre agrandie est d'abord restaurée.
    pub fn place(hwnd: isize, target: (i32, i32, i32, i32)) -> Result<(), String> {
        let w = movable(hwnd)?;
        if unsafe { IsZoomed(w) }.as_bool() {
            let _ = unsafe { ShowWindow(w, SW_RESTORE) };
        }
        let mut outer = RECT::default();
        unsafe { GetWindowRect(w, &mut outer) }.map_err(|e| e.to_string())?;
        let visible = bounds(w).unwrap_or(outer);
        // Les bordures invisibles de chaque côté.
        let (bl, bt, br, bb) = (visible.left - outer.left, visible.top - outer.top, outer.right - visible.right, outer.bottom - visible.bottom);
        let (x, y) = (target.0 - bl, target.1 - bt);
        let (cx, cy) = (target.2 - target.0 + bl + br, target.3 - target.1 + bt + bb);
        unsafe { SetWindowPos(w, None, x, y, cx, cy, SWP_NOZORDER | SWP_NOACTIVATE) }.map_err(|e| e.to_string())
    }

    pub fn maximize(hwnd: isize) -> Result<(), String> {
        let w = movable(hwnd)?;
        let _ = unsafe { ShowWindow(w, SW_MAXIMIZE) };
        Ok(())
    }

    pub fn restore(hwnd: isize) -> Result<(), String> {
        let w = movable(hwnd)?;
        let _ = unsafe { ShowWindow(w, SW_RESTORE) };
        Ok(())
    }

    /// Réduit la fenêtre dans la barre des tâches (jamais fermée).
    pub fn minimize(hwnd: isize) -> Result<(), String> {
        let w = movable(hwnd)?;
        let _ = unsafe { ShowWindow(w, SW_MINIMIZE) };
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Win;
    pub fn foreground() -> Option<Win> {
        None
    }
    pub fn top_windows() -> Vec<Win> {
        Vec::new()
    }
    pub fn toast_rects() -> Vec<(i32, i32, i32, i32)> {
        Vec::new()
    }
    pub fn reduced_motion() -> bool {
        false
    }
    pub fn session_locked() -> bool {
        false
    }
    pub fn brightness(_r: (i32, i32, i32, i32)) -> Option<f64> {
        None
    }
    pub fn place(_hwnd: isize, _target: (i32, i32, i32, i32)) -> Result<(), String> {
        Err("seulement sous Windows".into())
    }
    pub fn maximize(_hwnd: isize) -> Result<(), String> {
        Err("seulement sous Windows".into())
    }
    pub fn restore(_hwnd: isize) -> Result<(), String> {
        Err("seulement sous Windows".into())
    }
    pub fn minimize(_hwnd: isize) -> Result<(), String> {
        Err("seulement sous Windows".into())
    }
}

pub use imp::*;

/// Les points mesurés pour la luminosité (fractions du rectangle) : une grille
/// de 3 × 3, un peu en retrait des bords (barre de titre, bordures).
pub const SAMPLES: [(f64, f64); 9] = [(0.2, 0.25), (0.5, 0.25), (0.8, 0.25), (0.2, 0.55), (0.5, 0.55), (0.8, 0.55), (0.2, 0.85), (0.5, 0.85), (0.8, 0.85)];

/// La luminosité perçue d'une couleur (0 à 1, coefficients Rec. 709).
pub fn luma(r: u8, g: u8, b: u8) -> f64 {
    (0.2126 * r as f64 + 0.7152 * g as f64 + 0.0722 * b as f64) / 255.0
}

/// Une bulle de notification ? Petite (moins de 600 × 800 px physiques… mise à
/// l'échelle comprise), et dans le quart bas droit de la zone de travail.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn looks_like_toast(r: (i32, i32, i32, i32), work: (i32, i32, i32, i32)) -> bool {
    let (w, h) = (r.2 - r.0, r.3 - r.1);
    let small = w > 40 && h > 40 && w < 900 && h < 1200;
    let mid_x = (work.0 + work.2) / 2;
    let mid_y = (work.1 + work.3) / 2;
    small && r.0 >= mid_x && r.1 >= mid_y && r.2 <= work.2 + 16 && r.3 <= work.3 + 16
}

#[cfg(test)]
mod tests {
    use super::{looks_like_toast, luma};

    #[test]
    fn luma_of_white_black_and_grey() {
        assert!((luma(255, 255, 255) - 1.0).abs() < 1e-9);
        assert_eq!(luma(0, 0, 0), 0.0);
        assert!(luma(0, 255, 0) > luma(255, 0, 0));
    }

    #[test]
    fn toasts_are_small_and_in_the_bottom_right_corner() {
        let work = (0, 0, 1920, 1032);
        // Une bulle de 364 × 110 juste au-dessus de la barre des tâches.
        assert!(looks_like_toast((1544, 910, 1908, 1020), work));
        // Une fenêtre normale au centre, ou toute la zone : non.
        assert!(!looks_like_toast((500, 300, 1400, 900), work));
        assert!(!looks_like_toast((0, 0, 1920, 1032), work));
        // Le menu Démarrer (à gauche) : non.
        assert!(!looks_like_toast((300, 400, 900, 1020), work));
    }
}
