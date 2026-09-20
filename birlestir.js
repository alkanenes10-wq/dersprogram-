#!/usr/bin/env node
/* ============================================================
   BİRLEŞTİRİCİ
   assets/ içindeki CSS + 3 betiği okuyup tek bir index.html üretir.

   Kullanımı:  node birlestir.js

   assets/ içindeki bir dosyayı düzenlediyseniz bu komutu çalıştırın,
   yoksa değişiklik index.html'e yansımaz.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const kok = __dirname;
const oku = (p) => fs.readFileSync(path.join(kok, p), 'utf8');

const sablon = oku('assets/sablon.html');
const css    = oku('assets/styles.css');
const betik  = ['assets/engine.js', 'assets/seed.js', 'assets/app.js']
  .map((f) => `/* ===== ${path.basename(f)} ===== */\n` + oku(f))
  .join('\n\n');

// Gömülen metinde </script> ya da </style> geçerse HTML erken kapanır.
const guvenli = (s, etiket) => {
  const re = new RegExp('</\\s*' + etiket, 'gi');
  if (re.test(s)) {
    console.error(`HATA: gömülecek içerikte </${etiket} geçiyor, birleştirme durduruldu.`);
    process.exit(1);
  }
  return s;
};

const cikti = sablon
  .replace('/*__STIL__*/', () => guvenli(css, 'style'))
  .replace('/*__BETIK__*/', () => guvenli(betik, 'script'));

if (cikti.includes('/*__STIL__*/') || cikti.includes('/*__BETIK__*/')) {
  console.error('HATA: assets/sablon.html içindeki yer tutucular bulunamadı.');
  process.exit(1);
}

fs.writeFileSync(path.join(kok, 'index.html'), cikti);

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log('index.html yazıldı — ' + kb(Buffer.byteLength(cikti)));
console.log('  stil  : ' + kb(css.length));
console.log('  betik : ' + kb(betik.length));
