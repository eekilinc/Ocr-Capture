# ⚡ Metin Yakalayıcı v2.4.1 — Büyük Güncelleme & İnteraktif Ekran Kırpma

**Metin Yakalayıcı v2.4.1**, masaüstü ekran alıntısı deneyimini profesyonel seviyeye taşıyan interaktif seçim katmanı, gecikmeli yakalama sayacı, Excel uyumlu tablo OCR modu ve baştan sona yenilenen neon cam tasarımıyla yayında!

---

## 🌟 Öne Çıkan Yenilikler

### 🎯 1. Gerçek İnteraktif Masaüstü Bölge Seçimi (`ScreenOverlay`)
* **Snipping Tool & Lightshot Deneyimi:** "Bölge Seç" butonuna tıkladığınızda veya kısayola bastığınızda ekran hafif kararır, artı (crosshair) imleci belirir ve masaüstünüz donar.
* **Spot Işığı ve Canlı Piksel Cetveli:** Farenizle metnin etrafını seçerken seçilen alan aydınlanır ve anlık piksel boyutları (`GxY px`) görüntülenir.
* **Yalnızca Seçilen Bölgeyi Kırpma:** Farenizi bıraktığınız an uygulama yalnızca çizdiğiniz alanı kırpar ve doğrudan o bölgedeki metni ayıklar.
* **Hızlı İptal:** <kbd>ESC</kbd> tuşuyla dilediğiniz an seçimi iptal edebilirsiniz.

---

### ⏱️ 2. Gecikmeli Ekran Yakalama (Delay Timer: 3s / 5s)
* Sağ tık menülerini, açılır pencereleri (dropdown) ve fareyle üzerine gelince açılan ipuçlarını (tooltip) rahatça yakalayabilmeniz için sayaç seçici eklendi.
* Canlı geri sayım hap rozeti, saniye başı tık sesleri (`sounds.playTick()`) ve bitişte deklanşör sesi ile zenginleştirildi.
* Süre dolduğunda ekran dondurulur ve seçiminizi rahatça yapabilirsiniz.

---

### 📊 3. Tablo & Yapılandırılmış Veri OCR (Excel TSV & Markdown)
* Tesseract kelime sınır kutularını (bounding box) ve koordinatlarını analiz ederek satır ve sütunları tespit eden akıllı tablo ayrıştırıcı eklendi.
* **Tablo (Excel TSV):** Kopyalandığında Microsoft Excel veya Google E-Tablolar'a doğrudan hücre hücre yapışır.
* **Tablo (Markdown):** Notion ve GitHub formatında temiz Markdown tablo sözdizimine dönüştürür.

---

### 🌐 4. Tek Tıkla Google Araması
* OCR ile yakalanan metni tek tıkla varsayılan tarayıcınızda Google'da aratabileceğiniz hızlı arama butonu araç çubuğuna entegre edildi.

---

### 🔎 5. Metin İçi Bul ve Değiştir (Find & Replace)
* Sonuç metninde anlık kelime arama, canlı eşleşme sayımı, tekil ("Değiştir") ve toplu ("Tümünü Değiştir") kelime düzenleme araçları eklendi.

---

### 🎨 6. Yeni Neon Glassmorphic Uygulama İkonu & "Hakkında" Sekmesi
* Yüksek çözünürlüklü (512x512), cam yansımalı ve lazer tarama temalı yeni uygulama ikonu tüm platformlara uyarlandı (`.ico`, `.png`, favicon).
* "Hakkında" modalındaki eski kamera ikonu kaldırılarak mor neon auralı kahraman logo ve sürüm hap rozeti yerleştirildi.

---

## 📦 Platform İndirme Bağlantıları

| Platform | İndirilecek Dosya | Açıklama |
| :--- | :--- | :--- |
| **Windows** | `Metin-Yakalayici_2.4.1_x64-setup.exe` | NSIS Kurulum Sihirbazı (Önerilen) |
| **macOS** | `Metin-Yakalayici_2.4.1_universal.dmg` | Apple Silicon (M1/M2/M3) ve Intel Uyumlu |
| **Linux** | `metin-yakalayici_2.4.1_amd64.deb` | Debian / Ubuntu Paketi |
| **Linux (Taşınabilir)** | `metin-yakalayici_2.4.1_amd64.AppImage` | Kurulum gerektirmeyen taşınabilir sürüm |

---

## ⚙️ Kurulum & Tesseract Gereksinimi

Uygulamanın çevrimdışı metin tanıma motorunu kullanabilmesi için sisteminizde **Tesseract-OCR** bulunmalıdır:

### Windows'ta Tek Komutla Kurulum:
```powershell
winget install UB-Mannheim.TesseractOCR
```
*Veya Chocolatey ile:*
```powershell
choco install tesseract --yes
```

### macOS Kurulumu:
```bash
brew install tesseract tesseract-lang
```

### Linux (Ubuntu/Debian) Kurulumu:
```bash
sudo apt-get install tesseract-ocr tesseract-ocr-tur tesseract-ocr-eng
```

---

**Tam Değişiklik Geçmişi:** [CHANGELOG.md](https://github.com/eekilinc/Ocr-Capture/blob/main/CHANGELOG.md)  
**Geliştirici:** Ekrem Kılınç
