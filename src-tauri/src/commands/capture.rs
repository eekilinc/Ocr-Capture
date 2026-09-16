use image::{imageops, ImageBuffer, RgbaImage};
use screenshots::Screen;
use serde::Serialize;
use std::cmp;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResponse {
    pub image_path: String,
    pub width: u32,
    pub height: u32,
    pub platform_note: String,
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

#[tauri::command]
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

#[tauri::command]
pub fn capture_screen(monitor_id: Option<u32>) -> Result<CaptureResponse, String> {
    let screens = Screen::all().map_err(|err| format!("Ekran listesi alinamadi: {err}"))?;

    if screens.is_empty() {
        return Err(String::from("Hicbir ekran algilanmadi."));
    }

    let final_image: RgbaImage;
    let platform_note: String;

    // Eger spesifik bir monitor istenmisse onu yakala
    if let Some(id) = monitor_id {
        if let Some(screen) = screens.get(id as usize) {
            let captured_image = screen
                .capture()
                .map_err(|err| format!("Ekran {} yakalanamadi: {}", id, err))?;

            let width = captured_image.width();
            let height = captured_image.height();
            let raw_pixels = captured_image.into_raw();

            final_image = RgbaImage::from_raw(width, height, raw_pixels)
                .ok_or_else(|| String::from("Goruntu verisi islenemedi (Buffer olusturma hatasi)."))?;
            
            platform_note = format!("Monitor {} yakalandi.", id + 1);
        } else {
            return Err(format!("Monitor ID {} bulunamadi.", id));
        }
    } else {
        // Monitor ID belirtilmemisse TUM EKRANLARI BIRLESTIR
        let mut min_x = i32::MAX;
        let mut min_y = i32::MAX;
        let mut max_x = i32::MIN;
        let mut max_y = i32::MIN;

        for screen in &screens {
            min_x = cmp::min(min_x, screen.display_info.x);
            min_y = cmp::min(min_y, screen.display_info.y);
            max_x = cmp::max(max_x, screen.display_info.x + screen.display_info.width as i32);
            max_y = cmp::max(max_y, screen.display_info.y + screen.display_info.height as i32);
        }

        let total_width = (max_x - min_x) as u32;
        let total_height = (max_y - min_y) as u32;
        let mut combined = ImageBuffer::new(total_width, total_height);

        for screen in screens {
            if let Ok(captured) = screen.capture() {
                let w = captured.width();
                let h = captured.height();
                let pixels = captured.into_raw();
                if let Some(buf) = RgbaImage::from_raw(w, h, pixels) {
                    let rx = (screen.display_info.x - min_x) as i64;
                    let ry = (screen.display_info.y - min_y) as i64;
                    imageops::overlay(&mut combined, &buf, rx, ry);
                }
            }
        }
        final_image = combined;
        platform_note = String::from("Tum ekranlar birlestirildi.");
    }

    let path = crate::utils::temp_file_path("png")?;
    final_image.save(&path)
        .map_err(|err| format!("Goruntu kaydedilemedi: {err}"))?;

    Ok(CaptureResponse {
        image_path: path.to_string_lossy().to_string(),
        width: final_image.width(),
        height: final_image.height(),
        platform_note,
    })
}

#[tauri::command]
pub fn save_file_to_disk(source_path: Option<String>, base64_data: Option<String>, destination_path: String) -> Result<(), String> {
    if let Some(src) = source_path {
        std::fs::copy(&src, &destination_path).map_err(|e| format!("Dosya kopyalanamadi: {e}"))?;
    } else if let Some(b64) = base64_data {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;
        let clean_b64 = if let Some(idx) = b64.find(',') {
            &b64[idx + 1..]
        } else {
            &b64
        };
        let bytes = STANDARD.decode(clean_b64).map_err(|e| format!("Base64 cozumleme hatasi: {e}"))?;
        std::fs::write(&destination_path, bytes).map_err(|e| format!("Dosya yazilamadi: {e}"))?;
    } else {
        return Err(String::from("Kaydedilecek gorsel verisi bulunamadi."));
    }
    Ok(())
}

#[tauri::command]
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

#[tauri::command]
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

    let crop_x = x.min(orig_w.saturating_sub(1));
    let crop_y = y.min(orig_h.saturating_sub(1));
    let crop_w = width.min(orig_w.saturating_sub(crop_x)).max(1);
    let crop_h = height.min(orig_h.saturating_sub(crop_y)).max(1);

    let cropped = img.crop_imm(crop_x, crop_y, crop_w, crop_h);
    let out_path = crate::utils::temp_file_path("png")?;
    cropped
        .save(&out_path)
        .map_err(|e| format!("Kırpılan görsel kaydedilemedi: {e}"))?;

    Ok(CroppedResponse {
        image_path: out_path.to_string_lossy().to_string(),
        width: crop_w,
        height: crop_h,
    })
}


