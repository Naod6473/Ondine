// Ondine convertit (1.2.4) : ce que Windows sait déjà faire, sans rien installer.
//
//   - lire HEIC, HEIF, AVIF, TIFF (et tout ce que WIC connaît) : décodeur
//     d'images de Windows (`Windows.Graphics.Imaging.BitmapDecoder`). HEIC
//     demande l'extension « HEIF » du Microsoft Store (et « HEVC » pour les
//     photos d'iPhone), AVIF l'extension « AV1 » : sans elle, une erreur claire ;
//   - écrire TIFF (encodeur d'images de Windows) ;
//   - dessiner les pages d'un PDF en images (`Windows.Data.Pdf`, le lecteur PDF
//     intégré à Windows) ;
//   - convertir vidéo et son (`Windows.Media.Transcoding.MediaTranscoder`) :
//     MP4 (H.264 + AAC), M4A, MP3, WAV, et extraire le son d'une vidéo ;
//   - sélectionner le nouveau fichier dans l'Explorateur, seulement si une
//     fenêtre de l'Explorateur montre déjà son dossier (on n'ouvre rien).
//
// Tout se passe sur l'ordinateur : les fichiers ne sont envoyés nulle part.
// À appeler depuis un thread secondaire (les `.get()` attendent la fin).
// Sous Linux (vérifications), tout renvoie « disponible seulement sous Windows ».

/// Ce que produit une conversion de vidéo ou de son.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaTarget {
    /// MP4 (vidéo H.264, son AAC) ; `smaller` : une définition en dessous.
    Mp4 { smaller: bool },
    M4a,
    Mp3,
    Wav,
}

/// Petite, Normale, Haute (convert_logic::Quality, sans dépendre du module).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaQuality {
    Small,
    Normal,
    High,
}

#[cfg(windows)]
pub use self::win::*;

#[cfg(not(windows))]
pub use self::stub::*;

