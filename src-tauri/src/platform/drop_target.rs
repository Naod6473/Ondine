// La cible de dépôt de l'île (Windows) : ce qui reçoit les fichiers glissés.
//
// Pourquoi on l'écrit nous-mêmes : WebView2 pose sa propre cible sur sa fenêtre
// intérieure (`Chrome_RenderWidgetHostHWND`), et celle-ci refuse les fichiers
// (curseur 🚫). Coucou la retirait pour laisser la place à celle de wry (la
// bibliothèque sous Tauri), mais sur ta machine celle de wry ne prend pas le
// relais (journal du 05/10 : cible WebView2 retirée, et pourtant aucun
// événement de glisser). Donc on remplace la cible de WebView2 par la nôtre,
// directement sur cette fenêtre intérieure : plus besoin de compter sur wry.
//
// La cible ne lit QUE la liste des chemins (format CF_HDROP), jamais le contenu
// des fichiers, et la transmet au front par l'événement "file-drag".

use std::cell::Cell;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use ::windows::core::{implement, Ref, BOOL};
use ::windows::Win32::Foundation::{HWND, LPARAM, POINT, POINTL};
use ::windows::Win32::Graphics::Gdi::ScreenToClient;
use ::windows::Win32::System::Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
use ::windows::Win32::System::Ole::{
    IDropTarget, IDropTarget_Impl, RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop, CF_HDROP, DROPEFFECT,
    DROPEFFECT_COPY, DROPEFFECT_NONE,
};
use ::windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use ::windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
use ::windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW};

use crate::services::log;

/// Ce que le front reçoit (même forme que les événements de glisser de Tauri).
#[derive(Serialize, Clone)]
struct FileDrag {
    #[serde(rename = "type")]
    kind: &'static str,
    paths: Vec<String>,
    /// En pixels physiques, depuis le coin haut-gauche de la page.
    position: Option<Position>,
}

#[derive(Serialize, Clone)]
struct Position {
    x: i32,
    y: i32,
}

/// Les fenêtres où notre cible est déjà posée (numéros de fenêtre).
static INSTALLED: Mutex<Vec<isize>> = Mutex::new(Vec::new());

/// Pose notre cible sur la fenêtre intérieure du webview de `window_hwnd`, si ce
/// n'est pas déjà fait. À appeler sur le thread principal (OLE l'exige).
/// Sans effet si elle est déjà en place : on peut l'appeler à chaque clic.
pub fn install(app: &AppHandle, window_hwnd: HWND, label: &'static str) {
    let mut found: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumChildWindows(Some(window_hwnd), Some(collect_render_widgets), LPARAM(&mut found as *mut Vec<HWND> as isize));
    }
    let mut installed = INSTALLED.lock().unwrap();
    for hwnd in found {
        if installed.contains(&(hwnd.0 as isize)) {
            continue;
        }
        let target: IDropTarget = DropTarget { app: app.clone(), label, hwnd, valid: Cell::new(false) }.into();
        // On retire la cible de WebView2 (qui refuse tout) et on pose la nôtre.
        let _ = unsafe { RevokeDragDrop(hwnd) };
        match unsafe { RegisterDragDrop(hwnd, &target) } {
            Ok(()) => {
                installed.push(hwnd.0 as isize);
                log::info(format!("glisser-déposer : cible de l'île posée sur {label}"));
            }
            Err(e) => log::warn(format!("glisser-déposer : impossible de poser la cible sur {label} : {e}")),
        }
    }
}

unsafe extern "system" fn collect_render_widgets(hwnd: HWND, found: LPARAM) -> BOOL {
    let found = unsafe { &mut *(found.0 as *mut Vec<HWND>) };
    let mut name = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, &mut name) };
    if String::from_utf16_lossy(&name[..len.max(0) as usize]) == "Chrome_RenderWidgetHostHWND" {
        found.push(hwnd);
    }
    true.into()
}

#[implement(IDropTarget)]
struct DropTarget {
    app: AppHandle,
    /// La fenêtre (Tauri) à prévenir.
    label: &'static str,
    /// La fenêtre intérieure du webview, pour convertir la position de la souris.
    hwnd: HWND,
    /// Ce qui est glissé contient-il des fichiers ?
    valid: Cell<bool>,
}

impl DropTarget {
    fn send(&self, kind: &'static str, paths: Vec<String>, pt: Option<&POINTL>) {
        let position = pt.map(|pt| {
            let mut p = POINT { x: pt.x, y: pt.y };
            let _ = unsafe { ScreenToClient(self.hwnd, &mut p) };
            Position { x: p.x, y: p.y }
        });
        let _ = self.app.emit_to(self.label, "file-drag", FileDrag { kind, paths, position });
    }
}

/// Les chemins des fichiers glissés (None si ce ne sont pas des fichiers :
/// du texte, une image copiée depuis une page…).
fn file_paths(data: Ref<'_, IDataObject>) -> Option<Vec<String>> {
    let data = data.as_ref()?;
    let format = FORMATETC {
        cfFormat: CF_HDROP.0,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    let mut medium = unsafe { data.GetData(&format) }.ok()?;
    let hdrop = HDROP(unsafe { medium.u.hGlobal.0 });
    let mut paths = Vec::new();
    unsafe {
        // 0xFFFFFFFF = « combien y en a-t-il ? »
        let count = DragQueryFileW(hdrop, 0xFFFF_FFFF, None);
        for i in 0..count {
            let len = DragQueryFileW(hdrop, i, None) as usize;
            let mut buf = vec![0u16; len + 1];
            DragQueryFileW(hdrop, i, Some(&mut buf));
            paths.push(OsString::from_wide(&buf[..len]).to_string_lossy().to_string());
        }
        // La mémoire appartient à la source du glisser : on la rend proprement.
        ReleaseStgMedium(&mut medium);
    }
    Some(paths)
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for DropTarget_Impl {
    fn DragEnter(
        &self,
        data: Ref<'_, IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> ::windows::core::Result<()> {
        let paths = file_paths(data);
        self.valid.set(paths.is_some());
        if let Some(paths) = paths {
            self.send("enter", paths, Some(pt));
        }
        unsafe { *effect = if self.valid.get() { DROPEFFECT_COPY } else { DROPEFFECT_NONE } };
        Ok(())
    }

    fn DragOver(&self, _keys: MODIFIERKEYS_FLAGS, pt: &POINTL, effect: *mut DROPEFFECT) -> ::windows::core::Result<()> {
        if self.valid.get() {
            self.send("over", Vec::new(), Some(pt));
        }
        unsafe { *effect = if self.valid.get() { DROPEFFECT_COPY } else { DROPEFFECT_NONE } };
        Ok(())
    }

    fn DragLeave(&self) -> ::windows::core::Result<()> {
        if self.valid.replace(false) {
            self.send("leave", Vec::new(), None);
        }
        Ok(())
    }

    fn Drop(
        &self,
        data: Ref<'_, IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> ::windows::core::Result<()> {
        if self.valid.replace(false) {
            let paths = file_paths(data).unwrap_or_default();
            self.send("drop", paths, Some(pt));
            unsafe { *effect = DROPEFFECT_COPY };
        } else {
            unsafe { *effect = DROPEFFECT_NONE };
        }
        Ok(())
    }
}
