// « Qu'est-ce qui remplit mon disque ? » (module Système) : ce qui dépend de
// Windows. La taille qu'un fichier prend vraiment sur le disque, et la
// Corbeille (sa taille, la vider). Le parcours lui-même est dans
// modules/system_disk.rs. Contient sa propre version Linux.

use std::fs::Metadata;
use std::path::Path;

/// La taille d'une « grappe » (cluster) de NTFS dans presque tous les cas :
/// un fichier occupe au moins une grappe entière.
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub const CLUSTER: u64 = 4096;

/// La taille arrondie à la grappe supérieure (0 reste 0).
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub fn round_cluster(len: u64) -> u64 {
    len.div_ceil(CLUSTER).saturating_mul(CLUSTER)
}

/// La place que ce fichier prend sur le disque, à peu près : sa taille
/// arrondie à la grappe ; 0 pour un fichier « seulement en ligne » (OneDrive,
/// rien n'est téléchargé) ; la taille compressée pour un fichier compressé
/// ou creux. `meta` vient de `DirEntry::metadata` (gratuit sous Windows).
#[cfg(windows)]
pub fn on_disk(meta: &Metadata, path: &Path) -> u64 {
    use std::os::windows::fs::MetadataExt;
    const SPARSE: u32 = 0x200;
    const COMPRESSED: u32 = 0x800;
    const OFFLINE: u32 = 0x1000;
    const RECALL_ON_OPEN: u32 = 0x40000;
    const RECALL_ON_DATA_ACCESS: u32 = 0x40_0000;
    let attrs = meta.file_attributes();
    if attrs & (OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS) != 0 {
        return 0;
    }
    if attrs & (SPARSE | COMPRESSED) != 0 {
        use ::windows::core::HSTRING;
        use ::windows::Win32::Storage::FileSystem::GetCompressedFileSizeW;
        let mut high = 0u32;
        // Le chemin est une chaîne valide le temps de l'appel ; 0xFFFFFFFF + erreur = échec.
        let low = unsafe { GetCompressedFileSizeW(&HSTRING::from(path.as_os_str()), Some(&mut high)) };
        if low != u32::MAX || high != 0 {
            return round_cluster(((high as u64) << 32) | low as u64);
        }
    }
    round_cluster(meta.file_size())
}

#[cfg(not(windows))]
pub fn on_disk(meta: &Metadata, _path: &Path) -> u64 {
    use std::os::unix::fs::MetadataExt;
    meta.blocks().saturating_mul(512)
}

/// Fichier caché ou système (desktop.ini…) : jamais proposé au nettoyage.
#[cfg(windows)]
pub fn is_hidden(meta: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & (0x2 | 0x4) != 0
}

#[cfg(not(windows))]
pub fn is_hidden(_meta: &Metadata) -> bool {
    false
}

/// La Corbeille de tous les lecteurs : (octets, éléments). None : illisible.
#[cfg(windows)]
pub fn recycle_bin() -> Option<(u64, u64)> {
    use ::windows::core::PCWSTR;
    use ::windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
    // Racine nulle : toutes les Corbeilles ; `info` vit pendant l'appel.
    unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info) }.ok()?;
    Some((info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64))
}

#[cfg(not(windows))]
pub fn recycle_bin() -> Option<(u64, u64)> {
    None
}

/// Vide la Corbeille de tous les lecteurs, sans la fenêtre de Windows (Ondine
/// a déjà demandé confirmation). Une Corbeille déjà vide n'est pas une erreur.
#[cfg(windows)]
pub fn empty_recycle_bin() -> Result<(), String> {
    use ::windows::core::PCWSTR;
    use ::windows::Win32::UI::Shell::{SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND};
    if recycle_bin().is_some_and(|(_, items)| items == 0) {
        return Ok(());
    }
    unsafe { SHEmptyRecycleBinW(None, PCWSTR::null(), SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND) }
        .map_err(|e| format!("Corbeille : {e}"))
}

#[cfg(not(windows))]
pub fn empty_recycle_bin() -> Result<(), String> {
    Err("la Corbeille de Windows n'existe pas ici".into())
}

/// Le dossier du cache des miniatures de l'Explorateur (thumbcache_*.db).
pub fn thumbnail_dir() -> Option<std::path::PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    let local = std::env::var_os("LOCALAPPDATA")?;
    Some(std::path::PathBuf::from(local).join("Microsoft").join("Windows").join("Explorer"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_round_up_to_a_cluster() {
        assert_eq!(round_cluster(0), 0);
        assert_eq!(round_cluster(1), 4096);
        assert_eq!(round_cluster(4096), 4096);
        assert_eq!(round_cluster(4097), 8192);
    }
}
