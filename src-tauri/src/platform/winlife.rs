// Les autres fenêtres de Windows, pour « Ondine et les fenêtres » (module
// windowlife, island/dodge.rs) : la fenêtre au premier plan et sa place, les
// bulles de notification, la session verrouillée, quelques pixels de l'écran,
// et les seuls gestes permis sur une autre fenêtre : la coller à un bord
// (comme Windows + flèche), l'agrandir, la restaurer, la réduire, et pour le
// « trou noir » la cacher (ShowWindow SW_HIDE) puis la réafficher. Jamais la
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

/// Ce qu'il faut savoir d'une fenêtre avant de l'avaler (trou noir) : le tri
/// lui-même est du code pur, testé (modules/windowlife_hole.rs, `may_swallow`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Candidate {
    pub hwnd: isize,
    pub pid: u32,
    /// Une fenêtre d'Ondine elle-même.
    pub own: bool,
    pub class: String,
    pub title: String,
    pub visible: bool,
    /// Cachée par Windows (autre bureau virtuel, appli suspendue).
    pub cloaked: bool,
    /// Une fenêtre principale (GetAncestor GA_ROOT = elle-même).
    pub root: bool,
    /// Style enfant (WS_CHILD) ou fenêtre outil (WS_EX_TOOLWINDOW).
    pub child: bool,
    pub tool: bool,
    /// A une fenêtre propriétaire (une boîte de dialogue).
    pub owned: bool,
    /// Ne répond plus (IsHungAppWindow).
    pub hung: bool,
    /// Son programme tourne en administrateur et pas Ondine (ou on ne peut pas
    /// le savoir) : on ne serait pas sûr de pouvoir la réafficher.
    pub elevated: bool,
    /// Son rectangle visible et celui de son écran (px physiques).
    pub rect: (i32, i32, i32, i32),
    pub monitor: (i32, i32, i32, i32),
}

/// Où était une fenêtre (sa place « normale », en coordonnées de la zone de
/// travail comme WINDOWPLACEMENT, et si elle était agrandie) : le trou noir la
/// recrache là, et pas au-dessus de l'île où on l'a lâchée.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Placement {
    pub normal: (i32, i32, i32, i32),
    pub maximized: bool,
}

/// Le déplacement d'une fenêtre par sa barre de titre (ou son redimensionnement
/// par un bord : Windows ne les distingue pas), vu par `watch_drags`.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum DragEvent {
    /// Le début : la fenêtre principale, sa place et sa taille à ce moment.
    Start { hwnd: isize, placement: Option<Placement>, size: (i32, i32) },
    /// La fin (bouton lâché) : la souris à cet instant (px physiques).
    End { hwnd: isize, cursor: (i32, i32) },
}

#[cfg(windows)]
mod imp {
    use super::{Candidate, DragEvent, Placement, Win};
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

    // ── Le trou noir ─────────────────────────────────────────────────────────

