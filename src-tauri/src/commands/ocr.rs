use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;

#[derive(Debug, Deserialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrInput {
    pub image_base64: Option<String>,
    pub image_path: Option<String>,
    pub languages: Option<String>,
    pub enhance: Option<bool>,
    pub crop: Option<Rect>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OcrWord {
    pub text: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub conf: f32,
}

#[derive(Debug, Serialize)]
pub struct OcrResponse {
    pub text: String,
    pub engine: String,
    pub words: Vec<OcrWord>,
}

fn resolve_tesseract_binary() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("TESSERACT_PATH") {
        let explicit = PathBuf::from(path);
        if explicit.exists() {
            return Ok(explicit);
        }
    }

    if let Ok(path) = which::which("tesseract") {
        return Ok(path);
    }

    if cfg!(target_os = "windows") {
        let mut candidates = Vec::new();
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join("Programs/Tesseract-OCR/tesseract.exe"));
        }
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("Tesseract-OCR/tesseract.exe"));
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(PathBuf::from(program_files_x86).join("Tesseract-OCR/tesseract.exe"));
        }
        candidates.push(PathBuf::from(r"C:\Program Files\Tesseract-OCR\tesseract.exe"));
        candidates.push(PathBuf::from(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"));

        for candidate in candidates {
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(String::from("Tesseract bulunamadi. Lutfen Tesseract OCR kurun."))
}

fn get_tessdata_dir(tesseract_bin: &PathBuf) -> Result<PathBuf, String> {
    // 1. TESSDATA_PREFIX env var
    if let Ok(prefix) = std::env::var("TESSDATA_PREFIX") {
        let pb = PathBuf::from(prefix);
        if pb.exists() { return Ok(pb); }
    }

    // 2. Relative to binary
    if let Some(parent) = tesseract_bin.parent() {
        let tessdata = parent.join("tessdata");
        if tessdata.exists() { return Ok(tessdata); }
    }

    // 3. Common linux paths if not windows
    if !cfg!(target_os = "windows") {
        let common = PathBuf::from("/usr/share/tesseract-ocr/5/tessdata");
        if common.exists() { return Ok(common); }
    }

    Err(String::from("tessdata klasoru bulunamadi."))
}

fn get_installed_languages(tesseract_bin: &PathBuf) -> HashSet<String> {
    let mut cmd = Command::new(tesseract_bin);
    cmd.arg("--list-langs");

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output();
    let Ok(out) = output else {
        return HashSet::new();
    };

    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with("List of available languages"))
        .map(ToOwned::to_owned)
        .collect()
}

fn resolve_language_list(requested: &str, installed: &HashSet<String>) -> String {
    let available: Vec<String> = requested
        .split('+')
        .map(str::trim)
        .filter(|lang| !lang.is_empty())
        .filter(|lang| installed.contains(*lang))
        .map(ToOwned::to_owned)
        .collect();

    if !available.is_empty() {
        return available.join("+");
    }

    if installed.contains("eng") {
        return String::from("eng");
    }

    requested.to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TesseractStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[tauri::command]
pub fn check_tesseract_installed() -> TesseractStatus {
    match resolve_tesseract_binary() {
        Ok(bin_path) => {
            let mut cmd = Command::new(&bin_path);
            cmd.arg("--version");
            #[cfg(target_os = "windows")]
            {
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            let version = cmd.output().ok().and_then(|out| {
                let first_line = String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .to_string();
                if first_line.is_empty() { None } else { Some(first_line) }
            });

            TesseractStatus {
                installed: true,
                path: Some(bin_path.to_string_lossy().to_string()),
                version,
            }
        }
        Err(_) => TesseractStatus {
            installed: false,
            path: None,
            version: None,
        }
    }
}

#[tauri::command]
pub fn list_ocr_languages() -> Result<Vec<String>, String> {
    let tesseract_bin = resolve_tesseract_binary()?;
    let mut langs: Vec<String> = get_installed_languages(&tesseract_bin)
        .into_iter()
        .filter(|l| l != "osd" && l != "equ")
        .collect();
    langs.sort();
    Ok(langs)
}

#[tauri::command]
pub async fn download_ocr_language(lang: String) -> Result<String, String> {
    let tesseract_bin = resolve_tesseract_binary()?;
    let tessdata_dir = get_tessdata_dir(&tesseract_bin)?;
    
    let url = format!("https://github.com/tesseract-ocr/tessdata_fast/raw/main/{}.traineddata", lang);
    let dest_path = tessdata_dir.join(format!("{}.traineddata", lang));

    println!("DEBUG: Dil indiriliyor: {} -> {:?}", url, dest_path);

    let response = reqwest::get(url).await.map_err(|e| format!("Baglanti hatasi: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Dil paketi indirilemedi: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| format!("Veri okunamadi: {e}"))?;
    fs::write(&dest_path, bytes).map_err(|e| format!("Dosya yazılamadı: {e}"))?;

    Ok(format!("{} dili basariyla yuklendi.", lang))
}

fn parse_tsv_words(tsv: &str) -> Vec<OcrWord> {
    tsv.lines()
        .skip(1)
        .filter_map(|line| {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() < 12 { return None; }
            let level: i32 = cols[0].parse().ok()?;
            if level != 5 { return None; }
            let text = cols[11].trim().to_string();
            if text.is_empty() { return None; }
            Some(OcrWord {
                text,
                x: cols[6].parse().ok()?,
                y: cols[7].parse().ok()?,
                width: cols[8].parse().ok()?,
                height: cols[9].parse().ok()?,
                conf: cols[10].parse().unwrap_or(0.0),
            })
        })
        .collect()
}

#[tauri::command]
pub fn run_ocr(input: OcrInput) -> Result<OcrResponse, String> {
    let tesseract_bin = resolve_tesseract_binary()?;
    let base_path = crate::utils::temp_file_path("")?; // No extension for prefix
    let png_path = base_path.with_extension("png");

    let mut img = if let Some(path_str) = input.image_path {
        image::open(path_str).map_err(|err| format!("Resim dosyası acılamadı: {err}"))?
    } else if let Some(base64_str) = input.image_base64 {
        let bytes = STANDARD.decode(base64_str).map_err(|err| format!("Base64 hatasi: {err}"))?;
        image::load_from_memory(&bytes).map_err(|err| format!("Resim yuklenemedi: {err}"))?
    } else {
        return Err(String::from("Resim verisi bulunamadi."));
    };

    // --- KIRPMA (CROPPING) ---
    if let Some(crop) = input.crop {
        let x = crop.x.max(0.0) as u32;
        let y = crop.y.max(0.0) as u32;
        let w = (crop.width as u32).min(img.width().saturating_sub(x));
        let h = (crop.height as u32).min(img.height().saturating_sub(y));
        if w > 0 && h > 0 {
            img = img.crop_imm(x, y, w, h);
        }
    }

    // --- KALITE IYILESTIRMER ---
    if input.enhance.unwrap_or(true) {
        // Grayscale ve Kontrat artirimi (Tesseract icin en iyi sonucu verir)
        img = img.grayscale();
        img = img.adjust_contrast(20.0); // Kontrasti %20 artir
    }

    // Boyutlandirma (OCR kalitesi icin ideal boyut 2000-2500px civaridir)
    let (width, height) = img.dimensions();
    const MAX_DIM: u32 = 2500;
    const MIN_DIM: u32 = 1000;
    
    if width > MAX_DIM || height > MAX_DIM {
        img = img.resize(MAX_DIM, MAX_DIM, image::imageops::FilterType::Lanczos3);
    } else if width < MIN_DIM && height < MIN_DIM {
        // Cok kucuk secimleri buyutmek OCR kalitesini artirir (Min 1000px civari idealdir)
        img = img.resize(width * 2, height * 2, image::imageops::FilterType::Lanczos3);
    }

    img.save(&png_path).map_err(|err| format!("Gecici dosya yazilamadi: {err}"))?;

    let requested_lang = input.languages.unwrap_or_else(|| String::from("tur+eng"));
    let installed_langs = get_installed_languages(&tesseract_bin);
    let lang = resolve_language_list(&requested_lang, &installed_langs);

    let output_prefix = base_path.to_str().ok_or("Gecersiz dosya yolu")?;
    let mut cmd = Command::new(&tesseract_bin);
    cmd.arg(&png_path)
        .arg(output_prefix)
        .arg("-l")
        .arg(&lang)
        .arg("txt")
        .arg("tsv");

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output()
        .map_err(|err| format!("Tesseract calistirilamadi: {err}"))?;

    let txt_path = base_path.with_extension("txt");
    let tsv_path = base_path.with_extension("tsv");

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let _ = fs::remove_file(&png_path);
        let _ = fs::remove_file(&txt_path);
        let _ = fs::remove_file(&tsv_path);
        return Err(format!("OCR islemi basarisiz oldu: {stderr}"));
    }

    let mut text = fs::read_to_string(&txt_path).unwrap_or_default().trim().to_string();
    let tsv_text = fs::read_to_string(&tsv_path).unwrap_or_default();

    // --- AKILLI PARAGRAF BIRLEŞTIRME (Smart Rejoining) ---
    // Eger bir satir nokta, soru isareti veya ünlemle bitmiyorsa ve altinda satir varsa birlestir.
    if !text.is_empty() {
        let mut joined = String::new();
        let lines: Vec<&str> = text.lines().collect();
        for i in 0..lines.len() {
            let current = lines[i].trim();
            if current.is_empty() { continue; }
            
            joined.push_str(current);
            
            if i < lines.len() - 1 {
                let last_char = current.chars().last().unwrap_or(' ');
                // Paragraf sonu belirtileri degilse bosluk ekle ve bir sonraki satira gec
                if !['.', ':', '!', '?'].contains(&last_char) && current.len() > 10 {
                    joined.push(' ');
                } else {
                    joined.push('\n');
                }
            }
        }
        text = joined.trim().to_string();
    }

    let _ = fs::remove_file(&png_path);
    let _ = fs::remove_file(&txt_path);
    let _ = fs::remove_file(&tsv_path);

    Ok(OcrResponse {
        text,
        engine: format!("Tesseract ({lang})"),
        words: parse_tsv_words(&tsv_text),
    })
}


