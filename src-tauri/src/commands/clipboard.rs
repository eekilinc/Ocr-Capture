use arboard::Clipboard;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use image::{ImageBuffer, Rgba};
use std::io::Cursor;

#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| format!("Pano açılamadı: {e}"))?;
    clipboard.set_text(text).map_err(|e| format!("Panoya kopyalanamadı: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn read_clipboard_image() -> Result<String, String> {
    let mut clipboard = Clipboard::new().map_err(|e| format!("Pano açılamadı: {e}"))?;
    let img_data = clipboard.get_image().map_err(|e| format!("Panoda görsel bulunamadı: {e}"))?;

    let width = img_data.width as u32;
    let height = img_data.height as u32;

    let img_buffer: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(width, height, img_data.bytes.into_owned())
        .ok_or_else(|| String::from("Görsel verisi işlenemedi."))?;

    let mut png_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut png_bytes);
    img_buffer.write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("PNG kodlama hatası: {e}"))?;

    Ok(STANDARD.encode(&png_bytes))
}