    /// Ce qu'il faut savoir d'une fenêtre pour décider si on peut l'avaler.
    pub fn candidate(hwnd: isize) -> Option<Candidate> {
        use ::windows::Win32::UI::WindowsAndMessaging::{GetAncestor, IsHungAppWindow, GA_ROOT, GWL_STYLE, WS_CHILD};
        let w = h(hwnd);
        let info = describe(w)?;
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(w, Some(&mut pid)) };
        let style = unsafe { GetWindowLongPtrW(w, GWL_STYLE) } as u32;
        let ex = unsafe { GetWindowLongPtrW(w, GWL_EXSTYLE) } as u32;
        let elevated = !crate::platform::is_elevated() && process_elevated(pid) != Some(false);
        Some(Candidate {
            hwnd,
            pid,
            own: info.own,
            class: info.class,
            title: info.title,
            visible: unsafe { IsWindowVisible(w) }.as_bool(),
            cloaked: cloaked(w),
            root: unsafe { GetAncestor(w, GA_ROOT) } == w,
            child: style & WS_CHILD.0 != 0,
            tool: ex & WS_EX_TOOLWINDOW.0 != 0,
            owned: unsafe { GetWindow(w, GW_OWNER) }.is_ok_and(|o| !o.0.is_null()),
            hung: unsafe { IsHungAppWindow(w) }.as_bool(),
            elevated,
            rect: info.rect,
            monitor: info.monitor,
        })
    }

    /// Le programme `pid` tourne-t-il en administrateur ? None : on ne peut
    /// pas le savoir (Windows refuse de nous le dire, ce qui arrive justement
    /// pour un programme administrateur vu d'un programme normal).
    fn process_elevated(pid: u32) -> Option<bool> {
        use ::windows::Win32::Foundation::{CloseHandle, HANDLE};
        use ::windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
        use ::windows::Win32::System::Threading::{OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION};
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut token = HANDLE::default();
            let opened = OpenProcessToken(process, TOKEN_QUERY, &mut token).is_ok();
            let _ = CloseHandle(process);
            if !opened {
                return None;
            }
            let mut info = TOKEN_ELEVATION::default();
            let mut len = 0u32;
            let ok = GetTokenInformation(token, TokenElevation, Some(&mut info as *mut TOKEN_ELEVATION as *mut _), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut len).is_ok();
            let _ = CloseHandle(token);
            ok.then_some(info.TokenIsElevated != 0)
        }
    }

    /// La place d'une fenêtre (WINDOWPLACEMENT), sans envoyer de message à son programme.
    fn placement(w: HWND) -> Option<Placement> {
        use ::windows::Win32::UI::WindowsAndMessaging::{GetWindowPlacement, SW_SHOWMAXIMIZED, WINDOWPLACEMENT};
        let mut wp = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
        unsafe { GetWindowPlacement(w, &mut wp) }.ok()?;
        Some(Placement { normal: rect4(wp.rcNormalPosition), maximized: wp.showCmd == SW_SHOWMAXIMIZED.0 as u32 })
    }

    fn outer_size(w: HWND) -> Option<(i32, i32)> {
        let mut r = RECT::default();
        unsafe { GetWindowRect(w, &mut r) }.ok()?;
        Some((r.right - r.left, r.bottom - r.top))
    }

    /// La taille extérieure d'une fenêtre (pour reconnaître un redimensionnement).
    pub fn window_size(hwnd: isize) -> Option<(i32, i32)> {
        outer_size(h(hwnd))
    }

    /// La fenêtre existe-t-elle encore, toujours à ce programme ? Et est-elle visible ?
    pub fn window_state(hwnd: isize, pid: u32) -> (bool, bool) {
        let w = h(hwnd);
        if !unsafe { IsWindow(Some(w)) }.as_bool() {
            return (false, false);
        }
        let mut owner = 0u32;
        unsafe { GetWindowThreadProcessId(w, Some(&mut owner)) };
        (owner == pid, unsafe { IsWindowVisible(w) }.as_bool())
    }

    /// Attend (au plus `ms`) que la fenêtre soit visible ou cachée.
    fn wait_visible(w: HWND, visible: bool, ms: u64) -> bool {
        let until = std::time::Instant::now() + std::time::Duration::from_millis(ms);
        loop {
            if unsafe { IsWindowVisible(w) }.as_bool() == visible {
                return true;
            }
            if std::time::Instant::now() >= until {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
    }

    /// Cache la fenêtre : ShowWindowAsync(SW_HIDE), RIEN d'autre (ni fermée, ni
    /// déplacée). Une fenêtre cachée n'est plus ni à l'écran, ni dans la barre
    /// des tâches, ni dans Alt+Tab ; son programme continue de tourner. La
    /// version « Async » ne nous bloque jamais si le programme est occupé.
    /// Err si Windows ne l'a pas cachée (on la réaffiche alors par précaution).
    pub fn hide(hwnd: isize) -> Result<(), String> {
        use ::windows::Win32::UI::WindowsAndMessaging::{ShowWindowAsync, SW_HIDE, SW_SHOWNA};
        let w = h(hwnd);
        if !unsafe { IsWindow(Some(w)) }.as_bool() {
            return Err("fenêtre introuvable".into());
        }
        let _ = unsafe { ShowWindowAsync(w, SW_HIDE) };
        if wait_visible(w, false, 600) {
            return Ok(());
        }
        // Refusée (programme administrateur…) : si elle se cachait plus tard,
        // on ne la perdrait pas pour autant.
        let _ = unsafe { ShowWindowAsync(w, SW_SHOWNA) };
        Err("Windows n'a pas caché la fenêtre".into())
    }

    /// Réaffiche une fenêtre avalée. `placement` : sa place d'avant (remise
    /// pendant qu'elle est encore cachée, sauf si son programme ne répond
    /// plus) ; `front` : au premier plan (un clic de l'utilisateur), sinon
    /// sans lui donner le focus (sortie d'Ondine, reprise après un plantage).
    pub fn show_again(hwnd: isize, placement: Option<Placement>, front: bool) -> Result<(), String> {
        use ::windows::Win32::UI::WindowsAndMessaging::{
            BringWindowToTop, GetWindowPlacement, IsHungAppWindow, SetForegroundWindow, SetWindowPlacement, ShowWindowAsync, SW_HIDE, SW_SHOW, SW_SHOWMAXIMIZED, SW_SHOWNA, WINDOWPLACEMENT,
            WINDOWPLACEMENT_FLAGS,
        };
        let w = h(hwnd);
        if !unsafe { IsWindow(Some(w)) }.as_bool() {
            return Err("fenêtre fermée".into());
        }
        let hung = unsafe { IsHungAppWindow(w) }.as_bool();
        if let Some(p) = placement.filter(|_| !hung) {
            let mut wp = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
            if unsafe { GetWindowPlacement(w, &mut wp) }.is_ok() && !unsafe { IsWindowVisible(w) }.as_bool() {
                wp.rcNormalPosition = RECT { left: p.normal.0, top: p.normal.1, right: p.normal.2, bottom: p.normal.3 };
                // Toujours cachée pendant qu'on la replace : elle n'apparaît qu'une fois, au bon endroit.
                wp.showCmd = SW_HIDE.0 as u32;
                wp.flags = WINDOWPLACEMENT_FLAGS(0);
                let _ = unsafe { SetWindowPlacement(w, &wp) };
            }
        }
        let maximized = placement.is_some_and(|p| p.maximized);
        let cmd = if !front || hung {
            if maximized && !hung {
                SW_SHOWMAXIMIZED
            } else {
                SW_SHOWNA
            }
        } else if maximized {
            SW_SHOWMAXIMIZED
        } else {
            SW_SHOW
        };
        let _ = unsafe { ShowWindowAsync(w, cmd) };
        if !wait_visible(w, true, 600) {
            return Err("Windows n'a pas encore réaffiché la fenêtre".into());
        }
        if front && !hung {
            unsafe {
                let _ = BringWindowToTop(w);
                let _ = SetForegroundWindow(w);
            }
            // L'île, en se refermant, ne doit pas reprendre la main.
            crate::platform::forget_previous_foreground();
        }
        Ok(())
    }

    /// L'icône de la fenêtre en PNG de 32 × 32 (WM_GETICON, sinon celle de sa
    /// classe), ou None. Le message attend au plus 150 ms : un programme
    /// occupé n'a simplement pas d'icône dans la liste.
    pub fn icon_png(hwnd: isize) -> Option<Vec<u8>> {
        use ::windows::Win32::Foundation::{LPARAM, WPARAM};
        use ::windows::Win32::Graphics::Gdi::{
            CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
        };
        use ::windows::Win32::UI::WindowsAndMessaging::{
            DrawIconEx, GetClassLongPtrW, SendMessageTimeoutW, DI_MASK, DI_NORMAL, GCLP_HICON, GCLP_HICONSM, HICON, ICON_BIG, ICON_SMALL, ICON_SMALL2, SMTO_ABORTIFHUNG, SMTO_BLOCK,
            WM_GETICON,
        };
        const SIZE: i32 = 32;
        let w = h(hwnd);
        let mut icon = 0usize;
        for kind in [ICON_BIG, ICON_SMALL2, ICON_SMALL] {
            let mut r = 0usize;
            let ok = unsafe { SendMessageTimeoutW(w, WM_GETICON, WPARAM(kind as usize), LPARAM(0), SMTO_ABORTIFHUNG | SMTO_BLOCK, 150, Some(&mut r)) };
            if ok.0 != 0 && r != 0 {
                icon = r;
                break;
            }
        }
        if icon == 0 {
            icon = unsafe { GetClassLongPtrW(w, GCLP_HICON) };
        }
        if icon == 0 {
            icon = unsafe { GetClassLongPtrW(w, GCLP_HICONSM) };
        }
        if icon == 0 {
            return None;
        }
        let icon = HICON(icon as *mut _);
        unsafe {
            let dc = CreateCompatibleDC(None);
            if dc.is_invalid() {
                return None;
            }
            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: SIZE,
                    biHeight: -SIZE, // de haut en bas
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let Ok(bmp) = CreateDIBSection(Some(dc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0) else {
                let _ = DeleteDC(dc);
                return None;
            };
            let old = SelectObject(dc, HGDIOBJ(bmp.0));
            let n = (SIZE * SIZE * 4) as usize;
            let pixels = std::slice::from_raw_parts_mut(bits as *mut u8, n);
            let drawn = DrawIconEx(dc, 0, 0, icon, SIZE, SIZE, 0, None, DI_NORMAL).is_ok();
            let mut bgra = pixels.to_vec();
            // Une vieille icône sans couche alpha : le masque dit ce qui est transparent.
            if drawn && bgra.chunks(4).all(|p| p[3] == 0) {
                pixels.fill(0);
                if DrawIconEx(dc, 0, 0, icon, SIZE, SIZE, 0, None, DI_MASK).is_ok() {
                    for (px, m) in bgra.chunks_mut(4).zip(pixels.chunks(4)) {
                        px[3] = if m[0] == 0 { 255 } else { 0 };
                    }
                }
            }
            SelectObject(dc, old);
            let _ = DeleteObject(HGDIOBJ(bmp.0));
            let _ = DeleteDC(dc);
            if !drawn {
                return None;
            }
            for px in bgra.chunks_mut(4) {
                px.swap(0, 2);
            }
            let mut out = std::io::Cursor::new(Vec::new());
            image::write_buffer_with_format(&mut out, &bgra, SIZE as u32, SIZE as u32, image::ExtendedColorType::Rgba8, image::ImageFormat::Png).ok()?;
            Some(out.into_inner())
        }
    }

    /// Le fil qui écoute les déplacements de fenêtres tant qu'il existe.
    pub struct DragWatch {
        thread: u32,
    }

    impl Drop for DragWatch {
        fn drop(&mut self) {
            use ::windows::Win32::Foundation::{LPARAM, WPARAM};
            use ::windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
            let _ = unsafe { PostThreadMessageW(self.thread, WM_QUIT, WPARAM(0), LPARAM(0)) };
        }
    }

    thread_local! {
        /// Où envoyer les événements (le crochet appelle `on_move_size` sur ce fil-ci).
        static DRAGS: std::cell::RefCell<Option<std::sync::mpsc::Sender<DragEvent>>> = const { std::cell::RefCell::new(None) };
    }

    unsafe extern "system" fn on_move_size(_hook: ::windows::Win32::UI::Accessibility::HWINEVENTHOOK, event: u32, hwnd: HWND, id_object: i32, _child: i32, _thread: u32, _time: u32) {
        use ::windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetCursorPos, EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZESTART, GA_ROOT};
        // OBJID_WINDOW seulement (pas une barre de défilement…).
        if id_object != 0 || hwnd.0.is_null() {
            return;
        }
        let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let root = if root.0.is_null() { hwnd } else { root };
        let msg = if event == EVENT_SYSTEM_MOVESIZESTART {
            // Lu tout de suite : sa place d'avant le déplacement, et sa taille
            // (une taille qui change ensuite = un redimensionnement par un bord).
            DragEvent::Start { hwnd: root.0 as isize, placement: placement(root), size: outer_size(root).unwrap_or_default() }
        } else if event == EVENT_SYSTEM_MOVESIZEEND {
            let mut p = ::windows::Win32::Foundation::POINT::default();
            let _ = unsafe { GetCursorPos(&mut p) };
            DragEvent::End { hwnd: root.0 as isize, cursor: (p.x, p.y) }
        } else {
            return;
        };
        DRAGS.with(|d| {
            if let Some(tx) = d.borrow().as_ref() {
                let _ = tx.send(msg);
            }
        });
    }

    /// Écoute le début et la fin des déplacements de fenêtres des autres
    /// programmes : SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART…END) hors
    /// contexte (rien n'est injecté dans les autres programmes, pas de crochet
    /// souris), sur un fil à lui avec sa boucle de messages. Deux événements par
    /// déplacement, rien entre les deux. S'arrête quand le DragWatch est lâché.
    pub fn watch_drags(tx: std::sync::mpsc::Sender<DragEvent>) -> Option<DragWatch> {
        use ::windows::Win32::System::Threading::GetCurrentThreadId;
        use ::windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent};
        use ::windows::Win32::UI::WindowsAndMessaging::{GetMessageW, EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZESTART, MSG, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS};
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Option<u32>>();
        let spawned = std::thread::Builder::new().name("ondine-trou-noir".into()).spawn(move || {
            DRAGS.with(|d| *d.borrow_mut() = Some(tx));
            let hook = unsafe { SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART, EVENT_SYSTEM_MOVESIZEEND, None, Some(on_move_size), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS) };
            if hook.is_invalid() {
                let _ = ready_tx.send(None);
                return;
            }
            let _ = ready_tx.send(Some(unsafe { GetCurrentThreadId() }));
            let mut msg = MSG::default();
            // GetMessageW : 0 pour WM_QUIT, -1 en cas d'erreur.
            while unsafe { GetMessageW(&mut msg, None, 0, 0) }.0 > 0 {}
            let _ = unsafe { UnhookWinEvent(hook) };
            DRAGS.with(|d| *d.borrow_mut() = None);
        });
        spawned.ok()?;
        let thread = ready_rx.recv_timeout(std::time::Duration::from_secs(2)).ok()??;
        Some(DragWatch { thread })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{Candidate, DragEvent, Placement, Win};
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
    pub fn candidate(_hwnd: isize) -> Option<Candidate> {
        None
    }
    pub fn window_size(_hwnd: isize) -> Option<(i32, i32)> {
        None
    }
    pub fn window_state(_hwnd: isize, _pid: u32) -> (bool, bool) {
        (false, false)
    }
    pub fn hide(_hwnd: isize) -> Result<(), String> {
        Err("seulement sous Windows".into())
    }
    pub fn show_again(_hwnd: isize, _placement: Option<Placement>, _front: bool) -> Result<(), String> {
        Err("seulement sous Windows".into())
    }
    pub fn icon_png(_hwnd: isize) -> Option<Vec<u8>> {
        None
    }
    pub struct DragWatch;
    pub fn watch_drags(_tx: std::sync::mpsc::Sender<DragEvent>) -> Option<DragWatch> {
        None
    }
}

pub use imp::*;

/// Les points mesurés pour la luminosité (fractions du rectangle) : une grille
/// de 3 × 3, un peu en retrait des bords (barre de titre, bordures).
#[cfg_attr(not(windows), allow(dead_code))]
pub const SAMPLES: [(f64, f64); 9] = [(0.2, 0.25), (0.5, 0.25), (0.8, 0.25), (0.2, 0.55), (0.5, 0.55), (0.8, 0.55), (0.2, 0.85), (0.5, 0.85), (0.8, 0.85)];

/// La luminosité perçue d'une couleur (0 à 1, coefficients Rec. 709).
#[cfg_attr(not(windows), allow(dead_code))]
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
