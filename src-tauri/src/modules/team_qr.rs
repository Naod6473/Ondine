// Module « Équipe » : appairer deux PC avec un QR code (1.2.3), en plus du
// code à 6 chiffres.
//
// Le PC qui affiche « Mon code » montre aussi un QR code (dessiné par le même
// générateur que « QR code » du Presse-papiers, clipboard_qr.rs). Il contient
// tout ce qu'il faut taper à la main d'habitude, et un peu plus :
//
//   ondine://pair?v=1&ip=192.168.1.20&code=123456&fp=0123456789abcdef&mine=0
//
//   - l'adresse IP et le code (3 min, un essai, comme avant : le code reste le
//     secret de l'appairage SPAKE2, le QR ne change rien à la sécurité) ;
//   - l'empreinte de la clé du PC qui l'affiche : après l'appairage, on
//     vérifie que c'est bien lui qui a répondu (un autre PC qui aurait volé
//     l'adresse ne passe pas) ;
//   - « c'est un de mes PC ».
//
// Comment l'autre PC le lit. Un PC n'a pas d'appareil photo pointé sur
// l'écran d'à côté ; on propose donc trois façons réalistes, toutes décodées
// ICI, hors ligne, avec la crate `rqrr` (pur Rust) :
//   1. « Lire mon écran » : le QR est visible sur CET écran — un partage
//      d'écran Teams ou Bureau à distance de l'autre PC (le cas de l'IT), une
//      machine virtuelle, ou une photo du QR ouverte dans une visionneuse.
//      Une seule copie de tout le bureau, en mémoire, jamais enregistrée ;
//   2. « Coller une image » : une capture du QR reçue par messagerie et
//      copiée (Ctrl+C) ;
//   3. « Webcam » (portables) : on montre l'écran de l'autre PC à la caméra ;
//      le front envoie quelques images en niveaux de gris par seconde, jamais
//      gardées.
// Dans les trois cas : seul un QR d'Ondine est accepté (`parse`), le nôtre est
// ignoré, et l'appairage ne part qu'après un clic sur « Ajouter ».

use std::net::Ipv4Addr;

use serde::Serialize;

use super::clipboard_qr;

/// Le début de tout QR d'appairage d'Ondine.
const PREFIX: &str = "ondine://pair?";
/// Une image plus grande est réduite avant d'y chercher un QR (un écran 4K
/// côte à côte avec un autre reste lisible, et la recherche reste rapide).
const MAX_SIDE: u32 = 4096;
const MAX_FRAME_PIXELS: usize = 1920 * 1080;

/// Vérifier avant multiplication, allocation et décodage base64.
pub fn decode_frame(w: u64, h: u64, encoded: &str) -> Result<(usize, usize, Vec<u8>), String> {
    use base64::Engine;
    let w = usize::try_from(w).map_err(|_| "image de la webcam trop grande")?;
    let h = usize::try_from(h).map_err(|_| "image de la webcam trop grande")?;
    let pixels = w
        .checked_mul(h)
        .filter(|&n| w > 0 && h > 0 && w <= 1920 && h <= 1920 && n <= MAX_FRAME_PIXELS)
        .ok_or("image de la webcam trop grande")?;
    if encoded.len() > pixels.div_ceil(3) * 4 {
        return Err("image de la webcam illisible".into());
    }
    let gray = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "image de la webcam illisible")?;
    if gray.len() != pixels {
        return Err("image de la webcam illisible".into());
    }
    Ok((w, h, gray))
}

/// Ce que contient un QR d'appairage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairQr {
    pub addr: String,
    pub code: String,
    /// L'empreinte de la clé du PC qui affiche le QR (16 chiffres hexadécimaux).
    pub fp: String,
    pub mine: bool,
}

/// Le texte du QR.
pub fn payload(ip: Ipv4Addr, code: &str, fp: &str, mine: bool) -> String {
    format!(
        "{PREFIX}v=1&ip={ip}&code={code}&fp={fp}&mine={}",
        u8::from(mine)
    )
}

/// Le dessin du QR (SVG noir sur blanc), avec le générateur du Presse-papiers.
pub fn svg(text: &str) -> Result<String, String> {
    clipboard_qr::make(text).map(|q| clipboard_qr::svg(&q))
}

