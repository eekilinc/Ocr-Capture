# 📋 Değişiklik Günlüğü (Changelog)

Bu projedeki tüm önemli değişiklikler bu dosyada belgelenmektedir.  
Format [Keep a Changelog](https://keepachangelog.com/tr/1.0.0/) standardına dayanmaktadır ve bu proje [Semantic Versioning](https://semver.org/lang/tr/) kurallarını uygular.

## [2.6.2] - 2026-10-15

### 🐛 Düzeltilen Hatalar

* **Pencere tam ekran boyutuyla hatırlanıyordu:**
  * Yakalama katmanı (overlay) pencereyi tam ekran yapar; geometri kaydını bastıran bayrak `executeCapture` döner dönmez sıfırlanıyordu, ama 500 ms'lik gecikmeli kayıt **katman hâlâ açıkken** çalışıyordu. Sonuç: tam ekran boyutu ve konumu ayarlara yazılıyor, uygulama bir sonraki açılışta **ekranı kaplayan dev bir pencere** olarak açılıyordu.
  * Bayrak tamamen kaldırıldı; kayıt anında `isFullscreen()` kontrolü yapılıyor — ne zaman tetiklenirse tetiklensin tam ekran durumu asla kaydedilmiyor.
* **"Panodan Yapıştır" butonu açık temada koyu blok görünüyordu:**
  * `.btn-paste-glow` ve `.kbd-badge-pill` temada var olmayan `--bg-surface` ve `--border-color` değişkenlerini kullanıyordu; fallback'ler koyu slate renkler olduğu için buton beyaz zeminde koyu blok olarak çiziliyordu.
  * Gerçek tema belirteçlerine çevrildi.
* **Yanlış boyut bildirimi kırpma matematiğini bozuyordu:**
  * Görüntü boyut gözlemcisi `0x0` bildirirse letterbox hesabı kimlik ölçeğine düşüyor ve kırpma yanlış pikselleri alıyordu. Sıfır değerleri artık bildirilmiyor.

### 🧪 Teşhis

* `tests/monitor_capture.rs` — kullanılmayan import kaldırıldı.

---

## [2.6.1] - 2026-10-14

### 🐛 Düzeltilen Hatalar

* **OCR hiç çalışmıyordu (dil dizini):**
  * `TESSDATA_PREFIX` ortam değişkeni Tesseract'ın varsayılan tessdata dizinini *genişletmez*, *değiştirir*. Dil Yöneticisi bir kez kullanıldığında oluşan kullanıcı dizinini işaret etmesi, kurulu `tur` ve `eng` paketlerinin **görünmez** olmasına ve her OCR'ın "Failed loading language" ile başarısız olmasına yol açıyordu.
  * Artık kullanıcı dizini yalnızca çözümlenen dillerden birini gerçekten içeriyorsa set ediliyor.
* **Dil önceliği sessizce ters çevriliyordu:**
  * Dil listesi alfabetik sıralandığı için `tur+eng` isteği `eng+tur` olarak Tesseract'a gidiyordu; bu hem motor etiketini değiştiriyor hem de birincil modeli İngilizce'ye kaydırıyordu.
  * Artık kullanıcının istediği sıra korunuyor.
* **Açık temada bazı bileşenler koyu tema renklerine düşüyordu:**
  * Yeni eklenen stiller temada hiç var olmayan üç değişken kullanıyordu: `--border-color`, `--bg-primary`, `--bg-secondary`. Tanımsız olduğu için her biri koyu renkli fallback'ine düşüyor, yani açık temada Dil Yöneticisi satırları gri blok, kenarlıklar görünmez, hata ekranı komple koyu görünüyordu.
  * Gerçek tema belirteçlerine (`--modal-border`, `--modal-sidebar-bg`, `--bg-color`, `--modal-bg`) çevrildi.
* **Tesseract komut kutusu açık temada gri blok görünüyordu** (`%20 siyah` zemin) — temaya duyarlı hale getirildi.
* **Geçmiş arama çubuğunda odak geribildirimi yoktu** — `:focus-within` kenarlığı eklendi.
* `ResizeObserver` sıfır boyut bildirseyd kırpma matematiği yanlış piksellere düşüyordu; `> 0` koruması eklendi.

### 🧪 Teşhis

* `tests/ocr_pipeline.rs` — eski ve yeni ölçekleme kuralını gerçek Tesseract ile karşılaştırır (`cargo test -- --ignored`).
* `tests/monitor_capture.rs` — çoklu monitör birleştirmesinin DPI ölçeğini ve tampon boyutunu doğrular.
* `.openchamber/` çalışma dizini `.gitignore`'a eklendi.

---

## [2.6.0] - 2026-10-14

### 🐛 Düzeltilen Hatalar

* **Ana iş parçacığı (main thread) donması:**
  * 13 Tauri komutunun 12'si eşzamanlı (`#[tauri::command]`) olarak tanımlıydı ve Tauri v2'de **ana iş parçacığında** çalışıyordu. `run_ocr` içindeki `tesseract` sürecinin beklenmesi (`WaitForSingleObject`) 1–5 saniye boyunca arayüzü, spinner animasyonunu ve pencere olaylarını tamamen donduruyordu.
  * Tüm komutlar `#[tauri::command(async)]` ile arka plan iş parçacığına taşındı.
  * Komutlar artık eşzamanlı çalışabildiği için geçici dosya adları PID + atomik sayaç içerecek şekilde yeniden yazıldı; aynı milisaniyede üretilen iki dosya adı çakışıp birbirinin ara dosyasını ezerdi.
* **Çoklu bölge seçimi yalnızca ilk alanı işliyordu:**
  * <kbd>Shift</kbd> ile 3 alan seçildiğinde arayüz 3 kutu gösteriyordu ama OCR sadece ilk kutuyu kırpıyordu.
  * Artık seçilen tüm bölgeler sırayla işlenir, metinler birleştirilir ve kelime koordinatları ilk bölgenin uzayına ölçeklenerek yığılarak yerleştirilir.
* **Geçmişten geri yükleme yanlış görseli işliyordu:**
  * Geri yükleme sırasında önceki yakalamanın dosya yolu temizlenmediği için, kullanıcı küçük önizleme görürken **önceki görselin** metni çıkarılıyordu.
  * Geri yükleme sonrası bölge seçimi de bloke kalıyordu.
* **Türkçe metinde paragraf birleştirme hatalıydı:**
  * `str::len()` **bayt** sayar; `ç ğ ı İ ö ş ü` karakter başına 2 bayt olduğu için kısa Türkçe satırlar yanlışlıkla sonraki satırlara yapıştırılıyordu. Artık karakter sayısıyla karşılaştırılıyor.
  * Boş satırlar tamamen atlanıyor ve belgedeki paragraf yapısı kayboluyordu; artık paragraf ayracı korunuyor.
* **Türkçe karakterlerde "Değiştir" metni bozuyordu:**
  * Arama, küçültülmüş kopyada bulunup **orijinal** metinde kullanılıyordu. `"İ".toLowerCase()` iki UTF-16 birimi olduğu için ilk noktalı büyük `İ`'den sonraki tüm indeksler kayıyor ve metin sessizce kesiliyordu.
  * Artık eşleşme doğrudan orijinal metin üzerinde, büyük/küçük harf duyarsız regex ile bulunuyor.
* **"Başlık" dönüşümü tüm satır sonlarını yok ediyordu:**
  * Metin `\s+` ile bölünüp tek boşlukla birleştirildiği için çok satırlı OCR çıktısı tek paragrafa çöküyordu. Artık satır yapısı korunuyor.
* **OCR çıktısı okunamazsa "metin yok" gösteriliyordu:**
  * Tesseract çıkış kodu 0 olsa bile `.txt` dosyası eksik veya bozuksa sessizce boş metin dönüyordu. Artık okuma hatası gerçek bir hata olarak bildiriliyor.
* **Dosya bırakma (sürükle-bırak) hiçbir şey yapmıyordu:**
  * Bırakma alanı görsel bekliyordu ancak `dataTransfer` hiç okunmuyordu. Artık bırakılan görsel yüklenip OCR'a veriliyor.
* **Sistem teması çalışmıyordu:**
  * CSS'te `[data-theme="system"]` kuralı bulunmadığı için uygulama her zaman açık temaya düşüyordu. Artık işletim sistemi tercihi çalışma zamanında takip ediliyor.
* **Filtre ve uyarı butonları tıklanamıyordu:**
  * Seçim katmanı tüm tuvali kaplayıp üzerindeki filtre araç çubuğu ve Tesseract uyarı bandını yutuyordu. Katman artık tıklamalara geçirgen ve üst bileşenler doğru katman sırasına sahip.
* **Pencere yeniden boyutlandırıldığında kırpma bozuluyordu:**
  * Görüntü boyutları yalnızca `<img>` yüklenirken bildiriliyordu; pencere boyutu değişince bayat kalıyor ve kırpma yanlış pikselleri alıyordu. Artık `ResizeObserver` ile sürekli takip ediliyor.
* **Kelime haritası uygulama içi kırpımda yanlış konumlanıyordu:**
  * Kelimeler kırpılmış bölgeden geliyordu ama tüm ekranın üzerine yayılıyordu. Artık seçim dikdörtgeninin içine yerleştiriliyor.
* **Geçmiş seçim sayaçları tutarsızdı:**
  * Silinen kayıtlar hâlâ sayılıyor, filtre değişince sayaç ile gerçek seçim uyuşmuyor ve "Tümünü Temizle" sonrası hayalet bir toplu kopyalama butonu beliriyordu.
* **Yıldız butonu Türkçe ipucu gösteriyordu** ve ekran okuyucuya "Yıldızlılar" diye okunuyordu.

### ⚡ Performans

* **Çift PNG kodlama kaldırıldı:** Panodan görsel alınırken aynı arabellek iki kez sıkıştırılıyordu.
* **`tesseract --list-langs` önbelleğe alındı:** Bu alt süreç her OCR çalışmasında yeniden başlatılıyordu (60–250 ms saf israf). Artık binary yoluna göre bir kez çalıştırılıp saklanıyor.
* **QR taraması metni geciktirmiyor:** jsQR ana iş parçacığında senkron çalıştığı ve sonuçlar yazılmadan önce bekletildiği için büyük bölgelerde arayüz donuyordu. Artık metin ekrana geldikten sonra çalışıyor.
* **Küçük görsel ölçekleme düzeltildi:** `||`/`&&` koşulları yüzünden dar ve uzun seçimler (ör. 100×6000) 42×2500'e küçültülüyor, yani girdiden daha kötü bir görüntü Tesseract'a veriliyordu. Artık kısa kenara göre ölçekleniyor.
* **Açılışta geçici dosya taraması arka plana alındı.**
* Release profili `lto`, `codegen-units = 1` ve `strip = true` ile sıkılaştırıldı; kullanılmayan `serde_json` bağımlılığı ve `tokio` özellikleri kaldırıldı.

### 🔒 Güvenlik

* **Content Security Policy eklendi** (`csp: null` kaldırıldı). `save_file_to_disk` gibi sınırsız komutlarla birleşince önceki durum, webview'daki tek bir script enjeksiyonuna tam dosya okuma/yazma yetkisi veriyordu.
* **Dil paketi kodu doğrulaması:** `download_ocr_language` komutundaki `lang` parametresi hiç doğrulanmıyordu; `..` içeren bir değerle tessdata dizinin dışına yazılabiliyordu.
* **Atomik dil yazımı:** İndirme yarıda kesilirse bozuk bir `tur.traineddata` kalıyor ve sonraki tüm OCR'ları bozuyordu. Artık geçici dosyaya yazılıp `rename` ediliyor.

### 🐛 Diğer Düzeltmeler

* **Tesseract bulunamadığında dil listesi hatası:** Motor bozuksa ayarlar dili listede hiç hata göstermeden boş liste gösteriyordu.
* **Eksik dil paketleri artık sessizce düşmüyor:** İstenen dil kurulu değilse hangisinin eksik olduğu hata mesajında belirtiliyor (daha önce Türkçe belge İngilizce taranıp başarı gibi gösteriliyordu).
* **Dil indirme artık normal kullanıcıda çalışıyor:** Makine geneline kurulumda tessdata `C:\Program Files` altında olduğu için yazma izni yoktu; 4 MB indirilip ardından "Access is denied" alınıyordu. Artık yazılabilir kullanıcı dizinine iner ve `TESSDATA_PREFIX` ile Tesseract'a tanıtılır.
* **Dil paketleri `tessdata` deposundan indiriliyor** (önceden `tessdata_fast`), böylece kurulumla gelen modellerle aynı kalitede.
* `TESSERACT_PATH` artık dizin kabul etmiyor (kurulum klasörü verildiğinde süreç başlatılamıyordu).
* `.jpg` uzantısı seçildiğinde PNG baytı yazılmıyordu; artık gerçekten JPEG olarak kodlanıyor.
* **Çoklu monitör yakalamasında DPI ölçeği uygulanıyor:** Hedef tampon mantıksal birimle, içerik ise `scale_factor` ile ölçeklenmişti; farklı ölçekli ikinci monitör sessizce kırpılıyordu.
* Yakalanamayan monitörler artık sessizce atlanmıyor.
* Kırpma seçimi görsel sınırının dışına taşarsa 1 piksellik şeride sessizce kırpılmak yerine hata veriyor.
* **Dışa aktarma hataları artık toast ile bildiriliyor** (daha önce yalnızca konsola yazılıyordu).
* Kopyalama hatasında **hata** mesajı gösteriliyordu, "başarılı" değil.
* Uygulama köküne **hata sınırı (ErrorBoundary)** eklendi; tek bir render hatası artık beyaz ekran bırakmıyor.
* Ölü ayarlar kaldırıldı: **"Sistem tepsisine küçült"** artık gerçekten çalışıyor, pencere boyutu/konumu artık kaydediliyor, **Dil Yöneticisi** Ayarlar'a bağlandı.
* 28 kullanılmayan çeviri anahtarı silindi; Türkçe/İngilizce sözlükler tamamen paralel.

---

## [2.5.0] - 2026-09-17

### ✨ Yeni Özellikler & Performans İyileştirmeleri
* **Panodan Doğrudan Görsel Yapıştırma (`Ctrl + V`):**
  * Herhangi bir web tarayıcısından, ekran alıntısı aracından (`Win + Shift + S`) veya görsel düzenleyiciden kopyalanan resimler artık doğrudan uygulamaya yapıştırılabilir.
  * <kbd>Ctrl</kbd> + <kbd>V</kbd> kısayolu veya çalışma alanındaki **"Panodan Yapıştır"** butonu ile görsel anında yüklenir, OCR metin tanıması ve QR taraması otomatik başlar.
* **Rust Tarafında Yerel Kırpma (`crop_image_file`):**
  * Ekran yakalama seçimleri artık mikro-saniyeler içinde doğrudan Rust motoru üzerinde kırpılıyor.
  * Büyük Base64 veri dizilerinin IPC üzerinden transferi kaldırılarak bellek tüketimi ve işlem süresi dramatik şekilde düşürüldü.
* **Tesseract OCR Durum & Kurulum Rehberi:**
  * Sistemde Tesseract bulunamadığında çalışma alanında tek tıkla resmi indirme sayfasına yönlendiren ve `winget install UB-Mannheim.TesseractOCR` komutunu kopyalayan akıllı bir rehber kartı gösterilir.
  * Kurulum yapıldıktan sonra uygulamayı kapatmadan doğrulama imkanı sunan "Yeniden Kontrol Et" butonu eklendi.
* **Otomatik Geçici Dosya Temizliği:**
  * Uygulama açılışında 6 saatten eski `ocr-capture-*` geçici dosyalarını temizleyen arka plan süpürücüsü ve OCR hata durumlarında dosya kalıntılarını engelleyen koruma sağlandı.

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
