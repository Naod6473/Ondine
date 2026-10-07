// L'éclairage nocturne de Windows (Paramètres → Système → Écran), depuis une
// pastille de l'onglet Contrôles.
//
// Windows n'a PAS d'API publique pour ça. Il garde l'état dans un « blob »
// (une suite d'octets) du registre de l'utilisateur :
//   HKCU\Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\
//     default$windows.data.bluelightreduction.bluelightreductionstate\
//     windows.data.bluelightreduction.bluelightreductionstate
//   valeur « Data » (binaire)
// et le système applique tout seul un changement de cette valeur.
//
// Le format n'est pas documenté ; d'autres l'ont reconstitué (projets
// tiny-screen et nightlight-cli), et on l'a vérifié sur des valeurs réelles
// (voir les tests en bas). Éteint, il fait 41 octets :
//
//   43 42 01 00                « CB », version 1 : en-tête de l'enveloppe
//   0A 02 01 00                (fixe)
//   2A 06 <nombre>             date de la dernière écriture (secondes depuis 1970)
//   2A 2B 0E <longueur>        longueur du contenu qui suit (19 octets éteint, 21 allumé)
//      43 42 01 00             en-tête du contenu
//      [10 00]                 présent SEULEMENT quand l'éclairage est allumé
//      D0 0A 02                (fixe)
//      C6 14 <nombre>          date du changement (FILETIME : 100 ns depuis 1601)
//      00                      fin du contenu
//   00 00 00                   fin de l'enveloppe
//
// Les <nombre> sont écrits en « varint » : 7 bits par octet, le bit de poids
// fort à 1 veut dire « un octet de plus suit » (LEB128).
//
// Prudence : on ne réécrit la valeur QUE si elle a exactement cette forme
// (chaque octet fixe vérifié, longueurs comprises). Sinon (une autre version
// de Windows, une valeur inattendue), on n'écrit rien et on ouvre la page
// « Éclairage nocturne » des Paramètres. On ne corrompt jamais la valeur.

// Sous Linux, seuls les tests se servent du décodage (rien à lire dans un registre).
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;

/// Ce que l'onglet affiche.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct NightLight {
    /// La valeur a la forme connue : on sait la lire et la basculer.
    pub supported: bool,
    /// L'éclairage nocturne est allumé (false si `supported` est faux).
    pub on: bool,
}

const OUTER_HEAD: [u8; 10] = [0x43, 0x42, 0x01, 0x00, 0x0A, 0x02, 0x01, 0x00, 0x2A, 0x06];
const OUTER_LEN_TAG: [u8; 3] = [0x2A, 0x2B, 0x0E];
const INNER_HEAD: [u8; 4] = [0x43, 0x42, 0x01, 0x00];
const ON_MARK: [u8; 2] = [0x10, 0x00];
const INNER_FIXED: [u8; 3] = [0xD0, 0x0A, 0x02];
const INNER_TIME_TAG: [u8; 2] = [0xC6, 0x14];
/// Au plus ce nombre d'octets de zéros à la fin (on en a vu 3).
const MAX_TAIL: usize = 8;

/// Lit un varint à partir de `at` → (valeur, position après). Au plus 10 octets.
fn read_varint(data: &[u8], at: usize) -> Option<(u64, usize)> {
    let mut value = 0u64;
    for i in 0..10 {
        let byte = *data.get(at + i)?;
        value |= u64::from(byte & 0x7F) << (7 * i);
        if byte & 0x80 == 0 {
            return Some((value, at + i + 1));
        }
    }
    None
}

