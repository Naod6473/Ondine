// La pipette : choisir une couleur n'importe où à l'écran.
//
// Comment ça marche (Windows) :
//   1. on photographie tout le bureau (tous les écrans) dans une image en
//      mémoire (GDI, `BitBlt` depuis l'écran) ;
//   2. on ouvre une fenêtre Win32 sans bordure, au-dessus de tout, de la taille
//      du bureau, qui affiche cette photo : l'écran a l'air « figé » ;
//   3. la souris y devient une croix ; une loupe suit la souris et montre les
//      pixels autour, agrandis, avec la couleur du pixel du centre ;
//   4. un clic gauche (ou Entrée) choisit la couleur, Échap ou un clic droit
//      annule. Les flèches du clavier déplacent la souris d'un pixel.
//
// Pourquoi une fenêtre Win32 et pas une page (WebView2) comme l'annotation ?
//   - sous WebView2, une fenêtre créée après le démarrage peut rester blanche
//     (voir create_hidden_window dans lib.rs) ; il faudrait en créer une de
//     plus au démarrage, cachée, pour un outil qui sert quelques secondes ;
//   - la photo du bureau pèse des dizaines de Mo (deux écrans 4K) : l'envoyer à
//     une page coûterait cher, ici elle ne quitte pas la mémoire de Windows ;
//   - avec des écrans d'échelles différentes (100 % et 150 %), une page
//     étalée sur plusieurs écrans n'a qu'une seule échelle : les pixels ne
//     tomberaient pas juste. Ici tout est en pixels physiques (le fil est
//     « conscient du DPI de chaque écran ») : le pixel lu est celui sous la croix.
//   - lire la photo plutôt que l'écran en direct (GetPixel sur l'écran) : la
//     loupe et la croix ne peuvent pas se retrouver dans la couleur lue.
//
// Rien n'est enregistré ni envoyé : la photo est effacée quand la pipette se ferme.
//
// Sous Linux (vérifications), `pick` renvoie une erreur « seulement sous Windows ».

// (Sous Linux, le calcul de la loupe ne sert qu'aux tests.)
#![cfg_attr(not(windows), allow(dead_code))]

/// Un rectangle en pixels : gauche, haut, droite, bas (droite et bas exclus).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// Nombre de pixels de l'écran montrés de chaque côté dans la loupe (impair :
/// le pixel choisi est au centre).
pub const GRID: i32 = 11;

/// Où dessiner la loupe : la loupe elle-même (carré des pixels agrandis) et
/// l'étiquette dessous (pastille + « #3A7BD5 »).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LoupeLayout {
    /// Tout le cadre (loupe + étiquette), pour savoir quoi redessiner.
    pub frame: Rect,
    /// Le carré des pixels agrandis.
    pub zoom: Rect,
    /// La taille d'un pixel agrandi.
    pub cell: i32,
    /// La bande de l'étiquette.
    pub label: Rect,
}

/// Calcule la place de la loupe : en bas à droite de la souris, ou de l'autre
/// côté si elle sortirait de l'écran où est la souris (`screen`). `scale` =
/// l'échelle de cet écran (1.0 à 100 %, 1.5 à 150 %…). Tout est en pixels de
/// la fenêtre de la pipette.
pub fn loupe_layout(cursor: (i32, i32), screen: Rect, scale: f64) -> LoupeLayout {
    let px = |v: f64| (v * scale).round().max(1.0) as i32;
    let cell = px(10.0);
    let gap = px(22.0);
    let pad = px(4.0);
    let label_h = px(28.0);
    let side = GRID * cell;
    let width = side + 2 * pad;
    let height = side + 3 * pad + label_h;

    let (cx, cy) = cursor;
    let mut x = cx + gap;
    if x + width > screen.right {
        x = cx - gap - width;
    }
    let mut y = cy + gap;
    if y + height > screen.bottom {
        y = cy - gap - height;
    }
    // Un écran minuscule : on reste au moins dans son coin haut-gauche.
    x = x.max(screen.left);
    y = y.max(screen.top);

    let frame = Rect { left: x, top: y, right: x + width, bottom: y + height };
    let zoom = Rect { left: x + pad, top: y + pad, right: x + pad + side, bottom: y + pad + side };
    let label = Rect { left: x + pad, top: zoom.bottom + pad, right: x + pad + side, bottom: zoom.bottom + pad + label_h };
    LoupeLayout { frame, zoom, cell, label }
}

