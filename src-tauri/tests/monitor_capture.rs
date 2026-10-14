//! Diagnostic: does the combined multi-monitor capture actually contain every monitor?
//!
//! Run with: cargo test -- --ignored --nocapture
use image::GenericImageView;
use screenshots::Screen;

#[test]
#[ignore = "gercek ekran gerekir"]
fn combined_capture_matches_the_monitors() {
    let screens = Screen::all().expect("ekran listesi alinamadi");
    println!("---- ekranlar ----");

    for (i, s) in screens.iter().enumerate() {
        let info = &s.display_info;
        let cap = s.capture();
        println!(
            "mon[{}] id={} x={} y={} w={} h={} primary={} scale_factor={}",
            i, info.id, info.x, info.y, info.width, info.height,
            info.is_primary, info.scale_factor,
        );
        match cap {
            Ok(img) => {
                let (cw, ch) = img.dimensions();
                let expected_w = (info.width as f32 * info.scale_factor) as u32;
                let expected_h = (info.height as f32 * info.scale_factor) as u32;
                println!(
                    "        capture -> {}x{}  (beklenen {}x{}) {}",
                    cw, ch, expected_w, expected_h,
                    if cw == info.width && ch == info.height { "[MATCH] " } else { "[MISMATCH] " }
                );
            }
            Err(e) => println!("        capture FAILED: {e}"),
        }
    }

    // Reproduce the bounding box exactly as capture.rs computes it.
    let mut min_x = i64::MAX;
    let mut min_y = i64::MAX;
    let mut max_x = i64::MIN;
    let mut max_y = i64::MIN;
    for screen in &screens {
        let info = &screen.display_info;
        let to_physical = |v: i32| (v as f64 * info.scale_factor as f64).round() as i64;
        let x = to_physical(info.x);
        let y = to_physical(info.y);
        let w = to_physical(info.width as i32);
        let h = to_physical(info.height as i32);
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x + w);
        max_y = max_y.max(y + h);
    }
    let combined_w = (max_x - min_x) as u32;
    let combined_h = (max_y - min_y) as u32;
    println!("---- birlesik tampon ----");
    println!("combined = {combined_w}x{combined_h}");

    let mut content_w = 0u32;
    let mut content_h = 0u32;
    for screen in &screens {
        if let Ok(img) = screen.capture() {
            content_w = content_w.max(img.width());
            content_h = content_h.max(img.height());
        }
    }
    println!("en buyuk tek ekran = {content_w}x{content_h}");

    if combined_w < content_w || combined_h < content_h {
        println!(
            "!! BUFFER KUCUK: birlestirilen {combined_w}x{combined_h} < tek ekran {content_w}x{content_h}"
        );
        println!("!! overlay sessizce kirpiyor -> ekranin bir kismi okunmuyor");
    } else {
        println!("tamam: tampon tek ekrandan kucuk degil");
    }
}