/// Écrit un varint.
fn write_varint(out: &mut Vec<u8>, mut value: u64) {
    loop {
        let byte = (value & 0x7F) as u8;
        value >>= 7;
        if value == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

/// La valeur, découpée en morceaux (seulement si elle a la forme connue).
#[derive(Debug, PartialEq)]
struct Parsed {
    on: bool,
    /// Date de la dernière écriture (secondes depuis 1970).
    written: u64,
    /// Date du changement (FILETIME).
    changed: u64,
    /// Les octets après le contenu (des zéros).
    tail_len: usize,
}

/// Découpe la valeur ; None si un seul octet ne correspond pas à la forme connue.
fn parse(data: &[u8]) -> Option<Parsed> {
    if !data.starts_with(&OUTER_HEAD) {
        return None;
    }
    let (written, at) = read_varint(data, OUTER_HEAD.len())?;
    if data.get(at..at + OUTER_LEN_TAG.len())? != OUTER_LEN_TAG {
        return None;
    }
    let (inner_len, inner_start) = read_varint(data, at + OUTER_LEN_TAG.len())?;
    let inner_end = inner_start.checked_add(usize::try_from(inner_len).ok()?)?;
    let inner = data.get(inner_start..inner_end)?;
    let tail = &data[inner_end..];
    if tail.len() > MAX_TAIL || tail.iter().any(|&b| b != 0) {
        return None;
    }
    // Le contenu : en-tête, [10 00], D0 0A 02, C6 14 <date>, 00 — et rien d'autre.
    let rest = inner.strip_prefix(&INNER_HEAD)?;
    let (on, rest) = match rest.strip_prefix(&ON_MARK) {
        Some(r) => (true, r),
        None => (false, rest),
    };
    let rest = rest.strip_prefix(&INNER_FIXED)?.strip_prefix(&INNER_TIME_TAG)?;
    let (changed, after) = read_varint(rest, 0)?;
    if rest.get(after..)? != [0x00] {
        return None;
    }
    Some(Parsed { on, written, changed, tail_len: tail.len() })
}

/// L'état lu dans la valeur.
pub fn read_state(data: &[u8]) -> NightLight {
    match parse(data) {
        Some(p) => NightLight { supported: true, on: p.on },
        None => NightLight::default(),
    }
}

/// La nouvelle valeur pour allumer (`on`) ou éteindre l'éclairage, datée de
/// `now_secs` (secondes depuis 1970). None si la valeur actuelle n'a pas la
/// forme connue : dans ce cas, ne RIEN écrire.
pub fn toggled(data: &[u8], on: bool, now_secs: u64) -> Option<Vec<u8>> {
    let old = parse(data)?;
    // Les dates avancent toujours (même si l'horloge du PC retarde).
    // (saturating_add : pas de débordement, même avec une date absurde.)
    let written = now_secs.max(old.written.saturating_add(1));
    let changed = unix_to_filetime(now_secs).max(old.changed.saturating_add(1));

    let mut inner = INNER_HEAD.to_vec();
    if on {
        inner.extend_from_slice(&ON_MARK);
    }
    inner.extend_from_slice(&INNER_FIXED);
    inner.extend_from_slice(&INNER_TIME_TAG);
    write_varint(&mut inner, changed);
    inner.push(0x00);

    let mut out = OUTER_HEAD.to_vec();
    write_varint(&mut out, written);
    out.extend_from_slice(&OUTER_LEN_TAG);
    write_varint(&mut out, inner.len() as u64);
    out.extend_from_slice(&inner);
    out.extend(std::iter::repeat_n(0u8, old.tail_len));

    // Dernière vérification : la valeur fabriquée se relit, dans le bon état.
    (parse(&out).map(|p| p.on) == Some(on)).then_some(out)
}

/// Secondes depuis 1970 → FILETIME (centaines de nanosecondes depuis 1601).
fn unix_to_filetime(secs: u64) -> u64 {
    secs.saturating_add(11_644_473_600).saturating_mul(10_000_000)
}

#[cfg(windows)]
mod imp {
    use super::{read_state, toggled, NightLight};
    use ::windows::core::HSTRING;
    use ::windows::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_BINARY, REG_VALUE_TYPE};

    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate";

    /// Une clé ouverte, refermée toute seule à la fin (Drop).
    struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }

    fn open(write: bool) -> Option<Key> {
        let mut key = HKEY::default();
        let access = if write { KEY_QUERY_VALUE | KEY_SET_VALUE } else { KEY_QUERY_VALUE };
        let err = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(KEY), None, access, &mut key) };
        err.is_ok().then_some(Key(key))
    }

    /// La valeur « Data » (binaire), ou None (absente, d'un autre type, trop grosse).
    fn read_data(key: &Key) -> Option<Vec<u8>> {
        let mut kind = REG_VALUE_TYPE(0);
        let mut buf = [0u8; 256];
        let mut size = buf.len() as u32;
        let err = unsafe { RegQueryValueExW(key.0, &HSTRING::from("Data"), None, Some(&mut kind), Some(buf.as_mut_ptr()), Some(&mut size)) };
        if err.is_err() || kind != REG_BINARY || size as usize > buf.len() {
            return None;
        }
        Some(buf[..size as usize].to_vec())
    }

    pub fn get() -> NightLight {
        open(false).and_then(|k| read_data(&k)).map(|d| read_state(&d)).unwrap_or_default()
    }

    /// Ok(true) : écrit ; Ok(false) : forme inconnue, rien écrit.
    pub fn set(on: bool) -> Result<bool, String> {
        let Some(key) = open(true) else { return Ok(false) };
        let Some(data) = read_data(&key) else { return Ok(false) };
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let Some(new) = toggled(&data, on, now) else { return Ok(false) };
        let err = unsafe { RegSetValueExW(key.0, &HSTRING::from("Data"), None, REG_BINARY, Some(&new)) };
        if err.is_err() {
            return Err("Windows refuse de changer l'éclairage nocturne".into());
        }
        Ok(true)
    }
}