/// Lit le texte d'un QR : seulement un QR d'appairage d'Ondine, bien formé
/// (adresse privée, code à 6 chiffres, empreinte de 16 chiffres hexadécimaux).
pub fn parse(text: &str) -> Option<PairQr> {
    let query = text.trim().strip_prefix(PREFIX)?;
    let (mut v, mut ip, mut code, mut fp, mut mine) = (None, None, None, None, false);
    for part in query.split('&') {
        let (k, val) = part.split_once('=')?;
        match k {
            "v" => v = Some(val),
            "ip" => ip = val.parse::<Ipv4Addr>().ok(),
            "code" => {
                code = (val.len() == 6 && val.bytes().all(|b| b.is_ascii_digit()))
                    .then(|| val.to_string())
            }
            "fp" => {
                fp = (val.len() == 16 && val.bytes().all(|b| b.is_ascii_hexdigit()))
                    .then(|| val.to_ascii_lowercase())
            }
            "mine" => mine = val == "1",
            _ => {} // une version future peut ajouter des champs
        }
    }
    let ip = ip.filter(|ip| super::team::is_lan(*ip) && !ip.is_loopback())?;
    (v == Some("1")).then_some(())?;
    Some(PairQr {
        addr: ip.to_string(),
        code: code?,
        fp: fp?,
        mine,
    })
}

/// Cherche un QR d'appairage d'Ondine dans une image en niveaux de gris
/// (`w` × `h` octets, 0 = noir). `me` : notre empreinte (notre propre QR,
/// visible à l'écran, est ignoré).
pub fn find_in_gray(w: usize, h: usize, gray: &[u8], me: &str) -> Option<PairQr> {
    let pixels = w.checked_mul(h)?;
    if w == 0 || h == 0 || w > MAX_SIDE as usize || h > MAX_SIDE as usize || gray.len() < pixels {
        return None;
    }
    let mut img = rqrr::PreparedImage::prepare_from_greyscale(w, h, |x, y| gray[y * w + x]);
    img.detect_grids()
        .into_iter()
        .filter_map(|g| g.decode().ok())
        .filter_map(|(_, text)| parse(&text))
        .find(|q| q.fp != me)
}

/// Pareil pour une image en couleurs : `channels` = 3 (RGB) ou 4 (RGBA).
pub fn find_in_color(w: usize, h: usize, px: &[u8], channels: usize, me: &str) -> Option<PairQr> {
    let pixels = w.checked_mul(h)?;
    let bytes = pixels.checked_mul(channels)?;
    if w == 0 || h == 0 || !matches!(channels, 3 | 4) || px.len() < bytes {
        return None;
    }
    let (nw, nh) = fit(u32::try_from(w).ok()?, u32::try_from(h).ok()?);
    let (nw, nh) = (nw as usize, nh as usize);
    let mut gray = Vec::with_capacity(nw * nh);
    for y in 0..nh {
        for x in 0..nw {
            let offset = ((y * h / nh) * w + x * w / nw) * channels;
            let c = &px[offset..offset + channels];
            gray.push(
                ((u32::from(c[0]) * 299 + u32::from(c[1]) * 587 + u32::from(c[2]) * 114) / 1000)
                    as u8,
            );
        }
    }
    find_in_gray(nw, nh, &gray, me)
}

/// La taille de copie d'une image trop grande (même proportions, `MAX_SIDE` au plus).
pub fn fit(w: u32, h: u32) -> (u32, u32) {
    let big = w.max(h);
    if big <= MAX_SIDE {
        return (w, h);
    }
    let k = f64::from(MAX_SIDE) / f64::from(big);
    (
        ((f64::from(w) * k).round() as u32).max(1),
        ((f64::from(h) * k).round() as u32).max(1),
    )
}

/// « Lire mon écran » : une copie de tout le bureau (en mémoire), puis la recherche.
pub fn scan_screen(me: &str) -> Result<Option<PairQr>, String> {
    use crate::platform::record::{desktop_area, Grabber};
    let me = me.to_string();
    // Sur un fil à part : la copie change le réglage DPI du fil qui la fait.
    std::thread::spawn(move || {
        let area = desktop_area().ok_or("écran introuvable (disponible seulement sous Windows)")?;
        let (w, h) = fit(area.width, area.height);
        let rgb = Grabber::new(area, w, h, false)?.grab()?;
        Ok(find_in_color(w as usize, h as usize, &rgb, 3, &me))
    })
    .join()
    .map_err(|_| "erreur pendant la lecture de l'écran".to_string())?
}

