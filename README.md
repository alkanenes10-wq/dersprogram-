# 📘 Tam Otomatik Ders & Etüt Programlama Sistemi

Öğretmenlerin ve öğrencilerin **kurumda oldukları gün ve saatlere** göre haftalık ders programını
otomatik üreten web uygulaması.
`index.html` dosyasına çift tıklayarak açılır ya da statik site olarak yayına alınır —
kurulum, sunucu, veritabanı gerekmez.

---

> **Bu depo bir web uygulamasıdır.** Kurulum, sunucu, veritabanı ya da derleme adımı yoktur:
> dosyalar olduğu gibi yayınlanır. GitHub'a yükleyip Vercel'e bağlamak için
> [🚀 Yayına alma](#-yayına-alma-github--vercel) bölümüne bakın.
>
> | | |
> | :--- | :--- |
> | **Yerel kullanım** | `index.html` dosyasına çift tıklayın |
> | **Yayın** | Statik site (Vercel · "Other" preset · build komutu yok) |
> | **Veri** | Tarayıcıda `localStorage` — sunucuya hiçbir şey gitmez |
> | **Bağımlılık** | Yok (framework, CDN, paket yok) |

## 📁 Proje yapısı

```
index.html          ► YAYINLANAN DOSYA — stil ve betikler İÇİNE GÖMÜLÜ, tek başına çalışır
assets/             Kaynak dosyalar (index.html bunlardan üretilir, yayına gitmez)
  sablon.html       index.html'in iskeleti + açılış hata denetçisi
  styles.css        Arayüz stilleri
  engine.js         Çizelgeleme + tanılama çekirdeği (DOM'a dokunmaz)
  seed.js           Örnek veri (27 sınıf · 24 öğretmen · 183 ders satırı · 379 saat)
  app.js            Arayüz katmanı (sekmeler, takvim, paneller, hafıza)
birlestir.js        assets/ → index.html birleştiricisi (`node birlestir.js`)
docs/               Örnek verinin üretildiği kaynak dosyalar (referans)
vercel.json         Vercel statik yayın ayarları
.vercelignore       assets/ ve docs/ yayına kopyalanmasın diye
```

> ### ⚠️ Tek dosya kuralı
> **`index.html` tek başına çalışır** — CSS ve üç betik onun içine gömülüdür, dışarıdan
> hiçbir dosya istemez. Yayına alırken **yalnızca bu dosya** gereklidir; `assets/` klasörü
> siteye gitmese bile uygulama çalışır. Eksik klasör yüzünden boş/stilsiz sayfa çıkması
> bu sayede mümkün değildir.
>
> Bunun bedeli: **`assets/` içinde bir şey değiştirirseniz** değişiklik kendiliğinden
> `index.html`'e yansımaz. Node kuruluysa:
>
> ```bash
> node birlestir.js     # index.html'i yeniden üretir
> ```
>
> Node yoksa `assets/` dosyalarını hiç kurcalamayın; düzenlemeyi doğrudan `index.html`
> içinde yapın (stil `<style>` bloğunda, kod alttaki `<script>` bloğundadır).

Betikler klasik `<script>` olarak, **engine → seed → app** sırasıyla yüklenir
(ES module değildir; bu sayede dosya `file://` üzerinden de, yani çift tıklayarak da çalışır).

Sayfanın en üstünde bir **açılış denetçisi** vardır: bir JavaScript hatası olursa ya da
arayüz kurulamazsa beyaz sayfa yerine **nedenini yazan kırmızı bir uyarı kutusu** gösterir.

---

## 🚀 Nasıl Çalışır?

Uygulama ilk açılışta kurumun kendi verisiyle **hazır bir program üretir**. Sonrasında:

1. **🏫 Sınıflar** sekmesinde her sınıfın hangi gün geldiğini, o gün hangi **oturumda** olduğunu
   ve **aldığı dersleri** düzenlersiniz.
2. **👩‍🏫 Öğretmenler** sekmesinde her öğretmenin **anlaşma gün ve saatlerini** (sürükleyerek boyayarak)
   ve **verdiği dersleri** düzenlersiniz.
3. **⚙️ Kurum Ayarları**'nda zil saatlerini, oturum aralıklarını, blok kurallarını ayarlarsınız.
4. Üstteki **🔄 Yeniden Oluştur** ile programı üretirsiniz — istediğiniz kadar, her seferinde farklı.

> Müfredat ayrı bir sekme değildir: dersler hem sınıf hem öğretmen tarafından düzenlenebilir,
> ikisi aynı veriyi iki yönden gösterir.

> Değişiklik yaptığınızda program kendiliğinden yeniden hesaplanmaz. Yeniden oluşturma tüm dersleri
> baştan dağıtır; bunu ne zaman yapacağınıza siz karar verin. Her yeniden oluşturmadan **önce
> otomatik kayıt noktası** alınır, beğenmezseniz geri dönebilirsiniz.

---

## 📅 Takvim — iki görünüm

Üstteki **Görünüm** düğmesiyle iki kip arasında geçiş yaparsınız:

### 🗓 Tek program *(açılışta gelen kip)*
Seçtiğiniz **tek bir sınıfın ya da öğretmenin** haftalık programı, sayfanın tamamını kullanan
büyük bir tabloda: **satırlar günler, kolonlar ders saatleri**. Her hücrede ders adı,
(sınıf kipinde) öğretmen / (öğretmen kipinde) sınıf ve zil saati okunur büyüklükte yazar.

* Üstteki **açılır liste**, **◀ ▶** düğmeleri ve **arama kutusu** ile kayıtlar arasında gezersiniz;
  klavyede **← →** de aynı işi yapar.
* **🖨 Yazdır** yalnızca ekrandaki bu haftalık programı tek sayfa olarak çıkarır.
* Yalnızca kaydın kurumda olduğu günler ve fiilen kullandığı ders saatleri gösterilir —
  boş kolon kalabalığı olmaz.

### 📊 Toplu ızgara — aSc tarzı ana program görünümü

Tek büyük ızgara: **günler sabit kolon** (7 gün × 12 ders saati), satırlar ise
**sınıflar** veya **öğretmenler** — üstteki düğmeyle geçiş yaparsınız.
Satır başlığına (sınıf/öğretmen adına) tıklamak o kaydı **🗓 Tek program** kipinde açar.

* Ders kartları **öğretmenin rengindedir** (renkler `ders programı.xml`'den gelir).
* Başlıkta ders saati numarası ve **zil saati** yazar.
* Karta tıklayınca blok bütün olarak **kilitlenir**; yeniden oluşturmada yeri değişmez.
* Hücre zeminleri geliş durumunu gösterir: boş/müsait, “Gelebilir” günü,
  etüt arası (ders yerleşmez), kurumda değil.

---

## ⚙️ Öne Çıkan Özellikler

### Ardışık blok mantığı
Aynı ders gün içinde **arka arkaya** yerleştirilir; 1. ders matematik / 5. ders matematik gibi
dağınık yerleşim oluşmaz.

Üretilen her alternatif iki ölçüyle de puanlanır, en ardışık olan seçilir:

| Ölçü | Anlamı |
| :--- | :--- |
| **Kopuk ders** | Aynı dersin aynı gün içinde ayrı parçalara düşmesi (0 olmalı) |
| **Sınıf ara boşluğu** | Sınıfın o günkü ilk ve son dersi arasında kalan **boş ders saati** — öğrenci arada boş beklemesin |

Üstteki **Ardışıklık** göstergesi bu iki sayının toplamını verir; `tam` yazıyorsa bütün dersler
arka arkaya demektir. (Örnek veride ölçülen: ardışıklık ölçütü eklenmeden önce program başına
**6-9 saat** sınıf ara boşluğu çıkıyordu; ardışıklık ölçütüyle **0-2 saat**, aşağıdaki sıkıştırma
adımıyla birlikte **0 saat**.)

| Haftalık saat | Blok dizilimi |
| :--- | :--- |
| 6 saat | 2 + 2 + 2 (üç ayrı gün, ikişer ardışık) |
| 5 saat | 3 + 2 |
| 4 saat | 2 + 2 |
| 3 saat | 2 + 1 |

Tercih edilen ve en uzun blok uzunluğu **⚙️ Kurum Ayarları**'ndan değiştirilebilir; tablo oradan
canlı güncellenir. Bir dersin müsait gün sayısı blok sayısından azsa saatler gün sayısına göre
yeniden bölünür — gün başına yine **tek ardışık blok** düşer.

### Sınıfın boş dersi olmaz
Bir sınıf, o gün **fiilen ders gördüğü saatlerde** kurumda sayılır. Üretim üç adımda çalışır:

1. **Üretimden önce** sınıfın geldiği **oturumların tamamı açılır** (Sabah 1-6, Akşam 10-12 …) —
   çözücü o oturumun her saatini kullanabilsin.
2. **Üretim sırasında** her sınıfın geliş penceresi **haftalık yüküne eşitlenir** (aşağıya bakın) —
   çözücü, kapasitesi yüküne tam denk gelen bir pencereye yerleştirdiği için pencerede boş saat
   bırakamaz.
3. **Üretimden sonra** sınıfın geliş saatleri, yerleşen derslerin (ve etütlerin) saatlerine
   **daraltılır** — ne gün içinde ne de günün sonunda **boş ders kalmaz**; sınıf dersi bitince çıkar.

#### Geliş penceresi = haftalık yük
Üretimin her denemesinde, sınıfın geldiği günlerin toplam kapasitesi yüküne göre daraltılır.
Her gün **oturumun en erken ders saatinden** başlar:

| Durum | Kural | Örnek |
| :--- | :--- | :--- |
| Yük ≥ kesin günlerin kapasitesi | Kesin günler **bütün hâlinde** dolar, artan saatler seçilen “Gelebilir” gününe gider | **401** 15 saat → Cmt 1-6, Paz 7-12, + bir akşam 10-12 |
| Yük < kesin günlerin kapasitesi | Yük kesin günlere **eşit bölünür** | **501-512** 20 saat / 4 gün → Pzt-Per **her gün 1-5. ders**<br>**5/A** 10 saat / 2 gün → her gün 5 saat |

Böylece **hafta sonu gelen sınıf** günün ya **ilk 6** (1-6) ya da **son 6** ders saatini
(7-12) baştan sona doldurur — hangisi olacağı 🏫 Sınıflar sekmesindeki oturum seçimidir;
**hafta içi gelen mezun sınıflar** her gün **ilk 5 ders saatini** görür.
Program artık sınıf tarafında “saat dışı” hücresi bırakmaz.

> Pencere yüke tam oturduğu için üretim eskisinden zordur: çözücü aynı dersin iki bloğunu
> gerektiğinde **aynı güne arka arkaya** koyarak (ör. 2+1 → 3 saatlik tek dizi) günü tam doldurur.
> Bu esnetme yalnız başka türlü saat boş kalacaksa devreye girer.

Kurumun kararı olan **oturumlar kaybolmaz**: 🏫 Sınıflar sekmesindeki **S / Ö / A** düğmeleri hep
o oturumu gösterir ve her yeniden oluşturmada baştan açılır. “Yük / Yer” sütunu ile 🩺 Tanılama da
daraltılmış hâli değil, **oturumun tamamını** ölçer — esneklik kaybolmaz.

### Gün içi boşluk yok — her yeniden oluşturmada sıkıştırma
Program üretiminin son adımında her sınıfın **her günü tek kesintisiz dizi** hâline getirilir ve
oturumun **en erken ders saatinden** başlatılır: hafta sonu sabah gelen sınıf **1 → 6**, akşam gelen
sınıf **10. dersten** itibaren arka arkaya ders görür. Bir günde iki dersi varsa o iki ders bitişiktir;
boş saat gün içinde değil, **günün sonunda** kalır (sınıf erken çıkar).

* **Öğretmenlerin gün ve saatleri değişmez.** Değişen tek şey sınıfın o gün kaçta geldiğidir.
* Kilitli dersler ve etütler yerinde kalır; sıkıştırma dizilimi onların etrafında kurar.
* Sınıf kendi oturumunda boşluksuz yerleşemiyorsa, o günü **öbür oturuma** taşımayı dener
  (öğleden önce ↔ öğleden sonra). Taşınan sınıf-günleri işlem günlüğüne yazılır ve sınıfın
  geliş saatleri buna göre güncellenir. Bu davranış
  **⚙️ Kurum Ayarları → “Boşluk kalmasın diye sınıf oturumu değiştirilebilir”** ile kapatılabilir.
* Sınıf ara boşluğu artık deneme seçiminde **eksik saatten sonraki en ağır ölçüt**tür; üretim,
  boşluksuz **ve** eksiksiz bir program bulana kadar denemeye devam eder.

### Gün dağıtımı — “Gelebilir” günleri çözücü seçer
Bir sınıfın haftalık yükü **kesin (“Geliyor”) günlerine** sığmıyorsa, eksik saatler için
**“Gelebilir” günlerinden en az sayıda gün** seçilir. Hangi günün seçileceğine program karar verir:

* o güne konulacak dersin **öğretmeninin en müsait olduğu** gün tercih edilir,
* aynı günü seçen sınıf sayısı cezalandırılır → **paralel şubeler farklı günlere dağılır**.

Örnek (kurumun gerçek verisiyle): 12. sınıfların hafta sonuna sığmayan 3 saati —

| Sınıf | Seçilen ek akşam | O akşama konan dersler |
| :--- | :--- | :--- |
| 401 | Perşembe | Fizik, Kimya |
| 402 | Salı | Fizik, Kimya |
| 403 | Çarşamba | Türkçe, Mat1 |
| 411 | Salı | Mat2, Türkçe |
| 801 | Salı | İngilizce |

Her sınıf **tek bir ek akşama** gelir (üç ayrı akşama 1'er saat dağılmaz). Sınıf başına en fazla
kaç ek gün kullanılacağı **⚙️ Kurum Ayarları → “Sınıf başına Gelebilir gün”** ile belirlenir.

### Sıfır çakışma garantisi
Bir öğretmen aynı saatte iki sınıfta, bir sınıf aynı saatte iki derste olamaz.
Sınıfın gelmediği güne, öğretmenin kurumda olmadığı saate hiçbir şey yerleşmez.
Etütler de bu denetime dahildir.

### Oturum sınırları
Bir blok **oturum sınırını aşamaz** (öğle veya akşam arasını atlayan blok oluşmaz):

| | Oturumlar |
| :--- | :--- |
| **Hafta içi** | Sabah `1-6` (09.00-13.40) · *Etüt arası* `7-9` (14.00-15.55) · Akşam `10-12` (16.30-18.40) |
| **Hafta sonu** | Sabah `1-6` (09.00-13.40) · Öğleden sonra `7-12` (14.20-18.55) |

Zil saatleri ve **oturum aralıkları** ⚙️ Kurum Ayarları'ndan değiştirilebilir.
Hafta içi *etüt arası* saatlerine ders yerleştirilmez.

### 👥 Paralel şube tutarlılığı
Gruplar, sınıfların **ders kümelerine** bakılarak otomatik bulunur (aynı seviyede benzerliği ≥%60
olanlar aynı alan sayılır). Böylece **sayısal ve sözel şubeler karışmaz**:

| Grup | Sınıflar |
| :--- | :--- |
| 12. sınıf (sayısal) | 401, 402, 403 |
| 12. sınıf (sözel) | 411 — *ayrı grup* |
| 11. sınıf | 301, 302 · 311 *ayrı* |
| Mezun (sayısal / sözel) | 501, 502, 503 · 511, 512 |

Grup içi farklar tek tek bildirilir (*“403 · KİMYA 2 saat, grubun geri kalanı 3 saat”*) ve
**Eşitle** düğmesiyle tek tıkla kapatılır.

### 🚫 İzinli günler — tek tıkla aç / kapat
**👩‍🏫 Öğretmenler** sekmesinde, seçili öğretmenin üstünde **gün rozetleri** vardır:
**yeşil = kurumda**, **kırmızı = İZİNLİ**. Rozete (ya da müsaitlik ızgarasındaki gün adına)
tıklamak o günü bütünüyle kapatır veya açar.

* Gün kapatılırken o günün saatleri **saklanır**; günü yeniden açtığınızda aynı saatler geri gelir
  (hiç kayıt yoksa günün ders yerleşebilen tüm saatleri açılır).
* O güne yerleşmiş ders saati varsa **önce sorulur**, onaylarsanız dersler programdan düşer;
  **🔄 Yeniden Oluştur** ile başka günlere dağıtılır.
* O gündeki **etütler silinmez**, yalnızca bildirilir — gerekirse 🎓 Etüt Paneli'nden kaldırırsınız.
* Değişiklik tarayıcı hafızasına ve kayıt noktalarına yazılır.

### 🕳 Öğretmen Boşlukları paneli
* **Ara boşluk** — o gündeki ilk ve son dersi arasında kalan boşluk. Öğretmen zaten kurumda
  olduğu için etüt açmak en verimli burada olur.
* **Uç boşluk** — günün başındaki/sonundaki, müsait ama dersi olmayan saatler.
* **📋 Tüm öğretmenlerin müsait olduğu saatler** — 24 öğretmen × 7 gün × 12 saat tek matris;
  her hücre o öğretmenin durumunu (ders / ara boşluk / uç boşluk / etüt / kurumda değil) gösterir,
  **alt satır her saat için kaç öğretmenin boş olduğunu** yazar. “Yalnız boş saatler” kipi de var.
* Öğretmen bazlı saat saat renkli harita.

### 🎓 Etüt Paneli
Öğretmen seçilir → **girdiği sınıflar dersleriyle listelenir** → etüt talep eden öğrencinin sınıfı
ve adı yazılır → uygun saatler çıkar. Bir saatin uygun sayılması için:

* öğretmen o saatte **kurumda**,
* öğretmenin o saatte **dersi yok**,
* öğrencinin sınıfının o saatte **dersi yok**,
* ve saat **etüt penceresi** içinde.

**Etüt penceresi — hafta içi 16.00 ve sonrası** (10-12. ders), öğrenciler kendi okullarından sonra
gelebilsin; hafta sonu tüm gün. Pencere ⚙️ Kurum Ayarları'ndan değiştirilir.

Uygun saate tıklandığında etüt programa işlenir ve **kilitlenir**. Uygun saat çıkmazsa panel
**nedenini ölçerek** söyler ve ne yapılacağını yazar.

### 🩺 Tanılama — “neyi değiştirmeliyim?” + **uygulanabilir alternatifler**
Program tam oluşturulamazsa sistem **tahmin yürütmez, ölçülmüş sayı verir** ve her maddenin altında
**numaralı alternatifler** sunar. Her alternatifin yanındaki **Uygula** düğmesi değişikliği yapar,
programı yeniden üretir ve öncesinde otomatik kayıt noktası alır. Tepedeki
**⚡ İlk alternatifleri otomatik uygula** düğmesi hepsini sırayla dener.

| Tanı | Örnek |
| :--- | :--- |
| **Sınıf kapasitesi** | `701 — kapasite aşımı: 16 saat ders / 12 saat yer. Fazla: 4 saat` |
| **Öğretmen müsaitliği** | `X öğretmeni: 31 saat ders / 4 saat müsait. 27 saat daha açın.` |
| **Ortak gün yok** | `701 · DİN (Y): sınıf Cmt/Paz geliyor, öğretmen yalnız Pzt müsait → kesişim yok.` |
| **Saat darboğazı** (slot düzeyi Hall analizi) | `X: Paz 7., Paz 8., Paz 9. ders saatlerine 4 saat sıkışıyor, yalnızca 3 saat yer var. Fazla: 1 saat` — hangi derslerin başka saate konulamadığını tek tek listeler ve durumun **matematiksel olarak çözümsüz** olduğunu açıkça söyler |
| **Gün darboğazı** (gün düzeyi) | `X: Cmt + Paz günlerine 22 saat sıkışıyor, yalnızca 12 saat yer var.` |
| **Yerleşemeyen blok** | engel dağılımını sayar (`sınıfın müsait olmadığı saat: 52 konum`) ve en olası çözümü önerir |
| **Grup farkı** | `12. sınıf grubunda ders farkı — 403 · KİMYA: 2 saat, grubun geri kalanı 3 saat.` |
| **Geçersiz kalan kilit** | müsaitlik/gün değişince geçerliliğini yitiren kilitler bildirilerek atılır |

Üretilen alternatif türleri: öğretmene müsaitlik açma · dersi başka öğretmene devretme ·
sınıfa gün/oturum açma · ders saatini azaltma · “Gelebilir” gün sınırını artırma ·
blok uzunluğunu küçültme · grup farkını eşitleme · ders satırını silme.

---

## 🗂 Sekmeler

| Sekme | İşlevi |
| :--- | :--- |
| 📅 **Takvim** | 🗓 **Tek program** (bir sınıfın/öğretmenin haftalık programı, büyük ve yazdırılabilir) · 📊 **Toplu ızgara** (aSc görünümü: günler sabit kolon, satırlar sınıf **veya** öğretmen; renkli kartlar, kilitleme, ek günler özeti) |
| 🕳 **Öğretmen Boşlukları** | Tüm öğretmenlerin müsaitlik matrisi + saat başına boş öğretmen sayısı + boş saat tablosu + saat saat harita |
| 🎓 **Etüt Paneli** | Öğretmenin girdiği sınıflar, öğrenci adı, uygun saat eşleştirme, planlanmış etütler |
| 🏫 **Sınıflar** | Geliş günleri + oturumlar, **aldığı dersler**, yük/kapasite, paralel şube grupları ve eşitleme |
| 👩‍🏫 **Öğretmenler** | **İzinli günleri açma/kapatma rozetleri**, **anlaşma gün ve saatleri** (sürükleyerek boyanır), **verdiği dersler**, yük/müsaitlik dengesi |
| ⚙️ **Kurum Ayarları** | Çalışma günleri, blok kuralları, **oturum değiştirme anahtarı**, “Gelebilir” gün sınırı, deneme sayısı, etüt penceresi, **zil saatleri ve oturum aralıkları**, 🧪 kendini test |
| 🩺 **Tanılama** | Engeller, **uygulanabilir alternatifler**, yük dengesi |

---

## 🧪 Geçici bellek — üretilen programlar

Her 🔄 **Yeniden Oluştur**, ürettiği programı üstteki **🧪 Denemeler** düğmesinin altında saklar
(son **10** üretim). Böylece bir öncekini kaybetmeden istediğiniz kadar alternatif deneyebilirsiniz.

* Her deneme kendi ölçüleriyle listelenir: **yerleşen/toplam saat**, **ardışıklık**,
  **öğretmen boşluğu**, **ek gün**, **kilit sayısı**, süre. En iyi değerler yeşil rozetle işaretlenir.
* **↩ Uygula** o programa anında döner. Aradan müsaitlik/müfredat değiştiyse kaç saatin
  geçersiz kaldığı söylenir, onayınız sorulur.
* **💾 Kalıcı kaydet** denemeyi uygular ve **Hafıza**'daki kayıt noktalarına çevirir.
* Bu liste **geçicidir** — sayfayı kapatınca silinir. Kalıcı olması gerekenleri kayıt noktasına çevirin.

---

## 💾 Hafıza sistemi

Üstteki **💾 Hafıza** düğmesi demo sürümünün kayıt sistemidir:

* **Otomatik kayıt** — her değişiklik tarayıcıda (`localStorage`) saklanır; sayfayı kapatıp
  açtığınızda kaldığınız yerden devam edersiniz. Sekme kapanırken bekleyen yazma da kaçırılmaz.
* **Kayıt noktaları** — çalışmanıza ad verip dondurursunuz, listeden tek tıkla geri yüklersiniz.
  Yeniden oluşturma, alternatif uygulama, grup eşitleme, geri yükleme ve içe aktarma öncesinde
  **otomatik kayıt noktası** alınır.
* **İşlem günlüğü** — ne zaman ne yaptığınız kayıtlıdır.
* **⬇ / ⬆** JSON yedek indirme ve geri yükleme.
* **🖨 Rapor** sınıf sınıf **ve öğretmen öğretmen** yazdırılabilir haftalık program +
  öğretmen boşluk tablosu + etüt programı üretir.
  (Tek bir kaydı yazdırmak için 📅 Takvim → 🗓 Tek program → **🖨 Yazdır**.)
* **🗑** tümünü sıfırlayıp örnek veriye döner.

Veriler yalnızca sizin tarayıcınızda tutulur; hiçbir sunucuya gitmez.

---

## 📄 Örnek veri

| Kaynak | Katkısı |
| :--- | :--- |
| `ders programı.xml` | 27 sınıf, 24 öğretmen, 20 ders, **183 ders satırı**, **379 ders saati**, öğretmen renkleri |
| `2026-2027_Ogretmen_Sozlesme_Tablosu.md` | Öğretmenlerin anlaşma gün ve saatleri |
| `sınıfların_geldiği_günler.md` | Sınıfların Geliyor / Gelebilir / Gelmiyor günleri |
| `DERS_SAATLERI_2026_2027.md` | Zil saatleri ve oturum sınırları |

### Sözleşme saatleri nasıl okunuyor?
Sözleşme ifadeleri zil cetveline çevrilir — bir ders saati, ancak **tamamı** öğretmenin çalışma
penceresine sığıyorsa müsait sayılır:

| Sözleşmede yazan | Karşılığı |
| :--- | :--- |
| `FULL` | O günün tüm ders saatleri |
| `İZİNLİ` | Hiç saat yok |
| `15.00'DAN SONRA` | Hafta içi 9-12. saat (15.00 ve sonrası) |
| `16.30 ÇIKIŞ` | 1-9. saat — akşam dersleri hariç (10. saat 16.30-17.10) |
| `13.00'E KADAR YARIM GÜN` | 1-5. saat (6. saat 13.00-13.40 hariç) |
| `SABAHTAN YARIM GÜN` | Sabah oturumu 1-6 |
| `Ö. SONRA YARIM GÜN` | Öğleden sonra oturumu 7-12 |
| `10.30-16.40 ARASI` | 3-9. saat |
| `FULL 12.15-18.55` | 5-12. saat |

Tablodaki **TOPLAM DERS SAATİ** sütunu müfredattaki gerçek yükle karşılaştırılır; fark varsa
uyarı olarak bildirilir. Sözleşmede bulunmayan öğretmenin müsaitliği XML programından türetilir.

Kaynak dosyalar arasındaki farklardan doğan tüm varsayım ve tutarsızlıklar *Kaynak dosya notları*
başlığıyla listelenir — sınıflarla ilgili olanlar **🏫 Sınıflar**, öğretmenlerle ilgili olanlar
**👩‍🏫 Öğretmenler** sekmesinin altında.

---

## 🔧 İpuçları

* **“Gelebilir”** günler yalnızca gerekirse kullanılır; hangisinin kullanıldığı Sınıflar sekmesinde
  **sarı çerçeveyle** ve Takvim'de özet tabloyla gösterilir.
* **🔄 Yeniden Oluştur → “Tamamen değiştir”** kilitleri de sıfırlar ve programı baştan kurar;
  ek günler yeniden seçilir. 379 saatlik program tipik olarak ~1 sn'de çıkar
  (pencere yüke tam oturduğu için çözücü boşluksuz bir dizilim bulana kadar deneme yapar).
* **⚙️ Deneme sayısı**'nı artırmak (örn. 150) daha derli toplu program üretir, süre uzar.
* **👩‍🏫 → 🪄 Günleri derslerinden doldur**, öğretmeni ders verdiği sınıfların kurumda olduğu tüm
  saatlerde müsait işaretler — hızlı başlangıç için idealdir.
* **⚙️ → 🧪 Kendini test**, programı çakışma, müsaitlik, blok ardışıklığı, saat sayısı, ek gün
  sınırı, **sınıfların gün içi boşluğu**, **oturumun ilk saatinden başlama** ve grup tutarlılığı
  açısından denetler.
* Bir sınıfın **yük = yer** olması sıfır esneklik demektir; Tanılama bunu uyarı olarak bildirir.

---

## 💻 Yerel çalıştırma

**En basiti:** `index.html` dosyasına çift tıklayın. Kurulum, internet, sunucu gerekmez —
betikler klasik `<script>` olduğu için `file://` üzerinden sorunsuz çalışır.

**Yerel sunucuyla** (isteğe bağlı, Node kuruluysa) — yayındaki hâline birebir aynı ortam:

```bash
npx serve .
# http://localhost:3000
```

> ⚠️ `file://` ile açtığınız hâli ile `http://localhost` ile açtığınız hâli, tarayıcı için
> **iki ayrı adrestir**; dolayısıyla ikisinin `localStorage` hafızası da ayrıdır.
> Çalışmanızı taşımak için üstteki **⬇ JSON yedek indir** / **⬆ yükle** düğmelerini kullanın.

---

## 🚀 Yayına alma (GitHub → Vercel)

### 1. GitHub'a yükleme

Bilgisayarınızda Git kurulu olması gerekmez; GitHub'ın web arayüzü yeterlidir.

1. [github.com/new](https://github.com/new) → depoya bir ad verin
   (örn. `ders-etut-programi`) → **Create repository**.
2. Açılan sayfada **uploading an existing file** bağlantısına tıklayın
   (veya var olan bir depoda: `Add file ▸ Upload files`).
3. Zip'ten çıkan klasörü açın ve **içindeki dosya/klasörleri** sürükleyip bırakın.
   ⚠️ Klasörün **kendisini** değil, içindekileri atın; yoksa `index.html` bir alt dizinde kalır
   ve site açılmaz.

   > **En azı yeter:** Sadece `index.html`'i yüklemeniz bile siteyi çalıştırmaya yeter —
   > uygulamanın tamamı o dosyanın içindedir. Diğerleri (kaynak dosyalar, belgeler)
   > yalnızca ileride düzenleme yapmak isterseniz lazım olur.
4. Alttaki **Commit changes** düğmesine basın.

> Windows gizli dosyaları göstermiyorsa `.gitignore` sürüklenemeyebilir. Önemli değil —
> zorunlu değildir; dilerseniz GitHub'da `Add file ▸ Create new file` ile elle ekleyebilirsiniz.

### 2. Vercel'e bağlama

1. [vercel.com](https://vercel.com) → GitHub hesabınızla giriş yapın.
2. **Add New… ▸ Project** → GitHub deponuzu bulup **Import**.
3. Ayarlar:

   | Alan | Değer |
   | :--- | :--- |
   | Framework Preset | **Other** |
   | Build Command | *(boş)* |
   | Output Directory | `.` |
   | Install Command | *(boş)* |

   Bu değerler zaten `vercel.json` içinde tanımlıdır; ekranda farklı görünürse elle düzeltin.
4. **Deploy** → birkaç saniye içinde `https://<proje-adi>.vercel.app` adresi hazır olur.

Bundan sonra GitHub'daki her değişiklik (web arayüzünden dosya düzenlemek dahil)
otomatik olarak yeniden yayına gider.

### 3. Yayın sonrası

* **Kendi alan adınız**: Vercel → Project → Settings → **Domains**.
* **Güncelleme**: GitHub'da ilgili dosyayı değiştirip commit'lemek yeterli.
  `assets/` dosyaları 1 saat önbelleklenir (`vercel.json`), `index.html` önbelleklenmez —
  güncellemeden hemen sonra eski sürümü görürseniz **Ctrl + F5** ile sayfayı zorla yenileyin.
* **Alternatif — Vercel CLI**: `npx vercel --prod` (proje klasörünün içinden).
* **Alternatif — GitHub Pages**: Settings ▸ Pages ▸ Branch `main` / `root`.
  Depoda bunun için `.nojekyll` dosyası hazır bulunur.

### 4. Sorun giderme

| Gördüğünüz | Nedeni | Çözümü |
| :--- | :--- | :--- |
| **404: NOT_FOUND** | `index.html` depo kökünde değil, bir alt klasörde (en sık hata) | Vercel ▸ Project ▸ Settings ▸ **General ▸ Root Directory** ▸ **Edit** ▸ `index.html`'in bulunduğu klasörü seçin ▸ Save ▸ Deployments ▸ **Redeploy**. Ya da GitHub'da dosyaları köke taşıyın. |
| **No Output Directory named "public" found** | `vercel.json` okunamıyor (yine alt klasör sorunu) ya da Framework Preset yanlış | Root Directory'yi düzeltin; Settings ▸ **Build & Development Settings** ▸ Framework Preset **Other**, Build Command boş, Output Directory `.` |
| Sayfa **giriş ekranı** istiyor | Vercel **Deployment Protection** (yeni projelerde varsayılan açık) | Settings ▸ **Deployment Protection** ▸ Vercel Authentication ▸ **Disabled** ▸ Save |
| Sayfa açılıyor ama **stil yok / içerik boş** | Eski sürümde `assets/` klasörü siteye gitmemişti | Artık mümkün değil — `index.html` her şeyi içinde taşıyor. Böyle bir görüntü alıyorsanız **eski** `index.html` yayındadır; yenisini yükleyip **Ctrl + F5** yapın |
| **Kırmızı "Uygulama açılamadı" kutusu** | Açılış denetçisi bir JavaScript hatası yakaladı | Kutudaki metni kopyalayın — hatanın satır numarasıyla birlikte ne olduğunu yazar |
| **Değişiklik görünmüyor** | Tarayıcı önbelleği | **Ctrl + F5** (Mac: ⌘ + Shift + R) |

> `docs/` klasörü `.vercelignore` ile yayından çıkarılmıştır — öğretmen sözleşme tablosu gibi
> kurum içi dosyalar internete açılmaz. Dosyalar depoda referans olarak durmaya devam eder.

---

## 🔐 Veri ve gizlilik

Uygulamanın **sunucu tarafı yoktur**. Yayına alınmış hâlinde de bütün hesaplama
kullanıcının tarayıcısında yapılır ve bütün veri `localStorage`'da, yalnızca o
tarayıcıda kalır. Hiçbir bilgi Vercel'e, GitHub'a ya da başka bir yere gönderilmez.

Bunun iki sonucu vardır:

* Programınız **cihaza özeldir** — başka bilgisayarda açtığınızda örnek veriyle başlar.
  Taşımak için **⬇ / ⬆** JSON yedeğini kullanın.
* Tarayıcı verilerini temizlemek (geçmiş silme, "site verileri" temizleme) çalışmanızı da siler.
  Önemli aşamalarda **💾 Hafıza → kayıt noktası** alın ve ara ara JSON yedeği indirin.

---

## 📚 `docs/` klasörü

Örnek verinin (`assets/seed.js`) üretildiği kaynak dosyalardır; uygulama bunları
**çalışırken okumaz**, yalnızca referans olarak durur. Git ile uyumlu olsun diye
dosya adları ASCII'ye çevrilmiştir:

| Depodaki ad | Özgün ad |
| :--- | :--- |
| `docs/ders-programi.xml` | `ders programı.xml` |
| `docs/sinif-gelis-gunleri.md` | `sınıfların_geldiği_günler.md` |
| `docs/2026-2027_Ogretmen_Sozlesme_Tablosu.md` | *(aynı)* |
| `docs/DERS_SAATLERI_2026_2027.md` | *(aynı)* |

aSc program dosyası (`.roz`, 427 KB) uygulamada kullanılmadığı için depoya dahil edilmemiştir
(`.gitignore`).