#[cfg(not(windows))]
mod imp {
    use super::NightLight;
    pub fn get() -> NightLight {
        NightLight::default()
    }
    pub fn set(_on: bool) -> Result<bool, String> {
        Ok(false)
    }
}

/// L'éclairage nocturne : forme reconnue ? allumé ?
pub use imp::get;
/// Allume ou éteint l'éclairage nocturne. Ok(false) : la valeur n'a pas la
/// forme connue et RIEN n'a été écrit (ouvrir alors ms-settings:nightlight).
pub use imp::set;

#[cfg(test)]
mod tests {
    use super::*;

    /// Une vraie valeur, éclairage ÉTEINT (Windows 10/11, publiée sur un forum
    /// d'entraide), écrite le 25/09/2020 à 20:51:07 UTC.
    const OFF: [u8; 41] = [
        0x43, 0x42, 0x01, 0x00, 0x0a, 0x02, 0x01, 0x00, 0x2a, 0x06, 0xbb, 0xb0, 0xb9, 0xfb, 0x05, 0x2a, 0x2b, 0x0e, 0x13, 0x43, 0x42, 0x01, 0x00, 0xd0, 0x0a, 0x02, 0xc6,
        0x14, 0xe3, 0xff, 0xb4, 0xbd, 0xd9, 0xef, 0xa4, 0xeb, 0x01, 0x00, 0x00, 0x00, 0x00,
    ];

    /// La même, allumée « à la main » comme le fait tiny-screen : 0x15 à la
    /// place de 0x13, et 10 00 glissés après l'en-tête du contenu.
    fn on_like_tiny_screen() -> Vec<u8> {
        let mut v = OFF[..23].to_vec();
        v[18] = 0x15;
        v.extend_from_slice(&[0x10, 0x00]);
        v.extend_from_slice(&OFF[23..]);
        v
    }

    #[test]
    fn varints() {
        assert_eq!(read_varint(&OFF, 10), Some((1_601_067_067, 15)));
        assert_eq!(read_varint(&OFF, 28), Some((132_455_406_678_917_091, 37)));
        for n in [0u64, 1, 127, 128, 300, 1_601_067_067, 133_000_000_000_000_000, u64::MAX] {
            let mut v = Vec::new();
            write_varint(&mut v, n);
            assert_eq!(read_varint(&v, 0), Some((n, v.len())), "{n}");
        }
        // Coupé au milieu : None, pas de panique.
        assert_eq!(read_varint(&[0x80, 0x80], 0), None);
    }

    #[test]
    fn reads_real_values() {
        assert_eq!(read_state(&OFF), NightLight { supported: true, on: false });
        let on = on_like_tiny_screen();
        assert_eq!(on.len(), 43);
        assert_eq!(read_state(&on), NightLight { supported: true, on: true });
    }

