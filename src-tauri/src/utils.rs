use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Commands run off the main thread (`#[tauri::command(async)]`), so two of them can
/// now be in flight at the same time. A millisecond timestamp alone is no longer a
/// unique name, hence the pid + counter suffix.
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub fn temp_file_path(extension: &str) -> Result<PathBuf, String> {
    let since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("Saat bilgisi okunamadi: {err}"))?
        .as_millis();

    let seq = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    // No dots in the stem: callers rely on `with_extension` to derive sibling paths.
    let stem = format!("ocr-capture-{}-{}-{}", std::process::id(), since_epoch, seq);

    let mut path = std::env::temp_dir();
    path.push(if extension.is_empty() {
        stem
    } else {
        format!("{stem}.{extension}")
    });
    Ok(path)
}

/// True when `path` lives in the temp directory and carries our prefix, i.e. it is
/// safe for the frontend to ask us to delete.
fn is_own_temp_file(path: &std::path::Path) -> bool {
    path.parent().is_some_and(|dir| dir == std::env::temp_dir())
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with("ocr-capture-"))
}

/// Removes a single temp artefact the frontend has finished with.
///
/// Capture, crop and clipboard-paste PNGs were never deleted; only the start-up sweep
/// removed them, and only after six hours. A tray app left running for a day filled
/// `%TEMP%` with full-desktop screenshots (10 MB each at 4K).
pub fn delete_temp_file(path: &str) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !is_own_temp_file(&target) {
        return Err(String::from("Sadece gecici yakalama dosyalari silinebilir."));
    }
    match std::fs::remove_file(&target) {
        Ok(()) => Ok(()),
        // Already gone is not a failure for the caller.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("Dosya silinemedi: {err}")),
    }
}

/// 6 saatten daha eski ocr-capture-* geçici dosyalarını temizler
pub fn cleanup_old_temp_files() {
    const MAX_AGE_SECS: u64 = 6 * 3600;
    cleanup_temp_files_older_than(MAX_AGE_SECS);
}

/// Removes every ocr-capture-* temp file older than `max_age_secs`.
pub fn cleanup_temp_files_older_than(max_age_secs: u64) {
    let temp_dir = std::env::temp_dir();
    let Ok(entries) = std::fs::read_dir(temp_dir) else { return };
    let now = SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        if !is_own_temp_file(&path) {
            continue;
        }
        if let Ok(metadata) = entry.metadata() {
            if let Ok(modified) = metadata.modified() {
                if let Ok(duration) = now.duration_since(modified) {
                    if duration.as_secs() > max_age_secs {
                        let _ = std::fs::remove_file(path);
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

    #[test]
    fn test_temp_file_path_is_unique_per_call() {
        // Concurrent commands must never share a path, or they overwrite each other's
        // intermediates mid-run.
        let paths: Vec<PathBuf> = (0..1000).map(|_| temp_file_path("png").unwrap()).collect();
        let unique: std::collections::HashSet<&PathBuf> = paths.iter().collect();
        assert_eq!(paths.len(), unique.len(), "temp file names collided");
    }

    #[test]
    fn test_temp_file_stem_has_no_dot() {
        // Callers build sibling paths with with_extension(); a dot in the stem would be
        // silently stripped and point every derived path at the same file.
        let stem = temp_file_path("").unwrap();
        let name = stem.file_name().unwrap().to_string_lossy();
        assert!(!name.contains('.'), "stem must not contain a dot: {name}");

        let png = stem.with_extension("png");
        let txt = stem.with_extension("txt");
        assert_ne!(png, txt);
    }
}