// Capture → « Enregistrer un GIF », côté Windows : choisir une zone de
// l'écran, puis la photographier dix fois par seconde.
//
// 1. Choisir la zone (`select_area`). L'outil de capture de Windows (celui des
//    captures PNG) ne dit pas OÙ est la zone choisie, il ne rend qu'une image :
//    on fait donc comme la pipette (platform/picker.rs). On photographie le
//    bureau et on l'affiche, assombri, dans une fenêtre Win32 plein écran.
//    On glisse pour tracer un rectangle : la zone redevient claire, avec sa
//    taille en pixels dessous. Un simple clic (ou Entrée) prend tout l'écran
//    sous la souris ; Échap, un clic droit ou une autre fenêtre qui passe
//    devant annulent ; au bout de 2 minutes, la fenêtre se ferme d'elle-même.
// 2. Pendant l'enregistrement :
//    - `Grabber` copie la zone de l'écran (GDI : BitBlt, ou StretchBlt en mode
//      HALFTONE, le lissage de Windows, quand il faut la réduire) dans une
//      image en mémoire, puis y dessine la souris ;
//    - `Outline` entoure la zone d'un cadre rouge, posé à l'EXTÉRIEUR de la
//      zone (il n'est donc jamais sur le GIF), qui laisse passer les clics ;
//    - `hide_from_capture` retire l'île des captures d'écran
//      (WDA_EXCLUDEFROMCAPTURE, Windows 10 version 2004 et plus) : vous la
//      voyez (avec « Arrêter »), le GIF non.
//
// Pas de CAPTUREBLT pendant l'enregistrement (contrairement à la photo de la
// pipette, prise une seule fois) : avec ce drapeau, Windows cache et
// réaffiche la souris à chaque copie, ce qui la fait clignoter dix fois par
// seconde. Le bureau étant composé par Windows (DWM), les menus et les bulles
// sont sur l'image sans lui.
//
// Tout est en pixels physiques (le fil est « conscient du DPI de chaque
// écran ») : une zone à cheval sur deux écrans d'échelles différentes est
// copiée telle quelle. Rien n'est enregistré ici : la photo du bureau de la
// sélection est effacée dès que la fenêtre se ferme.
//
// Sous Linux (vérifications), tout renvoie une erreur « seulement sous Windows ».

// (Sous Linux, les petits calculs ne servent qu'aux tests.)
#![cfg_attr(not(windows), allow(dead_code))]

/// Une zone de l'écran, en pixels physiques, en coordonnées du bureau (un
/// écran placé à gauche du principal a des x négatifs).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Area {
    fn right(&self) -> i32 {
        self.x + self.width as i32
    }

    fn bottom(&self) -> i32 {
        self.y + self.height as i32
    }
}

/// En dessous (largeur ou hauteur, en pixels), le tracé est pris pour un
/// simple clic : tout l'écran sous la souris.
pub const MIN_SIDE: u32 = 16;

/// La zone tracée entre le point d'appui et la souris (dans un sens ou dans
/// l'autre), pixel sous la souris compris, sans sortir de `bounds` (le bureau).
pub fn drag_area(anchor: (i32, i32), cursor: (i32, i32), bounds: Area) -> Area {
    let left = anchor.0.min(cursor.0).max(bounds.x);
    let top = anchor.1.min(cursor.1).max(bounds.y);
    let right = (anchor.0.max(cursor.0) + 1).min(bounds.right());
    let bottom = (anchor.1.max(cursor.1) + 1).min(bounds.bottom());
    Area { x: left, y: top, width: (right - left).max(0) as u32, height: (bottom - top).max(0) as u32 }
}

/// Le tracé est-il assez grand pour être une zone (et pas un simple clic) ?
pub fn is_real_area(a: Area) -> bool {
    a.width >= MIN_SIDE && a.height >= MIN_SIDE
}

/// Où écrire la taille de la zone (« 640 × 480 ») : une étiquette de
/// `label` (largeur, hauteur) sous la zone, ou dedans si la zone touche le bas
/// de l'écran (`screen_bottom`). `gap` = l'écart avec le bord de la zone.
pub fn size_label_at(sel: Area, label: (i32, i32), gap: i32, screen_bottom: i32) -> (i32, i32) {
    let below = sel.bottom() + gap;
    let y = if below + label.1 <= screen_bottom { below } else { (sel.bottom() - gap - label.1).max(sel.y) };
    (sel.x, y)
}

#[cfg(windows)]
pub use self::win::{hide_from_capture, select_area, Grabber, Outline};

#[cfg(not(windows))]
pub use self::stub::{hide_from_capture, select_area, Grabber, Outline};

#[cfg(windows)]
mod win {
    use super::{drag_area, is_real_area, size_label_at, Area};
    use std::cell::RefCell;
    use std::time::{Duration, Instant};

