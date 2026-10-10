// Télécommande sur le téléphone (Contrôles) : « diapo suivante / précédente ».
//
// On envoie Page suivante / Page précédente à la fenêtre au premier plan, comme
// le fait une télécommande de présentation du commerce (PowerPoint, Google
// Slides, Keynote dans le navigateur, lecteurs PDF en plein écran…). L'île ne
// prend jamais le premier plan (fenêtre « non activante ») : c'est bien la
// présentation qui reçoit la touche. Seules ces deux touches existent : rien
// d'autre ne peut être tapé depuis le téléphone.

/// Les touches que la télécommande peut envoyer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Nav {
    Next,
    Previous,
}

#[cfg(windows)]
pub fn press(nav: Nav) -> Result<(), String> {
    use ::windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_NEXT, VK_PRIOR,
    };
    let vk: VIRTUAL_KEY = match nav {
        Nav::Next => VK_NEXT,
        Nav::Previous => VK_PRIOR,
    };
    // Page suivante / précédente sont des touches « étendues » (pavé de navigation).
    let key = |flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags | KEYEVENTF_EXTENDEDKEY, time: 0, dwExtraInfo: 0 } },
    };
    let inputs = [key(KEYBD_EVENT_FLAGS(0)), key(KEYEVENTF_KEYUP)];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("Windows a refusé la touche (fenêtre d'un programme lancé en administrateur ?)".into())
    }
}

#[cfg(not(windows))]
pub fn press(_nav: Nav) -> Result<(), String> {
    Err("seulement sous Windows".into())
}
