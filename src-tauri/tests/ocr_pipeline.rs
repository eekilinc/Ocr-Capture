//! Compares the preprocessing pipeline against a real Tesseract install.
//!
//! Run with: cargo test -- --ignored --nocapture
use std::process::Command;
use std::path::PathBuf;
use image::GenericImageView;

fn tesseract_bin() -> PathBuf {
    if let Ok(p) = std::env::var("TESSERACT_PATH") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return p;
        }
    }
    for candidate in [
        r"C:\Users\Ekrem\AppData\Local\Programs\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    ] {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from("tesseract")
}

fn word_count(text: &str) -> usize {
    text.split_whitespace().filter(|w| !w.is_empty()).count()
}

fn run_tesseract(png: &PathBuf, stem: &str) -> String {
    let out = Command::new(tesseract_bin())
        .arg(png)
        .arg(stem)
        .arg("-l")
        .arg("tur+eng")
        .arg("txt")
        .output()
        .expect("tesseract calistirilamadi");
    if !out.status.success() {
        panic!(
            "tesseract basarisiz: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    std::fs::read_to_string(format!("{stem}.txt")).unwrap_or_default()
}

/// The scaling rule as it was before the shorter-edge rewrite.
fn old_resize(img: image::DynamicImage) -> image::DynamicImage {
    const MAX_DIM: u32 = 2500;
    const MIN_DIM: u32 = 1000;
    let (width, height) = img.dimensions();
    if width > MAX_DIM || height > MAX_DIM {
        img.resize(MAX_DIM, MAX_DIM, image::imageops::FilterType::Lanczos3)
    } else if width < MIN_DIM && height < MIN_DIM {
        img.resize(width * 2, height * 2, image::imageops::FilterType::Lanczos3)
    } else {
        img
    }
}

/// The current rule: scale by the shorter edge.
fn new_resize(img: image::DynamicImage) -> image::DynamicImage {
    const MAX_DIM: u32 = 2500;
    const MIN_DIM: u32 = 1000;
    let (width, height) = img.dimensions();
    let shorter = width.min(height);
    let longer = width.max(height);

    if shorter < MIN_DIM {
        let factor = (MIN_DIM as f32 / shorter.max(1) as f32)
            .min(MAX_DIM as f32 / longer.max(1) as f32)
            .clamp(1.0, 2.0);
        img.resize(
            (width as f32 * factor).round() as u32,
            (height as f32 * factor).round() as u32,
            image::imageops::FilterType::Lanczos3,
        )
    } else if longer > MAX_DIM {
        img.resize(MAX_DIM, MAX_DIM, image::imageops::FilterType::Lanczos3)
    } else {
        img
    }
}

fn preprocess(src: &str, tag: &str, resize: fn(image::DynamicImage) -> image::DynamicImage) -> PathBuf {
    let img = image::open(src).expect("kaynak acilamadi");
    let img = img.grayscale().adjust_contrast(20.0);
    let out = resize(img);
    let path = std::env::temp_dir().join(format!("ocrtest-{tag}.png"));
    out.save(&path).expect("islenemedi");
    path
}

#[test]
#[ignore = "gercek Tesseract kurulumu gerekir"]
fn scaling_rule_does_not_lose_words() {
    let src = std::env::var("OCR_TEST_IMAGE").expect("OCR_TEST_IMAGE ayarla");

    let raw = word_count(&run_tesseract(&PathBuf::from(&src), &std::env::temp_dir().join("ocrtest-raw").display().to_string()));

    let old_png = preprocess(&src, "old", old_resize);
    let old = word_count(&run_tesseract(&old_png, &std::env::temp_dir().join("ocrtest-old").display().to_string()));

    let new_png = preprocess(&src, "new", new_resize);
    let new = word_count(&run_tesseract(&new_png, &std::env::temp_dir().join("ocrtest-new").display().to_string()));

    println!("---- kelime sayilari ----");
    println!("islenmemis (ham) : {raw}");
    println!("eski olcekleme   : {old}");
    println!("yeni olcekleme   : {new}");

    let dims = |p: &PathBuf| { let i = image::open(p).unwrap(); i.dimensions() };
    println!("boyutlar: ham={:?} eski={:?} yeni={:?}",
        dims(&PathBuf::from(&src)), dims(&old_png), dims(&new_png));

    // The new rule must not read materially fewer words than the old one.
    assert!(
        new as f64 >= (old as f64 * 0.95),
        "YENI kural eskisinden az okuyor: yeni={new} eski={old}"
    );
}