#[cfg(windows)]
pub use self::win::pick;

#[cfg(not(windows))]
pub use self::stub::pick;

#[cfg(windows)]
mod win {
    use super::{loupe_layout, LoupeLayout, Rect, GRID};
    use std::cell::RefCell;
    use std::time::{Duration, Instant};

    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateFontW, CreateSolidBrush, DeleteDC,
        DeleteObject, DrawTextW, EndPaint, FillRect, FrameRect, GetDC, GetMonitorInfoW, GetPixel, InvalidateRect,
        MonitorFromPoint, ReleaseDC, SelectObject, SetBkMode, SetStretchBltMode, SetTextColor, StretchBlt, CAPTUREBLT,
        CLEARTYPE_QUALITY, CLIP_DEFAULT_PRECIS, CLR_INVALID, COLORONCOLOR, DEFAULT_CHARSET, DT_LEFT, DT_NOPREFIX,
        DT_SINGLELINE, DT_VCENTER, FW_SEMIBOLD, HBITMAP, HDC, HGDIOBJ, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        OUT_DEFAULT_PRECIS, PAINTSTRUCT, ROP_CODE, SRCCOPY, TRANSPARENT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::HiDpi::{
        GetDpiForMonitor, SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_DOWN, VK_ESCAPE, VK_LEFT, VK_RETURN, VK_RIGHT, VK_SPACE, VK_UP,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, GetMessageW, GetSystemMetrics,
        KillTimer, LoadCursorW, PostQuitMessage, RegisterClassExW, SetCursor, SetCursorPos, SetForegroundWindow,
        SetTimer, ShowWindow, TranslateMessage, IDC_CROSS, MSG, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SW_SHOW, WA_INACTIVE, WM_ACTIVATE, WM_DESTROY, WM_ERASEBKGND, WM_KEYDOWN,
        WM_LBUTTONUP, WM_MOUSEMOVE, WM_PAINT, WM_RBUTTONUP, WM_SETCURSOR, WM_TIMER, WNDCLASSEXW, WS_EX_TOOLWINDOW,
        WS_EX_TOPMOST, WS_POPUP,
    };

    /// Au-delà, la pipette se ferme d'elle-même (une fenêtre plein écran
    /// oubliée serait pénible).
    const MAX_OPEN: Duration = Duration::from_secs(120);
    const TIMER_ID: usize = 1;

    /// Ce que la fenêtre de la pipette retient pendant qu'elle est ouverte.
    struct Picker {
        hwnd: HWND,
        /// Coin haut-gauche du bureau (tous écrans), en coordonnées d'écran.
        /// Les coordonnées « fenêtre » = écran − origin.
        origin: (i32, i32),
        size: (i32, i32),
        /// La photo du bureau, dans un DC en mémoire.
        shot: HDC,
        shot_bitmap: HBITMAP,
        shot_old: HGDIOBJ,
        /// La souris, en coordonnées fenêtre.
        cursor: (i32, i32),
        /// Où la loupe est dessinée en ce moment.
        loupe: LoupeLayout,
        /// La fenêtre a-t-elle déjà eu le focus ? (la perdre ensuite = annuler)
        activated: bool,
        started: Instant,
        /// Le résultat : Some(couleur) si on a cliqué.
        picked: Option<(u8, u8, u8)>,
        /// Fermer dès que possible (hors de l'emprunt de PICKER).
        closing: bool,
    }

    thread_local! {
        // Une pipette par fil au plus (le module n'en lance qu'une à la fois).
        static PICKER: RefCell<Option<Picker>> = const { RefCell::new(None) };
    }