#[cfg(windows)]
mod win {
    use super::{MediaQuality, MediaTarget};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use windows::core::{Interface, HSTRING};
    use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapEncoder, BitmapPixelFormat, BitmapTransform, ColorManagementMode, ExifOrientationMode,
    };
    use windows::Media::MediaProperties::{AudioEncodingQuality, MediaEncodingProfile, VideoEncodingQuality};
    use windows::Media::Transcoding::{MediaTranscoder, TranscodeFailureReason};
    use windows::Storage::Streams::{DataReader, IRandomAccessStream, InMemoryRandomAccessStream};
    use windows::Storage::{CreationCollisionOption, FileAccessMode, StorageFile, StorageFolder};
    use windows_future::{AsyncActionProgressHandler, AsyncStatus};

    use crate::sync::LockExt;

    /// « Composant introuvable » de WIC : il manque le décodeur (extension du Store).
    const WINCODEC_ERR_COMPONENTNOTFOUND: i32 = 0x8898_2F50_u32 as i32;
    /// Mémoire insuffisante (on s'en sert aussi pour « image trop grande »).
    const E_OUTOFMEMORY: i32 = 0x8007_000E_u32 as i32;
    /// Le PDF demande un mot de passe.
    const E_PDF_PASSWORD: i32 = 0x8007_052B_u32 as i32;

    fn h(path: &Path) -> HSTRING {
        HSTRING::from(path.as_os_str())
    }

    fn init() {
        crate::platform::media::init_thread();
    }

    /// Lit tout le contenu d'un flux en mémoire.
    fn read_all(stream: &IRandomAccessStream) -> windows::core::Result<Vec<u8>> {
        let size = stream.Size()? as usize;
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.LoadAsync(size as u32)?.get()?;
        let mut buf = vec![0u8; size];
        reader.ReadBytes(&mut buf)?;
        Ok(buf)
    }

    /// Lit une image avec le décodeur de Windows : pixels RVBA, tournée selon
    /// l'orientation de l'appareil photo, couleurs ramenées en sRGB.
    pub fn decode_image(path: &Path) -> Result<image::RgbaImage, String> {
        init();
        let run = || -> windows::core::Result<image::RgbaImage> {
            let file = StorageFile::GetFileFromPathAsync(&h(path))?.get()?;
            let stream = file.OpenAsync(FileAccessMode::Read)?.get()?;
            let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
            let (w, h) = (decoder.OrientedPixelWidth()?, decoder.OrientedPixelHeight()?);
            if (w as u64) * (h as u64) > crate::modules::convert_logic::MAX_IMAGE_PIXELS {
                return Err(windows::core::Error::new(windows::core::HRESULT(E_OUTOFMEMORY), "image trop grande"));
            }
            let pixels = decoder
                .GetPixelDataTransformedAsync(
                    BitmapPixelFormat::Rgba8,
                    BitmapAlphaMode::Straight,
                    &BitmapTransform::new()?,
                    ExifOrientationMode::RespectExifOrientation,
                    ColorManagementMode::ColorManageToSRgb,
                )?
                .get()?;
            let bytes = pixels.DetachPixelData()?.to_vec();
            image::RgbaImage::from_raw(w, h, bytes).ok_or_else(|| windows::core::Error::new(windows::core::HRESULT(0x8000_4005_u32 as i32), "taille"))
        };
        run().map_err(|e| match e.code().0 {
            WINCODEC_ERR_COMPONENTNOTFOUND => {
                "il manque l'extension de Windows pour ce format (HEIF ou AV1, gratuites sur le Microsoft Store)".to_string()
            }
            E_OUTOFMEMORY => "image trop grande".to_string(),
            _ => "Windows ne sait pas lire cette image (elle semble abîmée)".to_string(),
        })
    }

    /// Écrit une image en TIFF avec l'encodeur de Windows.
    pub fn encode_tiff(img: &image::RgbaImage, out: &Path) -> Result<(), String> {
        init();
        let run = || -> windows::core::Result<Vec<u8>> {
            let stream = InMemoryRandomAccessStream::new()?;
            let encoder = BitmapEncoder::CreateAsync(BitmapEncoder::TiffEncoderId()?, &stream)?.get()?;
            encoder.SetPixelData(BitmapPixelFormat::Rgba8, BitmapAlphaMode::Straight, img.width(), img.height(), 96.0, 96.0, img.as_raw())?;
            encoder.FlushAsync()?.get()?;
            read_all(&stream.cast()?)
        };
        let bytes = run().map_err(|_| "Windows n'a pas pu écrire le TIFF".to_string())?;
        std::fs::write(out, bytes).map_err(|e| crate::modules::convert_logic::io_reason(&e))
    }

    /// Dessine les pages d'un PDF (au plus `max_pages`) à `dpi` points par
    /// pouce ; `page(index, nombre, png)` reçoit chaque page en PNG.
    pub fn pdf_pages(
        path: &Path,
        dpi: f64,
        max_pages: u32,
        cancel: &AtomicBool,
        page: &mut dyn FnMut(u32, u32, Vec<u8>) -> Result<(), String>,
    ) -> Result<u32, String> {
        init();
        let doc = (|| -> windows::core::Result<PdfDocument> {
            let file = StorageFile::GetFileFromPathAsync(&h(path))?.get()?;
            PdfDocument::LoadFromFileAsync(&file)?.get()
        })()
        .map_err(|e| {
            if e.code().0 == E_PDF_PASSWORD {
                "ce PDF est protégé par un mot de passe".to_string()
            } else {
                "Windows ne sait pas lire ce PDF (il semble abîmé)".to_string()
            }
        })?;
        let count = doc.PageCount().map_err(|_| "PDF illisible".to_string())?.min(max_pages);
        for i in 0..count {
            if cancel.load(Ordering::SeqCst) {
                return Err(crate::modules::convert_logic::CANCELLED.into());
            }
            let png = (|| -> windows::core::Result<Vec<u8>> {
                let p = doc.GetPage(i)?;
                // La taille d'une page est donnée en DIP (1/96 de pouce).
                let size = p.Size()?;
                let options = PdfPageRenderOptions::new()?;
                options.SetDestinationWidth(((size.Width as f64) * dpi / 96.0).round().clamp(16.0, 12_000.0) as u32)?;
                options.SetBitmapEncoderId(BitmapEncoder::PngEncoderId()?)?;
                let stream = InMemoryRandomAccessStream::new()?;
                p.RenderWithOptionsToStreamAsync(&stream, &options)?.get()?;
                read_all(&stream.cast()?)
            })()
            .map_err(|_| format!("la page {} n'a pas pu être dessinée", i + 1))?;
            page(i, count, png)?;
        }
        Ok(count)
    }

    /// Le profil d'encodage de Windows pour ce format et cette qualité.
    fn profile_for(target: MediaTarget, quality: MediaQuality) -> windows::core::Result<MediaEncodingProfile> {
        let audio = match quality {
            MediaQuality::Small => AudioEncodingQuality::Low,
            MediaQuality::Normal => AudioEncodingQuality::Medium,
            MediaQuality::High => AudioEncodingQuality::High,
        };
        match target {
            MediaTarget::Mp4 { smaller } => {
                let video = match (quality, smaller) {
                    (MediaQuality::Small, true) => VideoEncodingQuality::Wvga,
                    (MediaQuality::Small, false) | (MediaQuality::Normal, true) => VideoEncodingQuality::HD720p,
                    (MediaQuality::Normal, false) | (MediaQuality::High, true) => VideoEncodingQuality::HD1080p,
                    // Haute : la définition de la vidéo d'origine.
                    (MediaQuality::High, false) => VideoEncodingQuality::Auto,
                };
                MediaEncodingProfile::CreateMp4(video)
            }
            MediaTarget::M4a => MediaEncodingProfile::CreateM4a(audio),
            MediaTarget::Mp3 => MediaEncodingProfile::CreateMp3(audio),
            MediaTarget::Wav => MediaEncodingProfile::CreateWav(audio),
        }
    }

    /// Convertit une vidéo ou un son. Le fichier `name` est créé dans `dir`
    /// (il ne doit pas exister). `progress` reçoit la part faite (0 à 1).
    /// Arrêtée (`cancel`) ou ratée, la conversion envoie son fichier
    /// incomplet à la Corbeille. Renvoie le chemin créé.
    pub fn transcode(
        src: &Path,
        dir: &Path,
        name: &str,
        target: MediaTarget,
        quality: MediaQuality,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(f64),
    ) -> Result<PathBuf, String> {
        init();
        let profile = profile_for(target, quality)
        .map_err(|_| "Windows ne propose pas ce format ici".to_string())?;

        let (source, folder) = (|| -> windows::core::Result<(StorageFile, StorageFolder)> {
            Ok((StorageFile::GetFileFromPathAsync(&h(src))?.get()?, StorageFolder::GetFolderFromPathAsync(&h(dir))?.get()?))
        })()
        .map_err(|_| "Windows n'arrive pas à ouvrir ce fichier".to_string())?;
        let dest = folder
            .CreateFileAsync(&HSTRING::from(name), CreationCollisionOption::FailIfExists)
            .and_then(|op| op.get())
            .map_err(|_| "impossible de créer le nouveau fichier".to_string())?;
        let out = dir.join(name);
        // Ratée ou arrêtée : le fichier incomplet part à la Corbeille (jamais supprimé).
        let throw_away = |reason: String| -> Result<PathBuf, String> {
            let _ = crate::services::files::to_trash(std::slice::from_ref(&out));
            Err(reason)
        };

        let transcoder = match MediaTranscoder::new() {
            Ok(t) => t,
            Err(_) => return throw_away("le convertisseur de Windows est indisponible".into()),
        };
        let _ = transcoder.SetHardwareAccelerationEnabled(true);
        let prepared = match transcoder.PrepareFileTranscodeAsync(&source, &dest, &profile).and_then(|op| op.get()) {
            Ok(p) => p,
            Err(_) => return throw_away("Windows ne sait pas lire ce fichier".into()),
        };
        if !prepared.CanTranscode().unwrap_or(false) {
            let reason = match prepared.FailureReason() {
                Ok(TranscodeFailureReason::CodecNotFound) => "il manque à Windows le codec de ce fichier (extension du Microsoft Store)",
                Ok(TranscodeFailureReason::InvalidProfile) => "Windows ne sait pas produire ce format à partir de ce fichier",
                _ => "Windows ne sait pas convertir ce fichier",
            };
            return throw_away(reason.into());
        }
        let action = match prepared.TranscodeAsync() {
            Ok(a) => a,
            Err(_) => return throw_away("la conversion n'a pas pu démarrer".into()),
        };
        // La progression arrive sur un autre thread (en pourcents) : on la
        // garde, et ce thread-ci la transmet en attendant la fin.
        let shared = Arc::new(Mutex::new(0.0f64));
        let seen = shared.clone();
        let _ = action.SetProgress(&AsyncActionProgressHandler::new(move |_, p| {
            *seen.locked() = *p / 100.0;
            Ok(())
        }));
        loop {
            match action.Status() {
                Ok(AsyncStatus::Started) => {}
                Ok(AsyncStatus::Completed) => break,
                Ok(AsyncStatus::Canceled) => return throw_away(crate::modules::convert_logic::CANCELLED.into()),
                _ => return throw_away("Windows s'est arrêté en route (fichier abîmé ?)".into()),
            }
            if cancel.load(Ordering::SeqCst) {
                let _ = action.Cancel();
            }
            progress(*shared.locked());
            std::thread::sleep(Duration::from_millis(120));
        }
        progress(1.0);
        Ok(out)
    }

    /// Une adresse « file:///C:/Mes%20photos » → « C:\Mes photos ».
    fn path_from_url(url: &str) -> Option<PathBuf> {
        let rest = url.strip_prefix("file:///")?;
        let bytes = rest.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            } else {
                out.push(if bytes[i] == b'/' { b'\\' } else { bytes[i] });
                i += 1;
            }
        }
        String::from_utf8(out).ok().map(PathBuf::from)
    }

    /// Sélectionne `file` dans l'Explorateur, seulement si une fenêtre de
    /// l'Explorateur montre déjà son dossier : on n'ouvre pas de fenêtre en plus.
    /// Sur un thread à part (le Shell demande un thread « STA »).
    pub fn select_if_open(file: &Path) {
        let file = file.to_path_buf();
        let _ = std::thread::Builder::new().name("ondine-explorateur".into()).spawn(move || {
            use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
            use windows::Win32::System::Variant::VARIANT;
            use windows::Win32::UI::Shell::{ILCreateFromPathW, ILFree, IShellWindows, IWebBrowser2, SHOpenFolderAndSelectItems, ShellWindows};
            let Some(dir) = file.parent() else { return };
            let dir = dir.to_string_lossy().trim_end_matches('\\').to_lowercase();
            unsafe {
                let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
                let shown = (|| -> windows::core::Result<bool> {
                    let windows: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_ALL)?;
                    for i in 0..windows.Count()? {
                        let Ok(item) = windows.Item(&VARIANT::from(i)) else { continue };
                        let Ok(browser) = item.cast::<IWebBrowser2>() else { continue };
                        let Ok(url) = browser.LocationURL() else { continue };
                        let Some(path) = path_from_url(&url.to_string()) else { continue };
                        if path.to_string_lossy().trim_end_matches('\\').to_lowercase() == dir {
                            return Ok(true);
                        }
                    }
                    Ok(false)
                })()
                .unwrap_or(false);
                if shown {
                    // Un seul élément, chemin complet : l'Explorateur reprend la
                    // fenêtre qui montre ce dossier et y sélectionne le fichier.
                    let pidl = ILCreateFromPathW(&h(&file));
                    if !pidl.is_null() {
                        let _ = SHOpenFolderAndSelectItems(pidl, None, 0);
                        ILFree(Some(pidl));
                    }
                }
                if init {
                    CoUninitialize();
                }
            }
        });
    }
}

#[cfg(not(windows))]
mod stub {
    use super::{MediaQuality, MediaTarget};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::AtomicBool;

    const ONLY: &str = "disponible seulement sous Windows";

    pub fn decode_image(_path: &Path) -> Result<image::RgbaImage, String> {
        Err(ONLY.into())
    }

    pub fn encode_tiff(_img: &image::RgbaImage, _out: &Path) -> Result<(), String> {
        Err(ONLY.into())
    }

    pub fn pdf_pages(
        _path: &Path,
        _dpi: f64,
        _max_pages: u32,
        _cancel: &AtomicBool,
        _page: &mut dyn FnMut(u32, u32, Vec<u8>) -> Result<(), String>,
    ) -> Result<u32, String> {
        Err(ONLY.into())
    }

    pub fn transcode(
        _src: &Path,
        _dir: &Path,
        _name: &str,
        _target: MediaTarget,
        _quality: MediaQuality,
        _cancel: &AtomicBool,
        _progress: &mut dyn FnMut(f64),
    ) -> Result<PathBuf, String> {
        Err(ONLY.into())
    }

    pub fn select_if_open(_file: &Path) {}
}