/// « Coller une image » : l'image copiée (jamais un élément marqué sensible).
pub fn scan_clipboard(me: &str) -> Result<Option<PairQr>, String> {
    if crate::platform::clipboard_is_sensitive() {
        return Err("le contenu copié est marqué sensible : on n'y touche pas".into());
    }
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("presse-papiers indisponible : {e}"))?;
    let image = clipboard.get_image().map_err(|_| {
        "le presse-papiers ne contient pas d'image : copiez la capture du QR code".to_string()
    })?;
    Ok(find_in_color(
        image.width,
        image.height,
        &image.bytes,
        4,
        me,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FP: &str = "0123456789abcdef";

    #[test]
    fn payload_round_trip() {
        let text = payload(Ipv4Addr::new(192, 168, 1, 20), "042517", FP, true);
        assert_eq!(
            text,
            "ondine://pair?v=1&ip=192.168.1.20&code=042517&fp=0123456789abcdef&mine=1"
        );
        assert_eq!(
            parse(&text),
            Some(PairQr {
                addr: "192.168.1.20".into(),
                code: "042517".into(),
                fp: FP.into(),
                mine: true
            })
        );
    }

    #[test]
    fn only_a_well_formed_ondine_qr_is_accepted() {
        let ok = "ondine://pair?v=1&ip=10.0.0.5&code=123456&fp=0123456789ABCDEF&mine=0";
        assert_eq!(parse(ok).unwrap().fp, FP, "empreinte en minuscules");
        // Un champ inconnu (version future) est ignoré.
        assert!(parse(&format!("{ok}&color=blue")).is_some());
        for bad in [
            "https://exemple.fr/?ip=10.0.0.5&code=123456",
            "ondine://pair?v=2&ip=10.0.0.5&code=123456&fp=0123456789abcdef",
            "ondine://pair?v=1&ip=8.8.8.8&code=123456&fp=0123456789abcdef",
            "ondine://pair?v=1&ip=127.0.0.1&code=123456&fp=0123456789abcdef",
            "ondine://pair?v=1&ip=10.0.0.5&code=12345&fp=0123456789abcdef",
            "ondine://pair?v=1&ip=10.0.0.5&code=12345a&fp=0123456789abcdef",
            "ondine://pair?v=1&ip=10.0.0.5&code=123456&fp=xyz",
            "ondine://pair?v=1&ip=10.0.0.5&code=123456",
            "ondine://pair?v=1&ip",
        ] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }

    /// Dessine un QR en niveaux de gris (`scale` pixels par carré), posé dans une image plus grande.
    fn render(text: &str, scale: usize, offset: usize, side: usize) -> Vec<u8> {
        let svg_text = svg(text).unwrap();
        assert!(svg_text.starts_with("<svg"));
        let (qw, rgba) = clipboard_qr::rgba(&clipboard_qr::make(text).unwrap());
        let mut img = vec![200u8; side * side];
        // L'image du Presse-papiers fait `qw` pixels : on la réduit au pas voulu.
        let modules = clipboard_qr::make(text).unwrap().width;
        let step = qw / modules;
        for y in 0..modules * scale {
            for x in 0..modules * scale {
                let (sx, sy) = ((x / scale) * step, (y / scale) * step);
                img[(y + offset) * side + x + offset] = rgba[(sy * qw + sx) * 4];
            }
        }
        img
    }

    #[test]
    fn a_qr_is_found_in_a_screen_and_ours_is_ignored() {
        let text = payload(Ipv4Addr::new(192, 168, 1, 20), "042517", FP, false);
        let side = 400;
        let img = render(&text, 4, 60, side);
        let found = find_in_gray(side, side, &img, "ffffffffffffffff").expect("QR trouvé");
        assert_eq!(found.code, "042517");
        // Le nôtre (même empreinte) : ignoré.
        assert_eq!(find_in_gray(side, side, &img, FP), None);
        // Une image sans QR, ou trop courte : rien.
        assert_eq!(
            find_in_gray(side, side, &vec![255u8; side * side], ""),
            None
        );
        assert_eq!(find_in_gray(side, side, &img[..10], ""), None);
        // En couleurs (RGBA), pareil.
        let rgba: Vec<u8> = img.iter().flat_map(|&g| [g, g, g, 255]).collect();
        assert_eq!(
            find_in_color(side, side, &rgba, 4, "").map(|q| q.addr),
            Some("192.168.1.20".into())
        );
    }

    #[test]
    fn big_screens_are_reduced() {
        assert_eq!(fit(1920, 1080), (1920, 1080));
        assert_eq!(fit(7680, 2160), (4096, 1152));
        assert_eq!(fit(2160, 8192), (1080, 4096));
    }

    #[test]
    fn untrusted_dimensions_and_base64_are_bounded() {
        assert_eq!(find_in_gray(usize::MAX, 2, &[], ""), None);
        assert_eq!(find_in_color(usize::MAX, 2, &[], 4, ""), None);
        assert_eq!(find_in_gray(1, MAX_SIDE as usize + 1, &[], ""), None);
        assert!(decode_frame(u64::MAX, 2, "").is_err());
        assert!(decode_frame(1920, 1920, "").is_err());
        assert!(decode_frame(1, 1, &"A".repeat(100_000)).is_err());
        assert!(decode_frame(2, 2, "AA==").is_err());
        assert_eq!(
            decode_frame(2, 2, "AAECAw==").unwrap(),
            (2, 2, vec![0, 1, 2, 3])
        );
    }
}