    /// Ouvre la pipette et attend le choix. À appeler sur un fil à part (il fait
    /// tourner sa propre boucle de messages). Ok(None) = annulée.
    pub fn pick() -> Result<Option<(u8, u8, u8)>, String> {
        unsafe {
            // Pixels physiques partout, quel que soit l'écran et son échelle.
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let origin = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
            let size = (GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN));
            if size.0 <= 0 || size.1 <= 0 {
                return Err("écran introuvable".into());
            }

            // 1. La photo du bureau. CAPTUREBLT : avec les fenêtres « en couches »
            //    (menus, bulles, fenêtres transparentes).
            let screen = GetDC(None);
            if screen.is_invalid() {
                return Err("capture de l'écran impossible".into());
            }
            let shot = CreateCompatibleDC(Some(screen));
            let shot_bitmap = CreateCompatibleBitmap(screen, size.0, size.1);
            if shot.is_invalid() || shot_bitmap.is_invalid() {
                if !shot_bitmap.is_invalid() {
                    let _ = DeleteObject(shot_bitmap.into());
                }
                if !shot.is_invalid() {
                    let _ = DeleteDC(shot);
                }
                ReleaseDC(None, screen);
                return Err("capture de l'écran impossible (mémoire)".into());
            }
            let shot_old = SelectObject(shot, shot_bitmap.into());
            let copied = BitBlt(shot, 0, 0, size.0, size.1, Some(screen), origin.0, origin.1, ROP_CODE(SRCCOPY.0 | CAPTUREBLT.0));
            ReleaseDC(None, screen);
            let free_shot = || {
                SelectObject(shot, shot_old);
                let _ = DeleteObject(shot_bitmap.into());
                let _ = DeleteDC(shot);
            };
            if copied.is_err() {
                free_shot();
                return Err("capture de l'écran impossible".into());
            }

            // 2. La fenêtre plein bureau, au-dessus de tout, absente de la barre des tâches.
            let instance = GetModuleHandleW(None).map_err(|e| e.to_string());
            let instance = match instance {
                Ok(h) => h,
                Err(e) => {
                    free_shot();
                    return Err(e);
                }
            };
            let class = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(wndproc),
                hInstance: instance.into(),
                // La croix, tant que la souris est sur la fenêtre (= partout).
                hCursor: LoadCursorW(None, IDC_CROSS).unwrap_or_default(),
                lpszClassName: w!("OndinePipette"),
                ..Default::default()
            };
            // 0 la deuxième fois (classe déjà enregistrée) : ce n'est pas grave.
            RegisterClassExW(&class);
            let hwnd = match CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
                w!("OndinePipette"),
                w!("Pipette — Ondine"),
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
                    free_shot();
                    return Err(format!("fenêtre de la pipette impossible à ouvrir : {e}"));
                }
            };

            let mut pt = POINT::default();
            let _ = GetCursorPos(&mut pt);
            let cursor = (pt.x - origin.0, pt.y - origin.1);
            let loupe = layout_for(origin, cursor);
            PICKER.with(|p| {
                *p.borrow_mut() = Some(Picker {
                    hwnd,
                    origin,
                    size,
                    shot,
                    shot_bitmap,
                    shot_old,
                    cursor,
                    loupe,
                    activated: false,
                    started: Instant::now(),
                    picked: None,
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

            // 3. La boucle de messages, jusqu'à la fermeture de la fenêtre.
            let mut msg = MSG::default();
            loop {
                let r = GetMessageW(&mut msg, None, 0, 0).0;
                if r == 0 || r == -1 {
                    break;
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            // 4. On range : la photo est effacée.
            let state = PICKER.with(|p| p.borrow_mut().take());
            let picked = state.as_ref().and_then(|s| s.picked);
            if let Some(s) = state {
                SelectObject(s.shot, s.shot_old);
                let _ = DeleteObject(s.shot_bitmap.into());
                let _ = DeleteDC(s.shot);
            }
            Ok(picked)
        }
    }

    /// L'échelle et le rectangle (en coordonnées fenêtre) de l'écran sous ce point.
    fn screen_at(origin: (i32, i32), cursor: (i32, i32)) -> (Rect, f64) {
        unsafe {
            let pt = POINT { x: cursor.0 + origin.0, y: cursor.1 + origin.1 };
            let monitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            let rect = if GetMonitorInfoW(monitor, &mut info).as_bool() {
                let r = info.rcMonitor;
                Rect { left: r.left - origin.0, top: r.top - origin.1, right: r.right - origin.0, bottom: r.bottom - origin.1 }
            } else {
                Rect { left: i32::MIN / 2, top: i32::MIN / 2, right: i32::MAX / 2, bottom: i32::MAX / 2 }
            };
            let (mut dx, mut dy) = (96u32, 96u32);
            let scale = if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dx, &mut dy).is_ok() && dx > 0 {
                dx as f64 / 96.0
            } else {
                1.0
            };
            (rect, scale)
        }
    }

    fn layout_for(origin: (i32, i32), cursor: (i32, i32)) -> LoupeLayout {
        let (screen, scale) = screen_at(origin, cursor);
        loupe_layout(cursor, screen, scale)
    }

    fn win_rect(r: Rect) -> RECT {
        RECT { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }

    /// La couleur du pixel (x, y) de la photo, en (rouge, vert, bleu).
    fn color_at(p: &Picker, x: i32, y: i32) -> (u8, u8, u8) {
        let x = x.clamp(0, p.size.0 - 1);
        let y = y.clamp(0, p.size.1 - 1);
        let c = unsafe { GetPixel(p.shot, x, y) }.0;
        if c == CLR_INVALID {
            return (0, 0, 0);
        }
        // COLORREF = 0x00BBGGRR
        ((c & 0xFF) as u8, ((c >> 8) & 0xFF) as u8, ((c >> 16) & 0xFF) as u8)
    }

    /// x, y d'un message de souris (signés : un écran peut être à gauche du principal).
    fn mouse_xy(lparam: LPARAM) -> (i32, i32) {
        let v = lparam.0 as u32;
        ((v & 0xFFFF) as u16 as i16 as i32, ((v >> 16) & 0xFFFF) as u16 as i16 as i32)
    }

    unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        // Une panique ne doit jamais traverser Windows (elle arrêterait toute
        // l'appli) : on la rattrape et on ferme la pipette.
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

    /// Ce qu'il faut faire après avoir relâché PICKER (certains appels Windows
    /// renvoient aussitôt un message à la fenêtre : on ne doit pas le tenir à ce moment-là).
    enum After {
        Nothing,
        Redraw(Rect, Rect),
        Close,
        MoveCursor(i32, i32),
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

        let after = PICKER.with(|cell| {
            let Ok(mut guard) = cell.try_borrow_mut() else { return None };
            let p = guard.as_mut()?;
            let after = match msg {
                WM_MOUSEMOVE => {
                    let cursor = mouse_xy(lparam);
                    if cursor == p.cursor {
                        After::Nothing
                    } else {
                        let old = p.loupe.frame;
                        p.cursor = cursor;
                        p.loupe = layout_for(p.origin, cursor);
                        After::Redraw(old, p.loupe.frame)
                    }
                }
                // Choisir au relâchement : l'appui ET le relâchement restent
                // pour la pipette (rien n'arrive à la fenêtre d'en dessous).
                WM_LBUTTONUP => {
                    let (x, y) = mouse_xy(lparam);
                    p.picked = Some(color_at(p, x, y));
                    p.closing = true;
                    After::Close
                }
                WM_RBUTTONUP => {
                    p.closing = true;
                    After::Close
                }
                WM_KEYDOWN => {
                    let key = wparam.0 as u16;
                    let (x, y) = (p.cursor.0 + p.origin.0, p.cursor.1 + p.origin.1);
                    if key == VK_ESCAPE.0 {
                        p.closing = true;
                        After::Close
                    } else if key == VK_RETURN.0 || key == VK_SPACE.0 {
                        p.picked = Some(color_at(p, p.cursor.0, p.cursor.1));
                        p.closing = true;
                        After::Close
                    } else if key == VK_LEFT.0 {
                        After::MoveCursor(x - 1, y)
                    } else if key == VK_RIGHT.0 {
                        After::MoveCursor(x + 1, y)
                    } else if key == VK_UP.0 {
                        After::MoveCursor(x, y - 1)
                    } else if key == VK_DOWN.0 {
                        After::MoveCursor(x, y + 1)
                    } else {
                        After::Nothing
                    }
                }
                WM_TIMER => {
                    let escape = unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) } < 0;
                    if escape || p.started.elapsed() > MAX_OPEN {
                        p.closing = true;
                        After::Close
                    } else {
                        After::Nothing
                    }
                }
                WM_ACTIVATE => {
                    // Une autre fenêtre passe devant (Alt+Tab, touche Windows) : on annule.
                    if (wparam.0 & 0xFFFF) as u32 == WA_INACTIVE {
                        if p.activated && !p.closing {
                            p.closing = true;
                            After::Close
                        } else {
                            After::Nothing
                        }
                    } else {
                        p.activated = true;
                        After::Nothing
                    }
                }
                _ => return None,
            };
            Some((after, p.hwnd))
        });

        let (after, hwnd) = after?;
        unsafe {
            match after {
                After::Nothing => {}
                After::Redraw(old, new) => {
                    let (a, b) = (win_rect(old), win_rect(new));
                    let _ = InvalidateRect(Some(hwnd), Some(&a), false);
                    let _ = InvalidateRect(Some(hwnd), Some(&b), false);
                }
                After::Close => {
                    let _ = DestroyWindow(hwnd);
                }
                After::MoveCursor(x, y) => {
                    let _ = SetCursorPos(x, y);
                }
            }
        }
        // WM_ACTIVATE et WM_KEYDOWN : on laisse aussi Windows faire son travail habituel.
        if msg == WM_ACTIVATE {
            return None;
        }
        Some(LRESULT(0))
    }

    /// Redessine la partie demandée : la photo, puis la loupe par-dessus. Tout
    /// passe par une image intermédiaire, pour ne pas clignoter.
    fn paint(hwnd: HWND) {
        unsafe {
            let mut ps = PAINTSTRUCT::default();
            let hdc = BeginPaint(hwnd, &mut ps);
            PICKER.with(|cell| {
                let Ok(guard) = cell.try_borrow() else { return };
                let Some(p) = guard.as_ref() else { return };
                let area = ps.rcPaint;
                let (w, h) = (area.right - area.left, area.bottom - area.top);
                if w <= 0 || h <= 0 {
                    return;
                }
                let back = CreateCompatibleDC(Some(hdc));
                let back_bitmap = CreateCompatibleBitmap(hdc, w, h);
                if back.is_invalid() || back_bitmap.is_invalid() {
                    // Pas de mémoire pour l'image intermédiaire : la photo seule, directement.
                    let _ = BitBlt(hdc, area.left, area.top, w, h, Some(p.shot), area.left, area.top, SRCCOPY);
                } else {
                    let old = SelectObject(back, back_bitmap.into());
                    let _ = BitBlt(back, 0, 0, w, h, Some(p.shot), area.left, area.top, SRCCOPY);
                    draw_loupe(back, p, (-area.left, -area.top));
                    let _ = BitBlt(hdc, area.left, area.top, w, h, Some(back), 0, 0, SRCCOPY);
                    SelectObject(back, old);
                }
                if !back_bitmap.is_invalid() {
                    let _ = DeleteObject(back_bitmap.into());
                }
                if !back.is_invalid() {
                    let _ = DeleteDC(back);
                }
            });
            let _ = EndPaint(hwnd, &ps);
        }
    }

    /// Dessine la loupe dans `dc`, décalée de `off` (l'image intermédiaire ne
    /// couvre qu'une partie de la fenêtre).
    fn draw_loupe(dc: HDC, p: &Picker, off: (i32, i32)) {
        let shift = |r: Rect| RECT { left: r.left + off.0, top: r.top + off.1, right: r.right + off.0, bottom: r.bottom + off.1 };
        let l = p.loupe;
        let (r, g, b) = color_at(p, p.cursor.0, p.cursor.1);
        let rgb = |r: u8, g: u8, b: u8| COLORREF(r as u32 | (g as u32) << 8 | (b as u32) << 16);
        unsafe {
            // Le fond (gris très foncé), comme l'île.
            let dark = CreateSolidBrush(rgb(24, 24, 27));
            FillRect(dc, &shift(l.frame), dark);

            // Les pixels autour de la souris, agrandis sans lissage. Au bord du
            // bureau, la partie hors de l'écran reste foncée.
            let half = GRID / 2;
            let (sx, sy) = (p.cursor.0 - half, p.cursor.1 - half);
            let (x0, y0) = (sx.max(0), sy.max(0));
            let (x1, y1) = ((sx + GRID).min(p.size.0), (sy + GRID).min(p.size.1));
            if x1 > x0 && y1 > y0 {
                SetStretchBltMode(dc, COLORONCOLOR);
                let _ = StretchBlt(
                    dc,
                    l.zoom.left + off.0 + (x0 - sx) * l.cell,
                    l.zoom.top + off.1 + (y0 - sy) * l.cell,
                    (x1 - x0) * l.cell,
                    (y1 - y0) * l.cell,
                    Some(p.shot),
                    x0,
                    y0,
                    x1 - x0,
                    y1 - y0,
                    SRCCOPY,
                );
            }

            // Le pixel du centre : un cadre blanc entouré de noir (visible sur tout fond).
            let cx = l.zoom.left + half * l.cell;
            let cy = l.zoom.top + half * l.cell;
            let center = Rect { left: cx, top: cy, right: cx + l.cell, bottom: cy + l.cell };
            let grow = |r: Rect, d: i32| Rect { left: r.left - d, top: r.top - d, right: r.right + d, bottom: r.bottom + d };
            let black = CreateSolidBrush(rgb(0, 0, 0));
            let white = CreateSolidBrush(rgb(255, 255, 255));
            FrameRect(dc, &shift(grow(center, 2)), black);
            FrameRect(dc, &shift(grow(center, 1)), white);
            FrameRect(dc, &shift(center), white);

            // Le contour de la loupe.
            let line = CreateSolidBrush(rgb(70, 70, 78));
            FrameRect(dc, &shift(l.frame), line);

            // L'étiquette : une pastille de la couleur, puis « #3A7BD5 ».
            let lab = l.label;
            let swatch_side = (lab.bottom - lab.top) - 2 * (l.cell / 3).max(2);
            let sw_top = lab.top + ((lab.bottom - lab.top) - swatch_side) / 2;
            let swatch = Rect { left: lab.left + 2, top: sw_top, right: lab.left + 2 + swatch_side, bottom: sw_top + swatch_side };
            let fill = CreateSolidBrush(rgb(r, g, b));
            FillRect(dc, &shift(swatch), fill);
            FrameRect(dc, &shift(swatch), white);

            let font_px = (lab.bottom - lab.top) * 13 / 28;
            let font = CreateFontW(
                -font_px.max(8),
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
            let old_font = SelectObject(dc, font.into());
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, rgb(240, 240, 245));
            let mut text: Vec<u16> = format!("#{r:02X}{g:02X}{b:02X}").encode_utf16().collect();
            let mut text_rect = shift(Rect { left: swatch.right + swatch_side / 2, ..lab });
            DrawTextW(dc, &mut text, &mut text_rect, DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
            SelectObject(dc, old_font);

            for obj in [dark, black, white, line, fill] {
                let _ = DeleteObject(obj.into());
            }
            let _ = DeleteObject(font.into());
        }
    }
}

#[cfg(not(windows))]
mod stub {
    pub fn pick() -> Result<Option<(u8, u8, u8)>, String> {
        Err("disponible seulement sous Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect { left: 0, top: 0, right: 1920, bottom: 1080 };

    #[test]
    fn loupe_goes_bottom_right_of_the_cursor() {
        let l = loupe_layout((500, 400), SCREEN, 1.0);
        assert!(l.frame.left > 500 && l.frame.top > 400);
        assert_eq!(l.cell, 10);
        assert_eq!(l.zoom.right - l.zoom.left, GRID * 10);
        // L'étiquette est sous la loupe, dans le cadre.
        assert!(l.label.top >= l.zoom.bottom && l.label.bottom <= l.frame.bottom);
    }

    #[test]
    fn loupe_flips_near_the_edges() {
        let l = loupe_layout((1910, 1075), SCREEN, 1.0);
        assert!(l.frame.right < 1910, "à gauche de la souris");
        assert!(l.frame.bottom < 1075, "au-dessus de la souris");
        assert!(l.frame.left >= 0 && l.frame.top >= 0);
    }

    #[test]
    fn loupe_follows_the_scale_and_other_screens() {
        // Un 2e écran à gauche du principal (coordonnées négatives), à 150 %.
        let left = Rect { left: -2560, top: 0, right: 0, bottom: 1440 };
        let l = loupe_layout((-20, 100), left, 1.5);
        assert_eq!(l.cell, 15);
        assert!(l.frame.right <= 0, "la loupe reste sur l'écran de la souris");
    }
}
