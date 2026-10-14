use image::{imageops, ImageBuffer, RgbaImage};
use screenshots::Screen;
use serde::Serialize;
use std::cmp;
use std::path::Path;

/// Converts a logical display coordinate/length into physical pixels.
fn to_physical(scale_factor: f32, value: i32) -> i64 {
    (value as f64 * scale_factor as f64).round() as i64
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResponse {
    pub image_path: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

#[tauri::command(async)]
pub fn get_monitors() -> Result<Vec<MonitorInfo>, String> {
    let screens = Screen::all().map_err(|err| format!("Ekran listesi alinamadi: {err}"))?;

    let monitors = screens
        .iter()
        .enumerate()
        .map(|(index, screen)| MonitorInfo {
            id: index as u32,
            name: format!("Monitor {}", index + 1),
            x: screen.display_info.x,
            y: screen.display_info.y,
            width: screen.display_info.width,
            height: screen.display_info.height,
            is_primary: screen.display_info.is_primary,
        })
        .collect();

    Ok(monitors)
}

/// Converts a display position/size from logical units to physical pixels.
///
/// `display_info` reports logical coordinates while `Screen::capture()` returns a
/// buffer scaled by `scale_factor`. Mixing the two silently clipped the capture on any
/// multi-monitor setup where the secondary display was not at 100% scaling.
#[tauri::command(async)]
pub fn capture_screen(monitor_id: Option<u32>) -> Result<CaptureResponse, String> {
    let screens = Screen::all().map_err(|err| format!("Ekran listesi alinamadi: {err}"))?;

    if screens.is_empty() {
        return Err(String::from("Hicbir ekran algilanmadi."));
    }

    let final_image: RgbaImage;
    let mut failed_monitors = 0usize;

    if let Some(id) = monitor_id {
        let screen = screens
            .get(id as usize)
            .ok_or_else(|| format!("Monitor ID {} bulunamadi.", id))?;

        let captured_image = screen
            .capture()
            .map_err(|err| format!("Ekran {} yakalanamadi: {}", id, err))?;

        let width = captured_image.width();
        let height = captured_image.height();
        let raw_pixels = captured_image.into_raw();

        final_image = RgbaImage::from_raw(width, height, raw_pixels)
            .ok_or_else(|| String::from("Goruntu verisi islenemedi (Buffer olusturma hatasi)."))?;
    } else {
        // Combine every monitor into one virtual desktop, in physical pixels.
        let mut min_x = i64::MAX;
        let mut min_y = i64::MAX;
        let mut max_x = i64::MIN;
        let mut max_y = i64::MIN;

        for screen in &screens {
            let info = &screen.display_info;
            let x = to_physical(info.scale_factor, info.x);
            let y = to_physical(info.scale_factor, info.y);
            let w = to_physical(info.scale_factor, info.width as i32);
            let h = to_physical(info.scale_factor, info.height as i32);

            min_x = cmp::min(min_x, x);
            min_y = cmp::min(min_y, y);
            max_x = cmp::max(max_x, x + w);
            max_y = cmp::max(max_y, y + h);
        }

        let total_width = (max_x - min_x) as u32;
        let total_height = (max_y - min_y) as u32;

        if total_width == 0 || total_height == 0 {
            return Err(String::from("Ekran boyutlari gecersiz."));
        }

        let mut combined = ImageBuffer::new(total_width, total_height);

        for screen in &screens {
            let info = &screen.display_info;
            match screen.capture() {
                Ok(captured) => {
                    // `screenshots` links its own `image` version, so the buffer has to
                    // be re-wrapped through raw pixels before it can be overlaid with
                    // the crate we depend on directly.
                    let w = captured.width();
                    let h = captured.height();
                    let pixels = captured.into_raw();
                    let Some(buf) = RgbaImage::from_raw(w, h, pixels) else {
                        failed_monitors += 1;
                        continue;
                    };

                    let rx = to_physical(info.scale_factor, info.x) - min_x;
                    let ry = to_physical(info.scale_factor, info.y) - min_y;
                    imageops::overlay(&mut combined, &buf, rx, ry);
                }
                // A monitor that refused to capture used to be skipped silently, leaving
                // a black rectangle while the response still claimed success.
                Err(_) => failed_monitors += 1,
            }
        }

        final_image = combined;
    }

    let path = crate::utils::temp_file_path("png")?;
    final_image.save(&path).map_err(|err| {
        let _ = std::fs::remove_file(&path);
        format!("Goruntu kaydedilemedi: {err}")
    })?;

    if failed_monitors > 0 {
        // Not fatal: the caller still gets a usable image, but must be told part of the
        // desktop is missing rather than discovering black pixels on their own.
        eprintln!("UYARI: {failed_monitors} ekran yakalanamadi.");
    }

    Ok(CaptureResponse {
        image_path: path.to_string_lossy().to_string(),
        width: final_image.width(),
        height: final_image.height(),
    })
}

#[tauri::command(async)]
pub fn save_file_to_disk(
    source_path: Option<String>,
    base64_data: Option<String>,
    destination_path: String,
) -> Result<(), String> {
    // The save dialog offers png/jpg/jpeg, but the payload is always PNG bytes. Choosing
    // .jpg used to produce a PNG file with a .jpg extension: every viewer, thumbnailer
    // and later image::open on that path then misbehaved, with no error anywhere.
    let extension = Path::new(&destination_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let wants_jpeg = matches!(extension.as_str(), "jpg" | "jpeg");

    let raw = if let Some(src) = source_path {
        std::fs::read(&src).map_err(|e| format!("Dosya okunamadi: {e}"))?
    } else if let Some(b64) = base64_data {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;
        let clean_b64 = match b64.find(',') {
            Some(idx) => &b64[idx + 1..],
            None => &b64[..],
        };
        STANDARD
            .decode(clean_b64)
            .map_err(|e| format!("Base64 cozumleme hatasi: {e}"))?
    } else {
        return Err(String::from("Kaydedilecek gorsel verisi bulunamadi."));
    };

    if wants_jpeg {
        let decoded = image::load_from_memory(&raw).map_err(|e| format!("Gorsel acilamadi: {e}"))?;
        decoded
            .write_to(
                &mut std::fs::File::create(&destination_path)
                    .map_err(|e| format!("Dosya yazilamadi: {e}"))?,
                image::ImageFormat::Jpeg,
            )
            .map_err(|e| format!("JPEG kodlama hatasi: {e}"))?;
    } else {
        std::fs::write(&destination_path, raw).map_err(|e| format!("Dosya yazilamadi: {e}"))?;
    }

    Ok(())
}

#[tauri::command(async)]
pub fn save_text_file(content: String, destination_path: String) -> Result<(), String> {
    std::fs::write(&destination_path, content).map_err(|e| format!("Metin dosyasi yazilamadi: {e}"))?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CroppedResponse {
    pub image_path: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command(async)]
pub fn crop_image_file(
    source_path: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<CroppedResponse, String> {
    use image::GenericImageView;

    let img = image::open(&source_path).map_err(|e| format!("Görsel açılamadı: {e}"))?;
    let (orig_w, orig_h) = img.dimensions();

    if orig_w == 0 || orig_h == 0 {
        return Err(String::from("Görsel boyutları geçersiz."));
    }

    // Reject an out-of-bounds selection instead of clamping it to the last column,
    // which produced a one-pixel sliver that OCR'd into empty garbage.
    if x >= orig_w || y >= orig_h {
        return Err(format!(
            "Seçim görsel sınırları dışında (görsel: {orig_w}x{orig_h}, seçim: {x},{y})."
        ));
    }

    let crop_x = x.min(orig_w - 1);
    let crop_y = y.min(orig_h - 1);
    let crop_w = width.clamp(1, orig_w - crop_x);
    let crop_h = height.clamp(1, orig_h - crop_y);

    let cropped = img.crop_imm(crop_x, crop_y, crop_w, crop_h);
    let out_path = crate::utils::temp_file_path("png")?;
    if let Err(err) = cropped.save(&out_path) {
        // A failed save can leave a truncated file behind.
        let _ = std::fs::remove_file(&out_path);
        return Err(format!("Kırpılan görsel kaydedilemedi: {err}"));
    }

    Ok(CroppedResponse {
        image_path: out_path.to_string_lossy().to_string(),
        width: crop_w,
        height: crop_h,
    })
}

/// Deletes a capture/crop temp file the frontend has finished with.
#[tauri::command(async)]
pub fn delete_temp_file(path: String) -> Result<(), String> {
    crate::utils::delete_temp_file(&path)
}

/// Sweeps abandoned temp files older than `max_age_secs` (default: one hour).
#[tauri::command(async)]
pub fn cleanup_temp_files(max_age_secs: Option<u64>) -> Result<(), String> {
    crate::utils::cleanup_temp_files_older_than(max_age_secs.unwrap_or(3600));
    Ok(())
}