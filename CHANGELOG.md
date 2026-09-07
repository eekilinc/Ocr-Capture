# 📋 Değişiklik Günlüğü (Changelog)

Bu projedeki tüm önemli değişiklikler bu dosyada belgelenmektedir.  
Format [Keep a Changelog](https://keepachangelog.com/tr/1.0.0/) standardına dayanmaktadır ve bu proje [Semantic Versioning](https://semver.org/lang/tr/) kurallarını uygular.

---

## [2.4.1] - 2026-09-08

### 🚀 Eklendi & İyileştirildi
* **İnteraktif Tam Ekran Bölge Seçimi (`ScreenOverlay`):**
  * "Bölge Seç" butonuna tıklandığında masaüstünü donduran, hafif karartan ve artı (crosshair) imleci sunan tam ekran interaktif katman geliştirildi.
  * Windows Ekran Alıntısı Aracı (`Win + Shift + S`) ve Lightshot deneyiminde olduğu gibi, kullanıcı ekranda seçtiği kutuyu aydınlatılmış spot ışığı efekti ve canlı piksel boyutları (`GxY px`) ile görür.
  * Seçim tamamlandığında pencere eski boyutuna döner ve yalnızca o kutu kırpılarak OCR motoruna gönderilir.
  * <kbd>ESC</kbd> tuşu veya iptal butonu ile seçim dilediğiniz an iptal edilebilir.
* **Bölge Seçimi vs. Tam Ekran Ayrımı:** "Bölge Seç" ile "Tam Ekran" arasındaki deneyim farkı kesin ve belirgin hale getirildi.

---

## [2.4.0] - 2026-09-08

### ✨ Yeni Özellikler
* **Yeni Neon Glassmorphic Uygulama İkonu:** Lazer tarama ve cam yansımalı yüksek çözünürlüklü (512x512) yeni marka logosu tüm masaüstü (`.ico`, `.png`) ve web favicon formatlarında yenilendi.
* **"Hakkında" Sekmesi Yenilemesi:** Ayarlar içerisindeki eski kamera ikonu kaldırılarak parlayan neon auralı (`.app-logo-glow`) modern logo ve sürüm hap rozeti entegre edildi.
* **Gecikmeli Ekran Yakalama (Delay Timer):**
  * Açılır menüleri (dropdown), araç ipuçlarını (tooltip) ve sağ tık bağlam menülerini yakalamak için 3 sn / 5 sn döngüsel sayaç seçici eklendi.
  * Canlı geri sayım hap rozeti, saniye başı tık sesi (`sounds.playTick()`) ve bitişte deklanşör sesi ile zenginleştirildi.
  * <kbd>ESC</kbd> tuşuyla anında iptal edilebilir.
* **Tablo & Yapılandırılmış Veri OCR Modu:**
  * Kelime koordinatlarını analiz ederek satır ve sütunları tespit eden akıllı tablo ayrıştırıcı (`tableDetector.ts`) eklendi.
  * **Tablo (Excel TSV):** Kopyalandığında Microsoft Excel veya Google E-Tablolar'a doğrudan hücre hücre yapışır.
  * **Tablo (Markdown):** Notion ve GitHub formatında temiz Markdown tablo sözdizimine dönüştürür.
* **Tek Tıkla Google Araması:** Algılanan metni varsayılan web tarayıcısında Google'da aratma kısayolu eklendi.
* **Metin İçi Bul & Değiştir:** Arama çubuğuna entegre canlı eşleşme sayacı, tekil ("Değiştir") ve toplu ("Tümünü Değiştir") düzenleme araçları eklendi.

---

## [2.3.0] - 2026-09-07

### 🎨 Görsel & Belgeler
* **Üst Düzey README.md:** Detaylı özellikler, Mermaid mimari veri akış şeması, kısayol tablosu ve tek komutla kurulum talimatları eklendi.
* **Çoklu Platform GitHub Actions CI/CD:** Windows (NSIS Installer), macOS (Universal) ve Linux için otomatik derleme ve release iş akışı yapılandırıldı.
* **Panodan Doğrudan OCR:** Pano geçmişindeki görselleri tek tıkla uygulamaya aktarıp okuma özelliği iyileştirildi.

---

## [2.2.0] - 2026-09-06

### 🔍 Akıllı Varlık Tespiti & Araçlar
* URL, E-Posta, TR IBAN, Telefon ve HEX Renk kodlarını tespit eden akıllı çip sistemi (`entityDetector.ts`).
* Dahili QR Kod okuyucu (`jsQR`).
* Web Audio API ile sıfır harici dosya boyutlu sentetik ses efektleri.
* Türkçe ve İngilizce Text-to-Speech (TTS) sesli okuma desteği.

---

## [2.1.0] - 2026-09-05

### ⚡ Çekirdek Özellikler
* Tauri v2 ve Rust ile ultra hafif masaüstü mimarisi.
* Çevrimdışı Tesseract OCR entegrasyonu (Türkçe ve İngilizce).
* Çoklu monitör desteği ve global kısayol (`Ctrl + Shift + F9`) yönetimi.
* Geçmiş (History) ve favorilere ekleme mekanizması.