    use tauri::{AppHandle, Manager};
    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        AlphaBlend, BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateDIBSection, CreateFontW,
        CreateSolidBrush, DeleteDC, DeleteObject, DrawTextW, EndPaint, FillRect, FrameRect, GdiFlush, GetDC,
        GetMonitorInfoW, InvalidateRect, MonitorFromPoint, ReleaseDC, SelectObject, SetBkMode, SetBrushOrgEx,
        SetStretchBltMode, SetTextColor, StretchBlt, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION,
        CAPTUREBLT, CLEARTYPE_QUALITY, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DIB_RGB_COLORS, DT_CALCRECT, DT_CENTER,
        DT_LEFT, DT_NOPREFIX, DT_SINGLELINE, DT_VCENTER, FW_SEMIBOLD, HALFTONE, HBITMAP, HDC, HFONT, HGDIOBJ,
        MONITORINFO, MONITOR_DEFAULTTONEAREST, OUT_DEFAULT_PRECIS, PAINTSTRUCT, ROP_CODE, SRCCOPY, TRANSPARENT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::HiDpi::{
        GetDpiForMonitor, SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE, VK_RETURN, VK_SPACE};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, DrawIconEx, GetClientRect, GetCursorInfo,
        GetCursorPos, GetIconInfo, GetMessageW, GetSystemMetrics, KillTimer, LoadCursorW, PeekMessageW,
        PostQuitMessage, RegisterClassExW, SetCursor, SetForegroundWindow, SetLayeredWindowAttributes, SetTimer,
        SetWindowDisplayAffinity, ShowWindow, TranslateMessage, CURSORINFO, CURSOR_SHOWING, DI_NORMAL, HICON,
        ICONINFO, IDC_CROSS, LWA_ALPHA, MSG, PM_REMOVE, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN, SW_SHOW, SW_SHOWNOACTIVATE, WA_INACTIVE, WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WM_ACTIVATE,
        WM_DESTROY, WM_ERASEBKGND, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_PAINT, WM_RBUTTONUP,
        WM_SETCURSOR, WM_TIMER, WNDCLASSEXW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        WS_EX_TRANSPARENT, WS_POPUP,
    };

    /// Au-delà, la sélection se ferme d'elle-même (une fenêtre plein écran
    /// oubliée serait pénible).
    const MAX_OPEN: Duration = Duration::from_secs(120);
    const TIMER_ID: usize = 1;
    /// L'assombrissement du bureau hors de la zone (0 = rien, 255 = noir).
    const DIM: u8 = 110;

    fn rgb(r: u8, g: u8, b: u8) -> COLORREF {
        COLORREF(r as u32 | (g as u32) << 8 | (b as u32) << 16)
    }

    fn win_rect(a: Area) -> RECT {
        RECT { left: a.x, top: a.y, right: a.x + a.width as i32, bottom: a.y + a.height as i32 }
    }

    /// L'écran sous ce point (coordonnées du bureau) et son échelle (1.0 à 100 %).
    fn monitor_at(x: i32, y: i32) -> Option<(Area, f64)> {
        unsafe {
            let monitor = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return None;
            }
            let r = info.rcMonitor;
            let area = Area { x: r.left, y: r.top, width: (r.right - r.left).max(0) as u32, height: (r.bottom - r.top).max(0) as u32 };
            let (mut dx, mut dy) = (96u32, 96u32);
            let scale = if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dx, &mut dy).is_ok() && dx > 0 {
                dx as f64 / 96.0
            } else {
                1.0
            };
            Some((area, scale))
        }
    }

    // ── 1. Choisir la zone ──────────────────────────────────────────────────

    /// Ce que la fenêtre de sélection retient pendant qu'elle est ouverte.
    /// Toutes les positions sont en coordonnées FENÊTRE (= bureau − origin).
    struct Selector {
        hwnd: HWND,
        origin: (i32, i32),
        /// Tout le bureau, en coordonnées fenêtre (0, 0, largeur, hauteur).
        bounds: Area,
        /// La photo du bureau, et la même assombrie.
        shot: HDC,
        shot_bitmap: HBITMAP,
        shot_old: HGDIOBJ,
        dim: HDC,
        dim_bitmap: HBITMAP,
        dim_old: HGDIOBJ,
        font: HFONT,
        /// L'aide en haut de l'écran (« Glissez pour choisir… ») et sa place.
        hint: Vec<u16>,
        hint_box: RECT,
        /// La taille d'un pixel « logique » sur l'écran de départ (1.5 à 150 %).
        scale: f64,
        /// Le bas de l'écran de départ (pour placer l'étiquette de taille).
        screen_bottom: i32,
        /// Le point d'appui du bouton gauche (un tracé est en cours).
        anchor: Option<(i32, i32)>,
        /// La zone tracée.
        selection: Option<Area>,
        activated: bool,
        started: Instant,
        /// Le résultat, en coordonnées du BUREAU.
        chosen: Option<Area>,
        closing: bool,
    }

    impl Selector {
        fn px(&self, v: f64) -> i32 {
            (v * self.scale).round().max(1.0) as i32
        }

        /// La taille de l'étiquette « 1920 × 1080 ».
        fn label_size(&self) -> (i32, i32) {
            (self.px(130.0), self.px(26.0))
        }

        /// Tout ce qui est dessiné autour d'une zone (cadre + étiquette), pour
        /// savoir quoi redessiner quand elle change.
        fn decorations(&self, sel: Area) -> RECT {
            let (lw, lh) = self.label_size();
            let gap = self.px(6.0);
            let (lx, ly) = size_label_at(sel, (lw, lh), gap, self.screen_bottom);
            let r = win_rect(sel);
            RECT {
                left: r.left.min(lx) - 3,
                top: r.top.min(ly) - 3,
                right: r.right.max(lx + lw) + 3,
                bottom: r.bottom.max(ly + lh) + 3,
            }
        }

        /// Tout l'écran sous ce point (coordonnées fenêtre), en coordonnées du bureau.
        fn monitor_choice(&self, p: (i32, i32)) -> Option<Area> {
            monitor_at(p.0 + self.origin.0, p.1 + self.origin.1).map(|(a, _)| a)
        }

        /// Une zone tracée (coordonnées fenêtre) → coordonnées du bureau.
        fn to_desktop(&self, a: Area) -> Area {
            Area { x: a.x + self.origin.0, y: a.y + self.origin.1, ..a }
        }
    }

    thread_local! {
        // Une sélection par fil au plus (le module n'en lance qu'une à la fois).
        static SELECTOR: RefCell<Option<Selector>> = const { RefCell::new(None) };
    }

    /// Libère une image en mémoire (DC + bitmap).
    unsafe fn free_dc(dc: HDC, bitmap: HBITMAP, old: HGDIOBJ) {
        unsafe {
            if !old.is_invalid() {
                SelectObject(dc, old);
            }
            if !bitmap.is_invalid() {
                let _ = DeleteObject(bitmap.into());
            }
            if !dc.is_invalid() {
                let _ = DeleteDC(dc);
            }
        }
    }

    /// Une image en mémoire de la taille du bureau, compatible avec l'écran.
    unsafe fn desktop_image(screen: HDC, size: (i32, i32)) -> Option<(HDC, HBITMAP, HGDIOBJ)> {
        unsafe {
            let dc = CreateCompatibleDC(Some(screen));
            let bitmap = CreateCompatibleBitmap(screen, size.0, size.1);
            if dc.is_invalid() || bitmap.is_invalid() {
                free_dc(dc, bitmap, HGDIOBJ::default());
                return None;
            }
            let old = SelectObject(dc, bitmap.into());
            Some((dc, bitmap, old))
        }
    }

    /// Ouvre la sélection et attend le choix. À appeler sur un fil à part (il
    /// fait tourner sa propre boucle de messages). `hint` = l'aide affichée en
    /// haut de l'écran (déjà traduite par le front). Ok(None) = annulée.
    pub fn select_area(hint: &str) -> Result<Option<Area>, String> {
        unsafe {
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let origin = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
            let size = (GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN));
            if size.0 <= 0 || size.1 <= 0 {
                return Err("écran introuvable".into());
            }

            // La photo du bureau (une seule fois : CAPTUREBLT pour avoir aussi
            // les fenêtres « en couches »), puis sa copie assombrie.
            let screen = GetDC(None);
            if screen.is_invalid() {
                return Err("capture de l'écran impossible".into());
            }
            let (shot, dim) = (desktop_image(screen, size), desktop_image(screen, size));
            let copied = match (shot, dim) {
                (Some((s, _, _)), Some((d, _, _))) => {
                    BitBlt(s, 0, 0, size.0, size.1, Some(screen), origin.0, origin.1, ROP_CODE(SRCCOPY.0 | CAPTUREBLT.0)).is_ok()
                        && BitBlt(d, 0, 0, size.0, size.1, Some(s), 0, 0, SRCCOPY).is_ok()
                }
                _ => false,
            };
            ReleaseDC(None, screen);
            let ((shot, shot_bitmap, shot_old), (dim, dim_bitmap, dim_old)) = match (shot, dim) {
                (Some(s), Some(d)) if copied => (s, d),
                (s, d) => {
                    for (dc, bitmap, old) in [s, d].into_iter().flatten() {
                        free_dc(dc, bitmap, old);
                    }
                    return Err("capture de l'écran impossible (mémoire)".into());
                }
            };
            darken(dim, size);
            let free_all = || {
                free_dc(shot, shot_bitmap, shot_old);
                free_dc(dim, dim_bitmap, dim_old);
            };

            // La fenêtre plein bureau, au-dessus de tout, absente de la barre des tâches.
            let instance = match GetModuleHandleW(None) {
                Ok(h) => h,
                Err(e) => {
                    free_all();
                    return Err(e.to_string());
                }
            };
            let class = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(selector_proc),
                hInstance: instance.into(),
                hCursor: LoadCursorW(None, IDC_CROSS).unwrap_or_default(),
                lpszClassName: w!("OndineZoneGif"),
                ..Default::default()
            };
            // 0 la deuxième fois (classe déjà enregistrée) : ce n'est pas grave.
            RegisterClassExW(&class);
            let hwnd = match CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
                w!("OndineZoneGif"),
                w!("Zone du GIF — Ondine"),
                WS_POPUP,
                origin.0,
                origin.1,
                size.0,
                size.1,
                None,
                None,
                Some(instance.into()),
                None,
            ) {
                Ok(h) => h,
                Err(e) => {
                    free_all();
                    return Err(format!("fenêtre de sélection impossible à ouvrir : {e}"));
                }
            };

            // L'aide, en haut de l'écran où est la souris, à son échelle.
            let mut pt = POINT::default();
            let _ = GetCursorPos(&mut pt);
            let (monitor, scale) = monitor_at(pt.x, pt.y).unwrap_or((Area { x: origin.0, y: origin.1, width: size.0 as u32, height: size.1 as u32 }, 1.0));
            let px = |v: f64| (v * scale).round().max(1.0) as i32;
            let font = CreateFontW(
                -px(15.0),
                0,
                0,
                0,
                FW_SEMIBOLD.0 as i32,
                0,
                0,
                0,
                DEFAULT_CHARSET,
                OUT_DEFAULT_PRECIS,
                CLIP_DEFAULT_PRECIS,
                CLEARTYPE_QUALITY,
                0,
                w!("Segoe UI"),
            );
            let mut hint: Vec<u16> = hint.chars().take(200).collect::<String>().encode_utf16().collect();
            let mut measured = RECT::default();
            let old_font = SelectObject(shot, font.into());
            DrawTextW(shot, &mut hint, &mut measured, DT_CALCRECT | DT_SINGLELINE | DT_NOPREFIX);
            SelectObject(shot, old_font);
            let (tw, th) = (measured.right - measured.left, measured.bottom - measured.top);
            let (bw, bh) = (tw + 2 * px(14.0), th + 2 * px(8.0));
            let mon = Area { x: monitor.x - origin.0, y: monitor.y - origin.1, ..monitor };
            let hint_left = mon.x + (mon.width as i32 - bw) / 2;
            let hint_top = mon.y + px(24.0);
            let hint_box = RECT { left: hint_left, top: hint_top, right: hint_left + bw, bottom: hint_top + bh };

            SELECTOR.with(|s| {
                *s.borrow_mut() = Some(Selector {
                    hwnd,
                    origin,
                    bounds: Area { x: 0, y: 0, width: size.0 as u32, height: size.1 as u32 },
                    shot,
                    shot_bitmap,
                    shot_old,
                    dim,
                    dim_bitmap,
                    dim_old,
                    font,
                    hint,
                    hint_box,
                    scale,
                    screen_bottom: mon.y + mon.height as i32,
                    anchor: None,
                    selection: None,
                    activated: false,
                    started: Instant::now(),
                    chosen: None,
                    closing: false,
                })
            });

            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = SetForegroundWindow(hwnd);
            if let Ok(cross) = LoadCursorW(None, IDC_CROSS) {
                SetCursor(Some(cross));
            }
            // Échap est aussi surveillée « de loin », au cas où Windows nous
            // refuserait le focus clavier.
            SetTimer(Some(hwnd), TIMER_ID, 30, None);

            // La boucle de messages, jusqu'à la fermeture de la fenêtre.
            let mut msg = MSG::default();
            loop {
                let r = GetMessageW(&mut msg, None, 0, 0).0;
                if r == 0 || r == -1 {
                    break;
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            // On range : les photos du bureau sont effacées.
            let state = SELECTOR.with(|s| s.borrow_mut().take());
            let chosen = state.as_ref().and_then(|s| s.chosen);
            if let Some(s) = state {
                free_dc(s.shot, s.shot_bitmap, s.shot_old);
                free_dc(s.dim, s.dim_bitmap, s.dim_old);
                let _ = DeleteObject(s.font.into());
            } else {
                free_all();
                let _ = DeleteObject(font.into());
            }
            Ok(chosen)
        }
    }

    /// Assombrit toute l'image `dc` (un voile noir à demi transparent).
    unsafe fn darken(dc: HDC, size: (i32, i32)) {
        unsafe {
            // Un pixel noir, étiré sur toute l'image avec une transparence constante.
            let black = CreateCompatibleDC(Some(dc));
            let black_bitmap = CreateCompatibleBitmap(dc, 1, 1);
            if black.is_invalid() || black_bitmap.is_invalid() {
                free_dc(black, black_bitmap, HGDIOBJ::default());
                return; // pas assombri : la zone reste quand même visible (cadre blanc)
            }
            let old = SelectObject(black, black_bitmap.into());
            let brush = CreateSolidBrush(rgb(0, 0, 0));
            FillRect(black, &RECT { left: 0, top: 0, right: 1, bottom: 1 }, brush);
            let _ = DeleteObject(brush.into());
            let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: DIM, AlphaFormat: 0 };
            let _ = AlphaBlend(dc, 0, 0, size.0, size.1, black, 0, 0, 1, 1, blend);
            free_dc(black, black_bitmap, old);
        }
    }

    /// x, y d'un message de souris (signés : un écran peut être à gauche du principal).
    fn mouse_xy(lparam: LPARAM) -> (i32, i32) {
        let v = lparam.0 as u32;
        ((v & 0xFFFF) as u16 as i16 as i32, ((v >> 16) & 0xFFFF) as u16 as i16 as i32)
    }

    unsafe extern "system" fn selector_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        // Une panique ne doit jamais traverser Windows (elle arrêterait toute
        // l'appli) : on la rattrape et on ferme la sélection.
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || handle(hwnd, msg, wparam, lparam)));
        match outcome {
            Ok(Some(result)) => result,
            Ok(None) => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
            Err(_) => {
                let _ = unsafe { DestroyWindow(hwnd) };
                LRESULT(0)
            }
        }
    }

    /// Ce qu'il faut faire après avoir relâché SELECTOR (certains appels
    /// Windows renvoient aussitôt un message à la fenêtre : on ne doit pas le
    /// tenir à ce moment-là).
    enum After {
        Nothing,
        Redraw(RECT, RECT),
        Close,
    }

    /// Traite un message. None = laisser Windows faire.
    fn handle(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> Option<LRESULT> {
        match msg {
            WM_ERASEBKGND => return Some(LRESULT(1)), // tout est peint dans WM_PAINT
            WM_PAINT => {
                paint(hwnd);
                return Some(LRESULT(0));
            }
            WM_DESTROY => {
                unsafe {
                    let _ = KillTimer(Some(hwnd), TIMER_ID);
                    PostQuitMessage(0);
                }
                return Some(LRESULT(0));
            }
            WM_SETCURSOR => {
                if let Ok(cross) = unsafe { LoadCursorW(None, IDC_CROSS) } {
                    unsafe { SetCursor(Some(cross)) };
                }
                return Some(LRESULT(1));
            }
            _ => {}
        }

        let after = SELECTOR.with(|cell| {
            let Ok(mut guard) = cell.try_borrow_mut() else { return None };
            let s = guard.as_mut()?;
            let close = |s: &mut Selector, chosen: Option<Area>| {
                s.chosen = chosen;
                s.closing = true;
                After::Close
            };
            let after = match msg {
                WM_LBUTTONDOWN => {
                    s.anchor = Some(mouse_xy(lparam));
                    After::Nothing
                }
                WM_MOUSEMOVE => match s.anchor {
                    Some(anchor) => {
                        let sel = drag_area(anchor, mouse_xy(lparam), s.bounds);
                        let old = s.selection.map(|a| s.decorations(a)).unwrap_or_default();
                        s.selection = Some(sel);
                        After::Redraw(old, s.decorations(sel))
                    }
                    None => After::Nothing,
                },
                // Choisir au relâchement : l'appui ET le relâchement restent
                // pour la sélection (rien n'arrive à la fenêtre d'en dessous).
                WM_LBUTTONUP => match s.anchor {
                    Some(anchor) => {
                        let up = mouse_xy(lparam);
                        let sel = drag_area(anchor, up, s.bounds);
                        let chosen = if is_real_area(sel) { Some(s.to_desktop(sel)) } else { s.monitor_choice(up) };
                        close(s, chosen)
                    }
                    // Le bouton était déjà appuyé à l'ouverture : on attend un vrai clic.
                    None => After::Nothing,
                },
                WM_RBUTTONUP => close(s, None),
                WM_KEYDOWN => {
                    let key = wparam.0 as u16;
                    if key == VK_ESCAPE.0 {
                        close(s, None)
                    } else if key == VK_RETURN.0 || key == VK_SPACE.0 {
                        // Entrée : la zone tracée, ou tout l'écran sous la souris.
                        let chosen = match s.selection {
                            Some(sel) if is_real_area(sel) => Some(s.to_desktop(sel)),
                            _ => {
                                let mut pt = POINT::default();
                                let _ = unsafe { GetCursorPos(&mut pt) };
                                monitor_at(pt.x, pt.y).map(|(a, _)| a)
                            }
                        };
                        close(s, chosen)
                    } else {
                        After::Nothing
                    }
                }
                WM_TIMER => {
                    let escape = unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) } < 0;
                    if escape || s.started.elapsed() > MAX_OPEN {
                        close(s, None)
                    } else {
                        After::Nothing
                    }
                }
                WM_ACTIVATE => {
                    // Une autre fenêtre passe devant (Alt+Tab, touche Windows) : on annule.
                    if (wparam.0 & 0xFFFF) as u32 == WA_INACTIVE {
                        if s.activated && !s.closing {
                            close(s, None)
                        } else {
                            After::Nothing
                        }
                    } else {
                        s.activated = true;
                        After::Nothing
                    }
                }
                _ => return None,
            };
            Some((after, s.hwnd))
        });

        let (after, hwnd) = after?;
        unsafe {
            match after {
                After::Nothing => {}
                After::Redraw(old, new) => {
                    if old.right > old.left {
                        let _ = InvalidateRect(Some(hwnd), Some(&old), false);
                    }
                    let _ = InvalidateRect(Some(hwnd), Some(&new), false);
                }
                After::Close => {
                    let _ = DestroyWindow(hwnd);
                }
            }
        }
        // WM_ACTIVATE : on laisse aussi Windows faire son travail habituel.
        if msg == WM_ACTIVATE {
            return None;
        }
        Some(LRESULT(0))
    }

    /// Redessine la partie demandée : le bureau assombri, la zone claire par-dessus,
    /// son cadre, sa taille, et l'aide. Tout passe par une image intermédiaire,
    /// pour ne pas clignoter.
    fn paint(hwnd: HWND) {
        unsafe {
            let mut ps = PAINTSTRUCT::default();
            let hdc = BeginPaint(hwnd, &mut ps);
            SELECTOR.with(|cell| {
                let Ok(guard) = cell.try_borrow() else { return };
                let Some(s) = guard.as_ref() else { return };
                let area = ps.rcPaint;
                let (w, h) = (area.right - area.left, area.bottom - area.top);
                if w <= 0 || h <= 0 {
                    return;
                }
                let back = CreateCompatibleDC(Some(hdc));
                let back_bitmap = CreateCompatibleBitmap(hdc, w, h);
                if back.is_invalid() || back_bitmap.is_invalid() {
                    // Pas de mémoire pour l'image intermédiaire : le bureau assombri seul.
                    let _ = BitBlt(hdc, area.left, area.top, w, h, Some(s.dim), area.left, area.top, SRCCOPY);
                } else {
                    let old = SelectObject(back, back_bitmap.into());
                    let _ = BitBlt(back, 0, 0, w, h, Some(s.dim), area.left, area.top, SRCCOPY);
                    draw_overlay(back, s, (-area.left, -area.top));
                    let _ = BitBlt(hdc, area.left, area.top, w, h, Some(back), 0, 0, SRCCOPY);
                    SelectObject(back, old);
                }
                free_dc(back, back_bitmap, HGDIOBJ::default());
            });
            let _ = EndPaint(hwnd, &ps);
        }
    }

    /// Dessine la zone, son cadre, sa taille et l'aide dans `dc`, décalés de `off`.
    fn draw_overlay(dc: HDC, s: &Selector, off: (i32, i32)) {
        let shift = |r: RECT| RECT { left: r.left + off.0, top: r.top + off.1, right: r.right + off.0, bottom: r.bottom + off.1 };
        let grow = |r: RECT, d: i32| RECT { left: r.left - d, top: r.top - d, right: r.right + d, bottom: r.bottom + d };
        unsafe {
            let dark = CreateSolidBrush(rgb(24, 24, 27));
            let white = CreateSolidBrush(rgb(255, 255, 255));
            let black = CreateSolidBrush(rgb(0, 0, 0));
            let old_font = SelectObject(dc, s.font.into());
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, rgb(240, 240, 245));

            if let Some(sel) = s.selection {
                // La zone, claire (copiée de la photo d'origine).
                let r = win_rect(sel);
                if sel.width > 0 && sel.height > 0 {
                    let _ = BitBlt(dc, r.left + off.0, r.top + off.1, sel.width as i32, sel.height as i32, Some(s.shot), r.left, r.top, SRCCOPY);
                }
                // Son cadre : blanc, entouré de noir (visible sur tout fond), à l'extérieur.
                FrameRect(dc, &shift(grow(r, 1)), white);
                FrameRect(dc, &shift(grow(r, 2)), black);
                // Sa taille, en pixels.
                let (lw, lh) = s.label_size();
                let (lx, ly) = size_label_at(sel, (lw, lh), s.px(6.0), s.screen_bottom);
                let label = RECT { left: lx, top: ly, right: lx + lw, bottom: ly + lh };
                FillRect(dc, &shift(label), dark);
                let mut text: Vec<u16> = format!("{} × {}", sel.width, sel.height).encode_utf16().collect();
                let mut text_rect = shift(RECT { left: label.left + s.px(8.0), ..label });
                DrawTextW(dc, &mut text, &mut text_rect, DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
            }

            // L'aide, dans un bandeau foncé.
            let line = CreateSolidBrush(rgb(70, 70, 78));
            FillRect(dc, &shift(s.hint_box), dark);
            FrameRect(dc, &shift(s.hint_box), line);
            let mut hint = s.hint.clone();
            let mut hint_rect = shift(s.hint_box);
            DrawTextW(dc, &mut hint, &mut hint_rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);

            SelectObject(dc, old_font);
            for brush in [dark, white, black, line] {
                let _ = DeleteObject(brush.into());
            }
        }
    }

    // ── 2. Copier la zone, dix fois par seconde ────────────────────────────

    /// Copie une zone de l'écran dans une image en mémoire de `out` pixels
    /// (réduite si besoin), souris comprise. À créer, utiliser et lâcher sur
    /// le même fil (celui de l'enregistrement).
    pub struct Grabber {
        screen: HDC,
        mem: HDC,
        bitmap: HBITMAP,
        old: HGDIOBJ,
        /// Les pixels de l'image en mémoire (BGRA, ligne par ligne depuis le haut).
        bits: *const u8,
        area: Area,
        out: (i32, i32),
        cursor: bool,
    }

    impl Grabber {
        pub fn new(area: Area, out_width: u32, out_height: u32, cursor: bool) -> Result<Grabber, String> {
            if area.width == 0 || area.height == 0 || out_width == 0 || out_height == 0 {
                return Err("zone vide".into());
            }
            unsafe {
                SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                let screen = GetDC(None);
                if screen.is_invalid() {
                    return Err("capture de l'écran impossible".into());
                }
                let mem = CreateCompatibleDC(Some(screen));
                if mem.is_invalid() {
                    ReleaseDC(None, screen);
                    return Err("capture de l'écran impossible (mémoire)".into());
                }
                // Une image 32 bits « du haut vers le bas » (hauteur négative) :
                // la ligne 0 est en haut, chaque ligne fait largeur × 4 octets.
                let info = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: out_width as i32,
                        biHeight: -(out_height as i32),
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
                let bitmap = match CreateDIBSection(Some(mem), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
                    Ok(b) if !bits.is_null() => b,
                    Ok(b) => {
                        let _ = DeleteObject(b.into());
                        let _ = DeleteDC(mem);
                        ReleaseDC(None, screen);
                        return Err("capture de l'écran impossible (mémoire)".into());
                    }
                    Err(e) => {
                        let _ = DeleteDC(mem);
                        ReleaseDC(None, screen);
                        return Err(format!("capture de l'écran impossible : {e}"));
                    }
                };
                let old = SelectObject(mem, bitmap.into());
                // Réduire avec le lissage de Windows (sans lui, le texte devient illisible).
                SetStretchBltMode(mem, HALFTONE);
                let _ = SetBrushOrgEx(mem, 0, 0, None);
                Ok(Grabber { screen, mem, bitmap, old, bits: bits as *const u8, area, out: (out_width as i32, out_height as i32), cursor })
            }
        }

        /// Une image de la zone, en RGB (largeur × hauteur × 3 octets).
        pub fn grab(&mut self) -> Result<Vec<u8>, String> {
            let a = self.area;
            let (ow, oh) = self.out;
            unsafe {
                let copied = if (ow, oh) == (a.width as i32, a.height as i32) {
                    BitBlt(self.mem, 0, 0, ow, oh, Some(self.screen), a.x, a.y, SRCCOPY).is_ok()
                } else {
                    StretchBlt(self.mem, 0, 0, ow, oh, Some(self.screen), a.x, a.y, a.width as i32, a.height as i32, SRCCOPY).as_bool()
                };
                if !copied {
                    // (Par exemple pendant l'écran de verrouillage ou un changement de session.)
                    return Err("copie de l'écran impossible".into());
                }
                if self.cursor {
                    self.draw_cursor();
                }
                // GDI peut garder des dessins en attente : on les termine avant de lire.
                let _ = GdiFlush();
                let len = ow as usize * oh as usize * 4;
                let bgra = std::slice::from_raw_parts(self.bits, len);
                let mut rgb = Vec::with_capacity(ow as usize * oh as usize * 3);
                for px in bgra.chunks_exact(4) {
                    rgb.extend_from_slice(&[px[2], px[1], px[0]]);
                }
                Ok(rgb)
            }
        }

        /// Dessine la souris (si elle est visible) à sa place dans l'image.
        unsafe fn draw_cursor(&self) {
            unsafe {
                let mut info = CURSORINFO { cbSize: std::mem::size_of::<CURSORINFO>() as u32, ..Default::default() };
                if GetCursorInfo(&mut info).is_err() || info.flags.0 & CURSOR_SHOWING.0 == 0 || info.hCursor.is_invalid() {
                    return;
                }
                let icon = HICON(info.hCursor.0);
                // Le « point chaud » : le pixel du curseur qui est vraiment sous la souris.
                let mut hot = (0, 0);
                let mut icon_info = ICONINFO::default();
                if GetIconInfo(icon, &mut icon_info).is_ok() {
                    hot = (icon_info.xHotspot as i32, icon_info.yHotspot as i32);
                    // GetIconInfo crée des copies des images du curseur : à libérer.
                    if !icon_info.hbmMask.is_invalid() {
                        let _ = DeleteObject(icon_info.hbmMask.into());
                    }
                    if !icon_info.hbmColor.is_invalid() {
                        let _ = DeleteObject(icon_info.hbmColor.into());
                    }
                }
                let a = self.area;
                let sx = self.out.0 as f64 / a.width as f64;
                let sy = self.out.1 as f64 / a.height as f64;
                let x = ((info.ptScreenPos.x - a.x) as f64 * sx).round() as i32 - hot.0;
                let y = ((info.ptScreenPos.y - a.y) as f64 * sy).round() as i32 - hot.1;
                // Hors de la zone : rien à dessiner (DrawIconEx couperait de toute façon).
                if x > self.out.0 || y > self.out.1 || x < -256 || y < -256 {
                    return;
                }
                // Taille réelle du curseur (0, 0) : bien visible même sur un GIF réduit.
                let _ = DrawIconEx(self.mem, x, y, icon, 0, 0, 0, None, DI_NORMAL);
            }
        }
    }

    impl Drop for Grabber {
        fn drop(&mut self) {
            unsafe {
                free_dc(self.mem, self.bitmap, self.old);
                ReleaseDC(None, self.screen);
            }
        }
    }

    // ── Le cadre rouge autour de la zone ───────────────────────────────────

    /// Quatre fines fenêtres rouges autour de la zone (à l'extérieur), au-dessus
    /// de tout, qui laissent passer les clics et ne prennent jamais le focus.
    /// À créer, faire vivre (`pump`) et lâcher sur le même fil.
    pub struct Outline {
        sides: Vec<HWND>,
    }

    /// Épaisseur du cadre, en pixels.
    const BORDER: i32 = 3;

    impl Outline {
        pub fn show(area: Area) -> Outline {
            let mut sides = Vec::new();
            unsafe {
                let Ok(instance) = GetModuleHandleW(None) else { return Outline { sides } };
                let class = WNDCLASSEXW {
                    cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                    lpfnWndProc: Some(outline_proc),
                    hInstance: instance.into(),
                    lpszClassName: w!("OndineCadreGif"),
                    ..Default::default()
                };
                RegisterClassExW(&class);
                let (l, t, r, b) = (area.x, area.y, area.x + area.width as i32, area.y + area.height as i32);
                let rects = [
                    (l - BORDER, t - BORDER, r - l + 2 * BORDER, BORDER), // haut
                    (l - BORDER, b, r - l + 2 * BORDER, BORDER),          // bas
                    (l - BORDER, t, BORDER, b - t),                       // gauche
                    (r, t, BORDER, b - t),                                // droite
                ];
                for (x, y, w, h) in rects {
                    let Ok(hwnd) = CreateWindowExW(
                        WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED | WS_EX_TRANSPARENT,
                        w!("OndineCadreGif"),
                        w!("Cadre du GIF — Ondine"),
                        WS_POPUP,
                        x,
                        y,
                        w,
                        h,
                        None,
                        None,
                        Some(instance.into()),
                        None,
                    ) else {
                        continue;
                    };
                    // Une fenêtre « en couches » doit dire son opacité pour s'afficher.
                    let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 230, LWA_ALPHA);
                    // Jamais sur une capture (au cas où le cadre déborderait sur la zone).
                    let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
                    let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                    sides.push(hwnd);
                }
            }
            let outline = Outline { sides };
            outline.pump();
            outline
        }

        /// Traite les messages en attente (dessin du cadre). À appeler souvent.
        pub fn pump(&self) {
            unsafe {
                let mut msg = MSG::default();
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }
    }

    impl Drop for Outline {
        fn drop(&mut self) {
            unsafe {
                for hwnd in self.sides.drain(..) {
                    let _ = DestroyWindow(hwnd);
                }
            }
            self.pump();
        }
    }

    unsafe extern "system" fn outline_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        // (Une panique ne doit jamais traverser Windows : voir selector_proc.)
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            if msg != WM_ERASEBKGND {
                return None;
            }
            // Le fond, en rouge (celui du bouton d'enregistrement).
            unsafe {
                let mut r = RECT::default();
                let _ = GetClientRect(hwnd, &mut r);
                let red = CreateSolidBrush(rgb(232, 52, 52));
                FillRect(HDC(wparam.0 as *mut _), &r, red);
                let _ = DeleteObject(red.into());
            }
            Some(LRESULT(1))
        }));
        match outcome {
            Ok(Some(result)) => result,
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    // ── L'île, absente du GIF ──────────────────────────────────────────────

    /// Retire l'île des captures d'écran (`hide` = true) ou l'y remet. Vrai si
    /// Windows a accepté (Windows 10 version 2004 et plus). Fait sur le fil
    /// principal, celui qui a créé la fenêtre de l'île.
    pub fn hide_from_capture(app: &AppHandle, hide: bool) -> bool {
        let Some(win) = app.get_webview_window(crate::island::WINDOW_LABEL) else { return false };
        let Ok(raw) = win.hwnd().map(|h| h.0 as isize) else { return false };
        let (tx, rx) = std::sync::mpsc::channel();
        let sent = app.run_on_main_thread(move || {
            let hwnd = HWND(raw as *mut _);
            let affinity = if hide { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
            let _ = tx.send(unsafe { SetWindowDisplayAffinity(hwnd, affinity) }.is_ok());
        });
        sent.is_ok() && rx.recv_timeout(Duration::from_secs(2)).unwrap_or(false)
    }
}

#[cfg(not(windows))]
mod stub {
    use super::Area;
    use tauri::AppHandle;

    const ONLY_WINDOWS: &str = "disponible seulement sous Windows";

    pub fn select_area(_hint: &str) -> Result<Option<Area>, String> {
        Err(ONLY_WINDOWS.into())
    }

    pub struct Grabber;

    impl Grabber {
        pub fn new(_area: Area, _w: u32, _h: u32, _cursor: bool) -> Result<Grabber, String> {
            Err(ONLY_WINDOWS.into())
        }

        pub fn grab(&mut self) -> Result<Vec<u8>, String> {
            Err(ONLY_WINDOWS.into())
        }
    }

    pub struct Outline;

    impl Outline {
        pub fn show(_area: Area) -> Outline {
            Outline
        }

        pub fn pump(&self) {}
    }

    pub fn hide_from_capture(_app: &AppHandle, _hide: bool) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DESK: Area = Area { x: 0, y: 0, width: 1920, height: 1080 };

    #[test]
    fn a_drag_gives_the_area_in_either_direction() {
        let a = drag_area((100, 50), (299, 149), DESK);
        assert_eq!(a, Area { x: 100, y: 50, width: 200, height: 100 });
        // De bas en haut, de droite à gauche : la même zone.
        assert_eq!(drag_area((299, 149), (100, 50), DESK), a);
        // Le pixel sous la souris est compris : un clic sur place = 1 × 1.
        assert_eq!(drag_area((10, 10), (10, 10), DESK), Area { x: 10, y: 10, width: 1, height: 1 });
    }

    #[test]
    fn a_drag_stays_on_the_desktop() {
        let a = drag_area((1900, 1000), (5000, 5000), DESK);
        assert_eq!(a, Area { x: 1900, y: 1000, width: 20, height: 80 });
        // Un écran à gauche du principal : des x négatifs.
        let wide = Area { x: -2560, y: 0, width: 4480, height: 1440 };
        assert_eq!(drag_area((-100, 10), (-3000, 20), wide), Area { x: -2560, y: 10, width: 2461, height: 11 });
    }

    #[test]
    fn a_tiny_drag_is_a_click() {
        assert!(!is_real_area(drag_area((10, 10), (12, 40), DESK)));
        assert!(!is_real_area(drag_area((10, 10), (10, 10), DESK)));
        assert!(is_real_area(drag_area((10, 10), (25, 25), DESK)));
    }

    #[test]
    fn the_size_label_goes_below_or_inside_at_the_bottom() {
        let sel = Area { x: 100, y: 100, width: 300, height: 200 };
        assert_eq!(size_label_at(sel, (130, 26), 6, 1080), (100, 306));
        // Zone collée en bas de l'écran : l'étiquette passe dedans.
        let low = Area { x: 0, y: 900, width: 300, height: 180 };
        assert_eq!(size_label_at(low, (130, 26), 6, 1080), (0, 1048));
    }
}
