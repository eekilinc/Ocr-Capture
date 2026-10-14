mod commands;
mod utils;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// Mirrors the `minimize-to-tray` preference from the settings store so the close
/// handler can read it synchronously -- the window event fires on the main thread and
/// must not block on an async store read.
static MINIMIZE_TO_TRAY: AtomicBool = AtomicBool::new(true);

#[tauri::command(async)]
fn set_minimize_to_tray(enabled: bool) {
    MINIMIZE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let quit_i = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Göster", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("tray")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } => {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .icon(app.default_window_icon().unwrap().clone())
                .build(app)?;

            // Eski geçici ekran yakalama dosyalarını arka planda temizle. setup() ana
            // thread'de çalıştığı ve bu tarama %TEMP% üzerinde iki syscall/ girdi
            // yapıyor, pencere görünmeden önce gecikme yaratmasın diye thread'e alıyoruz.
            std::thread::spawn(utils::cleanup_old_temp_files);

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if MINIMIZE_TO_TRAY.load(Ordering::Relaxed) {
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
                api.prevent_close();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            set_minimize_to_tray,
            commands::capture::capture_screen,
            commands::capture::get_monitors,
            commands::capture::crop_image_file,
            commands::capture::delete_temp_file,
            commands::capture::cleanup_temp_files,
            commands::capture::save_file_to_disk,
            commands::capture::save_text_file,
            commands::clipboard::copy_to_clipboard,
            commands::clipboard::read_clipboard_image,
            commands::clipboard::paste_clipboard_image,
            commands::ocr::run_ocr,
            commands::ocr::list_ocr_languages,
            commands::ocr::download_ocr_language,
            commands::ocr::check_tesseract_installed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
