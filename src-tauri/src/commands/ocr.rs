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
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

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
    /// Dimensions of the preprocessed image the word coordinates refer to. The
    /// confidence map needs these to place words correctly without guessing the
    /// scale factor that the crop/resize pipeline happened to apply.
    pub image_width: u32,
    pub image_height: u32,
}

fn resolve_tesseract_binary() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("TESSERACT_PATH") {
        let explicit = PathBuf::from(path);
        // is_file(), not exists(): pointing TESSERACT_PATH at the install *folder*
        // (the natural mistake) passed the old check and then failed to spawn.
        if explicit.is_file() {
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
            if candidate.is_file() {
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

fn is_writable_dir(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    let probe = path.join(".ocr-capture-write-test");
    match fs::write(&probe, b"") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Root of the per-user tessdata location. Never creates anything.
fn user_tessdata_base() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        return std::env::var("LOCALAPPDATA").ok().map(PathBuf::from);
    }

    std::env::var("XDG_DATA_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".local/share")))
}

fn user_tessdata_path() -> Option<PathBuf> {
    let app_dir = if cfg!(target_os = "windows") { "MetinYakalayici" } else { "metin-yakalayici" };
    Some(user_tessdata_base()?.join(app_dir).join("tessdata"))
}

/// Path of the per-user tessdata directory, if it exists on this machine.
fn user_tessdata_dir() -> Option<PathBuf> {
    user_tessdata_path().filter(|dir| dir.is_dir())
}

/// Picks a tessdata directory the current user can actually write to.
///
/// A machine-wide Tesseract install keeps tessdata under `C:\Program Files`, which needs
/// elevation, so downloading a language pack there always failed with "Access is denied".
/// The per-user fallback is wired to the child process through TESSDATA_PREFIX, which
/// Tesseract reads alongside the install directory.
fn writable_tessdata_dir(tesseract_bin: &PathBuf) -> Result<PathBuf, String> {
    if let Ok(existing) = get_tessdata_dir(tesseract_bin) {
        if is_writable_dir(&existing) {
            return Ok(existing);
        }
    }

    let user_dir = user_tessdata_path()
        .unwrap_or_else(|| std::env::temp_dir().join("MetinYakalayici").join("tessdata"));

    if let Err(err) = fs::create_dir_all(&user_dir) {
        return Err(format!(
            "Yazilabilir tessdata klasoru olusturulamadi ({}): {err}",
            user_dir.display()
        ));
    }

    if !is_writable_dir(&user_dir) {
        return Err(format!("{} klasoru yazilabilir degil.", user_dir.display()));
    }

    Ok(user_dir)
}

/// Spawning `tesseract --list-langs` costs 60-250 ms (process creation, engine load,
/// tessdata enumeration), and it used to run inside every single OCR. The installed set
/// only changes when the user manages language packs, so cache it per binary path.
static INSTALLED_LANGS: OnceLock<Mutex<HashMap<PathBuf, HashSet<String>>>> = OnceLock::new();

fn installed_languages_cache() -> &'static Mutex<HashMap<PathBuf, HashSet<String>>> {
    INSTALLED_LANGS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn spawn_list_langs(tesseract_bin: &PathBuf) -> Result<HashSet<String>, String> {
    let mut cmd = Command::new(tesseract_bin);
    cmd.arg("--list-langs");

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let out = cmd
        .output()
        .map_err(|err| format!("Tesseract calistirilamadi: {err}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!("Tesseract dilleri okunamadi: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with("List of available languages"))
        .map(ToOwned::to_owned)
        .collect())
}

/// Returns the installed language set, spawning the binary only on a cache miss.
fn get_installed_languages(tesseract_bin: &PathBuf) -> Result<HashSet<String>, String> {
    let cache = installed_languages_cache();

    if let Ok(map) = cache.lock() {
        if let Some(hit) = map.get(tesseract_bin) {
            return Ok(hit.clone());
        }
    }

    let langs = spawn_list_langs(tesseract_bin)?;

    if let Ok(mut map) = cache.lock() {
        map.insert(tesseract_bin.clone(), langs.clone());
    }
    Ok(langs)
}

/// Invalidates the cached language list; called after a pack is downloaded.
fn invalidate_language_cache() {
    if let Ok(mut map) = installed_languages_cache().lock() {
        map.clear();
    }
}

/// Picks the languages to pass to Tesseract, and reports which ones were dropped so the
/// caller can tell the user instead of silently OCR-ing in a language they did not pick.
fn resolve_language_list(
    requested: &str,
    installed: &HashSet<String>,
) -> (String, Vec<String>) {
    let mut available: Vec<String> = requested
        .split('+')
        .map(str::trim)
        .filter(|lang| !lang.is_empty())
        .filter(|lang| installed.contains(*lang))
        .map(ToOwned::to_owned)
        .collect();
    available.sort();
    available.dedup();

    let missing: Vec<String> = requested
        .split('+')
        .map(str::trim)
        .filter(|lang| !lang.is_empty())
        .filter(|lang| !installed.contains(*lang))
        .map(ToOwned::to_owned)
        .collect();

    if !available.is_empty() {
        return (available.join("+"), missing);
    }

    // Nothing requested is installed. Falling back to `eng` silently ran an English OCR
    // on a Turkish document and returned it as a success, so say so in the engine label.
    if installed.contains("eng") {
        return (String::from("eng"), missing);
    }

    (requested.to_string(), missing)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TesseractStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn list_ocr_languages() -> Result<Vec<String>, String> {
    let tesseract_bin = resolve_tesseract_binary()?;
    // Propagate the failure: an empty list used to look like "no languages exist"
    // rather than "the engine is broken".
    let mut langs: Vec<String> = get_installed_languages(&tesseract_bin)?
        .into_iter()
        .filter(|l| l != "osd" && l != "equ")
        .collect();
    langs.sort();
    Ok(langs)
}

/// Tesseract language codes are short ASCII identifiers. Anything else is rejected
/// before it reaches the URL or the filesystem.
fn is_valid_lang_code(lang: &str) -> bool {
    !lang.is_empty()
        && lang.len() <= 12
        && lang
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

#[tauri::command(async)]
pub async fn download_ocr_language(lang: String) -> Result<String, String> {
    if !is_valid_lang_code(&lang) {
        return Err(format!("Gecersiz dil kodu: {lang}"));
    }

    let tesseract_bin = resolve_tesseract_binary()?;
    // A machine-wide install puts tessdata under Program Files, which a normal user
    // cannot write to. Fall back to a per-user directory that Tesseract honours
    // through TESSDATA_PREFIX instead of downloading megabytes and then failing.
    let tessdata_dir = writable_tessdata_dir(&tesseract_bin)?;

    let url = format!("https://github.com/tesseract-ocr/tessdata/raw/main/{}.traineddata", lang);
    let dest_path = tessdata_dir.join(format!("{lang}.traineddata"));

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Baglanti hatasi: {e}"))?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Baglanti hatasi: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Dil paketi indirilemedi: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| format!("Veri okunamadi: {e}"))?;

    // Write to a sibling temp file and rename: fs::write truncates in place, so an
    // interrupted download would leave a corrupt tur.traineddata behind and break
    // every later OCR until Tesseract is reinstalled.
    let temp_path = dest_path.with_extension("traineddata.part");
    fs::write(&temp_path, &bytes).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("Dosya yazilamadi: {e}")
    })?;
    fs::rename(&temp_path, &dest_path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("Dosya tasinamadi: {e}")
    })?;

    invalidate_language_cache();

    Ok(format!("{lang} dili basariyla yuklendi."))
}

/// Merges wrapped lines back into flowing text while preserving paragraph breaks.
///
/// A line that does not end in sentence punctuation and is long enough is treated as a
/// soft-wrapped line and joined to the next one with a space. Everything else keeps its
/// line break, and a blank line always becomes a paragraph break.
fn rejoin_paragraphs(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }

    const PARAGRAPH_END: [char; 4] = ['.', ':', '!', '?'];
    const MIN_JOINABLE_CHARS: usize = 10;

    let mut joined = String::new();
    let lines: Vec<&str> = text.lines().collect();

    for (i, line) in lines.iter().enumerate() {
        let current = line.trim();

        // Blank lines are paragraph separators; skipping them dropped the structure of
        // the source document entirely.
        if current.is_empty() {
            let trimmed_len = joined.trim_end_matches([' ', '\t', '\n']).len();
            if trimmed_len > 0 && !joined[..trimmed_len].ends_with("\n\n") {
                joined.truncate(trimmed_len);
                joined.push_str("\n\n");
            }
            continue;
        }

        joined.push_str(current);

        let has_next_content = lines[i + 1..].iter().any(|l| !l.trim().is_empty());
        if has_next_content {
            let last_char = current.chars().last().unwrap_or(' ');
            // str::len() counts BYTES. Turkish characters cost 2 bytes each, so the
            // threshold has to be compared against a character count.
            if !PARAGRAPH_END.contains(&last_char) && current.chars().count() > MIN_JOINABLE_CHARS {
                joined.push(' ');
            } else {
                joined.push('\n');
            }
        }
    }

    joined.trim().to_string()
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

#[tauri::command(async)]
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
        // The rect arrives straight off the wire as f32; reject non-finite values
        // explicitly instead of leaning on saturating float->int casts.
        let raw = [crop.x, crop.y, crop.width, crop.height];
        if !raw.iter().all(|v| v.is_finite()) {
            return Err(String::from("Kirpma koordinatlari gecersiz."));
        }
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

    // Scale by the SHORTER edge. The previous pair of conditions used `||` for the
    // downscale and `&&` for the upscale, so a tall narrow panel (100x6000) matched the
    // downscale branch and got squeezed to 42x2500 -- worse input than it arrived with
    // -- while a 300x2000 sidebar matched neither and was never enlarged at all.
    let shorter = width.min(height);
    let longer = width.max(height);

    if shorter < MIN_DIM {
        // Never enlarge past MAX_DIM.
        let factor = (MIN_DIM as f32 / shorter.max(1) as f32).min(MAX_DIM as f32 / longer.max(1) as f32);
        let factor = factor.clamp(1.0, 2.0);
        img = img.resize(
            (width as f32 * factor).round() as u32,
            (height as f32 * factor).round() as u32,
            image::imageops::FilterType::Lanczos3,
        );
    } else if longer > MAX_DIM {
        img = img.resize(MAX_DIM, MAX_DIM, image::imageops::FilterType::Lanczos3);
    }

    // Report the size of the image Tesseract actually saw, after cropping, grayscale,
    // contrast and any resize below.
    let (processed_width, processed_height) = img.dimensions();

    img.save(&png_path).map_err(|err| format!("Gecici dosya yazilamadi: {err}"))?;

    let requested_lang = input.languages.unwrap_or_else(|| String::from("tur+eng"));
    let mut installed_langs = get_installed_languages(&tesseract_bin)?;

    // Language packs downloaded into the per-user directory are invisible to
    // Tesseract unless TESSDATA_PREFIX points at it.
    let user_tessdata = user_tessdata_dir();
    if let Some(dir) = &user_tessdata {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Some(name) = entry.path().file_stem().and_then(|s| s.to_str()) {
                    installed_langs.insert(name.to_string());
                }
            }
        }
    }
    let (lang, missing_langs) = resolve_language_list(&requested_lang, &installed_langs);

    let output_prefix = base_path.to_str().ok_or_else(|| {
        let _ = fs::remove_file(&png_path);
        String::from("Gecersiz dosya yolu")
    })?;

    let mut cmd = Command::new(&tesseract_bin);
    cmd.arg(&png_path)
        .arg(output_prefix)
        .arg("-l")
        .arg(&lang)
        .arg("txt")
        .arg("tsv");

    if let Some(dir) = &user_tessdata {
        cmd.env("TESSDATA_PREFIX", dir);
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let txt_path = base_path.with_extension("txt");
    let tsv_path = base_path.with_extension("tsv");

    let output = cmd.output().map_err(|err| {
        let _ = fs::remove_file(&png_path);
        let _ = fs::remove_file(&txt_path);
        let _ = fs::remove_file(&tsv_path);
        format!("Tesseract calistirilamadi: {err}")
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let _ = fs::remove_file(&png_path);
        let _ = fs::remove_file(&txt_path);
        let _ = fs::remove_file(&tsv_path);
        // An empty stderr produced a message with nothing after the colon, and a
        // missing language pack was the most common cause -- say which one.
        let detail = if stderr.is_empty() {
            format!("cikis kodu {}", output.status)
        } else {
            stderr
        };
        let mut message = format!("OCR islemi basarisiz oldu: {detail}");
        if !missing_langs.is_empty() {
            message.push_str(&format!(" (kurulu olmayan dil: {})", missing_langs.join(", ")));
        }
        return Err(message);
    }

    // Tesseract 0 ile çıksa bile .txt üretilmemiş ya da okunamamış olabilir (disk
    // dolmuş, antivirüs karantinaya almış, bozuk çıktı). `unwrap_or_default()` bunu
    // "ekranda metin yok" gibi gösteriyordu; OCR aracı için en kötü hata türü.
    let mut text = match fs::read_to_string(&txt_path) {
        Ok(contents) => contents.trim().to_string(),
        Err(err) => {
            let _ = fs::remove_file(&png_path);
            let _ = fs::remove_file(&txt_path);
            let _ = fs::remove_file(&tsv_path);
            return Err(format!("OCR ciktisi okunamadi: {err}"));
        }
    };

    // TSV yalnizca kelime haritasi icin; yoksa sorun degil.
    let tsv_text = fs::read_to_string(&tsv_path).unwrap_or_default();

    // --- AKILLI PARAGRAF BIRLEŞTIRME (Smart Rejoining) ---
    text = rejoin_paragraphs(&text);

    let _ = fs::remove_file(&png_path);
    let _ = fs::remove_file(&txt_path);
    let _ = fs::remove_file(&tsv_path);

    Ok(OcrResponse {
        text,
        engine: format!("Tesseract ({lang})"),
        words: parse_tsv_words(&tsv_text),
        image_width: processed_width,
        image_height: processed_height,
    })
}

#[cfg(test)]
mod tests {
    use super::{is_valid_lang_code, rejoin_paragraphs, resolve_language_list};
    use std::collections::HashSet;

    #[test]
    fn joins_wrapped_sentence_with_a_space() {
        let out = rejoin_paragraphs("Bu bir örnek cümledir ve devamı\nburada geliyor.");
        assert_eq!(out, "Bu bir örnek cümledir ve devamı burada geliyor.");
    }

    #[test]
    fn threshold_is_counted_in_characters_not_bytes() {
        // "Şişli" is 5 chars / 10 bytes, "Başlangıç" is 10 chars / 12 bytes. A byte
        // threshold made short Turkish lines join and long ones split inconsistently.
        let short = "Şişli"; // 5 chars -> below threshold, keeps its own line
        let out = rejoin_paragraphs(&format!("{short}\nsonraki satır"));
        assert_eq!(out, "Şişli\nsonraki satır", "short Turkish line must not be joined");

        // 12 ASCII characters -> above threshold, so it does join.
        let long = "abcdefghijkl";
        let out = rejoin_paragraphs(&format!("{long}\nsonraki satır"));
        assert_eq!(out, "abcdefghijkl sonraki satır");
    }

    #[test]
    fn line_ending_in_sentence_punctuation_keeps_its_break() {
        let out = rejoin_paragraphs("İlk cümle burada bitiyor.\nİkinci satır devam ediyor");
        assert_eq!(out, "İlk cümle burada bitiyor.\nİkinci satır devam ediyor");
    }

    #[test]
    fn blank_line_becomes_a_paragraph_break() {
        let out = rejoin_paragraphs("Birinci madde burada.\n\nİkinci madde burada.");
        assert_eq!(out, "Birinci madde burada.\n\nİkinci madde burada.");
    }

    #[test]
    fn consecutive_blank_lines_collapse_to_one_break() {
        let out = rejoin_paragraphs("Birinci.\n\n\n\nİkinci.");
        assert_eq!(out, "Birinci.\n\nİkinci.");
    }

    #[test]
    fn blank_line_at_the_start_is_ignored() {
        let out = rejoin_paragraphs("\n\nSadece bir paragraf");
        assert_eq!(out, "Sadece bir paragraf");
    }

    #[test]
    fn no_trailing_space_before_a_paragraph_break() {
        let out = rejoin_paragraphs("Bu satır oldukça uzun bir satır devam ediyor\n\nSonraki paragraf");
        assert!(!out.contains(" \n"), "trailing space before newline: {out:?}");
        assert_eq!(out, "Bu satır oldukça uzun bir satır devam ediyor\n\nSonraki paragraf");
    }

    #[test]
    fn empty_input_stays_empty() {
        assert_eq!(rejoin_paragraphs(""), "");
    }

    #[test]
    fn single_line_is_unchanged() {
        assert_eq!(rejoin_paragraphs("tek satır"), "tek satır");
    }

    #[test]
    fn rejects_path_traversal_and_bad_chars_in_lang_code() {
        // `lang` reaches both a URL and a filesystem join; unchecked it was an
        // arbitrary-write primitive.
        assert!(!is_valid_lang_code(""));
        assert!(!is_valid_lang_code("../../Users/Public/evil"));
        assert!(!is_valid_lang_code("..%2f..%2fetc"));
        assert!(!is_valid_lang_code("tur/../eng"));
        assert!(!is_valid_lang_code("tür"));
        assert!(!is_valid_lang_code(&"a".repeat(13)));
        assert!(!is_valid_lang_code("eng; rm -rf /"));
        assert!(!is_valid_lang_code("eng?x=1"));
        assert!(is_valid_lang_code("tur"));
        assert!(is_valid_lang_code("eng"));
        assert!(is_valid_lang_code("chi_tra"));
    }

    #[test]
    fn resolves_only_installed_languages_and_reports_the_missing_ones() {
        let installed: HashSet<String> = ["tur", "eng", "deu"].iter().map(|s| s.to_string()).collect();

        let (lang, missing) = resolve_language_list("tur+eng", &installed);
        assert_eq!(lang, "eng+tur");
        assert!(missing.is_empty());

        // A missing pack used to be dropped without a word, so the user got an English
        // OCR of a Turkish document reported as success.
        let (lang, missing) = resolve_language_list("tur+fra", &installed);
        assert_eq!(lang, "tur");
        assert_eq!(missing, vec!["fra".to_string()]);

        // Nothing requested is installed: falls back to eng, and says what is missing.
        // `missing` keeps the order the user asked for, not alphabetical order.
        let installed: HashSet<String> = ["eng"].iter().map(|s| s.to_string()).collect();
        let (lang, missing) = resolve_language_list("tur+deu", &installed);
        assert_eq!(lang, "eng");
        assert_eq!(missing, vec!["tur".to_string(), "deu".to_string()]);
    }
}