    #[test]
    fn toggles_without_breaking_the_shape() {
        // 2026-10-07 12:00:00 UTC
        let now = 1_791_374_400;
        let on = toggled(&OFF, true, now).unwrap();
        assert_eq!(on.len(), 43);
        assert_eq!(on[18], 0x15, "longueur du contenu");
        assert_eq!(&on[19..25], &[0x43, 0x42, 0x01, 0x00, 0x10, 0x00]);
        assert_eq!(read_varint(&on, 10).unwrap().0, now);
        assert_eq!(read_state(&on), NightLight { supported: true, on: true });
        // Mêmes octets que la méthode de tiny-screen, aux dates près.
        let tiny = on_like_tiny_screen();
        assert_eq!(&on[..10], &tiny[..10]);
        assert_eq!(&on[15..30], &tiny[15..30]);
        assert_eq!(&on[39..], &tiny[39..]);

        let off = toggled(&on, false, now + 60).unwrap();
        assert_eq!(off.len(), 41);
        assert_eq!(off[18], 0x13);
        assert_eq!(read_state(&off), NightLight { supported: true, on: false });
        // Tout est identique à la valeur de départ, sauf les deux dates.
        assert_eq!(&off[..10], &OFF[..10]);
        assert_eq!(&off[15..28], &OFF[15..28]);
        assert_eq!(&off[37..], &OFF[37..]);
        // Déjà dans l'état demandé : on réécrit quand même proprement (dates nouvelles).
        assert_eq!(read_state(&toggled(&off, false, now + 120).unwrap()), NightLight { supported: true, on: false });
    }

    #[test]
    fn dates_never_go_backwards() {
        // Horloge du PC en 1999 : on garde quand même des dates plus récentes que l'ancienne valeur.
        let on = toggled(&OFF, true, 946_684_800).unwrap();
        let p = parse(&on).unwrap();
        assert_eq!(p.written, 1_601_067_068);
        assert_eq!(p.changed, 132_455_406_678_917_092);

        // Des dates absurdes (le plus grand nombre possible) : pas de panique.
        let mut huge = OFF[..10].to_vec();
        write_varint(&mut huge, u64::MAX);
        huge.extend_from_slice(&OFF[15..28]);
        write_varint(&mut huge, u64::MAX);
        huge.push(0x00);
        huge.extend_from_slice(&[0, 0, 0]);
        // La longueur du contenu change avec celle de la date : on la recalcule.
        huge[OFF[..10].len() + 10 + 3] = (huge.len() - 3 - (10 + 10 + 4)) as u8;
        assert_eq!(read_state(&huge), NightLight { supported: true, on: false });
        let on = toggled(&huge, true, 1_791_374_400).unwrap();
        assert_eq!(read_state(&on), NightLight { supported: true, on: true });
    }

    #[test]
    fn unknown_shapes_are_never_touched() {
        let mut cases: Vec<Vec<u8>> = vec![
            Vec::new(),
            OFF[..20].to_vec(),
            // L'ancien format de Windows 10 (une autre clé du registre) : 02 00 00 00 + date.
            vec![2, 0, 0, 0, 147, 250, 216, 91, 185, 109, 210, 1, 0, 0, 0, 0, 67, 66, 1, 0, 208, 10, 2, 198, 20, 202, 236, 227, 222, 149, 183, 155, 233, 1, 0],
        ];
        // Chaque octet fixe modifié à son tour.
        for i in [0, 3, 4, 7, 8, 9, 15, 16, 17, 19, 22, 23, 24, 25, 26, 27, 37] {
            let mut v = OFF.to_vec();
            v[i] ^= 0x01;
            cases.push(v);
        }
        // Mauvaise longueur annoncée, un octet en trop dans le contenu, une fin non nulle.
        let mut v = OFF.to_vec();
        v[18] = 0x14;
        cases.push(v);
        let mut v = OFF.to_vec();
        v.insert(37, 0x07);
        v[18] = 0x14;
        cases.push(v);
        let mut v = OFF.to_vec();
        v[40] = 0x01;
        cases.push(v);
        // Un autre champ que « 10 00 » au début du contenu (une version future ?).
        let mut v = OFF[..23].to_vec();
        v[18] = 0x15;
        v.extend_from_slice(&[0x10, 0x01]);
        v.extend_from_slice(&OFF[23..]);
        cases.push(v);
        // Beaucoup de zéros à la fin.
        let mut v = OFF.to_vec();
        v.extend_from_slice(&[0; 20]);
        cases.push(v);

        for (n, case) in cases.iter().enumerate() {
            assert_eq!(read_state(case), NightLight::default(), "cas {n}");
            assert_eq!(toggled(case, true, 1_791_374_400), None, "cas {n}");
            assert_eq!(toggled(case, false, 1_791_374_400), None, "cas {n}");
        }
    }
}
