use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn temp_file_path(extension: &str) -> Result<PathBuf, String> {
    let since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("Saat bilgisi okunamadi: {err}"))?
        .as_millis();

    let mut path = std::env::temp_dir();
    let file_name = if extension.is_empty() {
        format!("ocr-capture-{}", since_epoch)
    } else {
        format!("ocr-capture-{}.{}", since_epoch, extension)
    };
    path.push(file_name);
    Ok(path)
}

/// 6 saatten daha eski ocr-capture-* geçici dosyalarını temizler
pub fn cleanup_old_temp_files() {
    let temp_dir = std::env::temp_dir();
    let Ok(entries) = std::fs::read_dir(temp_dir) else { return; };
    let now = SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with("ocr-capture-") {
                if let Ok(metadata) = entry.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        if let Ok(duration) = now.duration_since(modified) {
                            if duration.as_secs() > 6 * 3600 {
                                let _ = std::fs::remove_file(path);
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_temp_file_path() {
        let path = temp_file_path("png").unwrap();
        assert!(path.to_string_lossy().contains("ocr-capture-"));
        assert!(path.to_string_lossy().ends_with(".png"));
    }
}
