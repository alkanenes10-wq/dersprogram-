/* ============================================================
   UYGULAMA
   ============================================================ */
'use strict';
var E = ENGINE, P = E.P;
var LS = 'dersprog.v2';
var DN, DS;
var state = null, view = null, lastRun = null, tab = 'takvim';

/* ---------------- durum ---------------- */
function freshState() {
  var s = JSON.parse(JSON.stringify(SEED));
  s.schedule = []; s.etuts = [];
  s.memory = { snapshots: [], log: [] };
  return s;
}
function load() {
  try {
    var raw = localStorage.getItem(LS);
    if (raw) { var s = JSON.parse(raw); if (s && s.settings && s.classes) return s; }
  } catch (e) { console.warn('localStorage okunamadı', e); }
  return null;
}
var saveT = null, saveWarned = false;
function saveNow() {
  clearTimeout(saveT); saveT = null;
  try { localStorage.setItem(LS, JSON.stringify(state)); saveWarned = false; }
  catch (e) {
    if (!saveWarned) {
      saveWarned = true;
      toast('Tarayıcı hafızasına yazılamadı (' + e.name + '). Eski kayıt noktalarını silin ya da ⬇ ile JSON yedek alın.', 'err');
    }
  }
}
function save() { clearTimeout(saveT); saveT = setTimeout(saveNow, 250); }
window.addEventListener('beforeunload', function () { if (saveT) saveNow(); });
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden' && saveT) saveNow();
});
function logIt(m) {
  state.memory.log.unshift({ t: Date.now(), m: m });
  if (state.memory.log.length > 400) state.memory.log.length = 400;
}

/* ---------------- yardımcılar ---------------- */
function el(tag, cls, txt) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}
/* HTML parçasından element üretir.
   <div>.innerHTML tablo bağlamı olmadığı için <tr>/<td>/<th>/<thead> etiketlerini yutar
   (firstElementChild null döner, appendChild patlar). <template> ise bunları doğru ayrıştırır. */
function h(html) {
  var t = document.createElement('template');
  t.innerHTML = String(html == null ? '' : html).trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function idxBy(arr) { var o = {}; for (var i = 0; i < arr.length; i++) o[arr[i].id] = arr[i]; return o; }
function toast(m, k) {
  var t = el('div', 'toast ' + (k || ''), m);
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, k === 'err' ? 6000 : 2800);
}
function fmtDate(t) {
  var d = new Date(t);
  return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}
var CL, TE, SU;
function cname(id) { return (CL[id] || {}).name || '?'; }
function tname(id) { return (TE[id] || {}).name || '?'; }
function sname(id) { return (SU[id] || {}).name || '?'; }
function sshort(id) { return (SU[id] || {}).short || sname(id); }
function tcolor(id) { return (TE[id] || {}).color || '#6699FF'; }
function tshort(id) {
  var n = tname(id).split(/\s+/).filter(Boolean);
  return n.length > 1 ? n[0] + ' ' + n[n.length - 1].charAt(0) + '.' : (n[0] || '?');
}
/** açık zemin için rengi seyrelt */
function tint(hex, a) {
  var m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return 'rgba(102,153,255,' + a + ')';
  var n = parseInt(m[1], 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function activeDayList() {
  var o = [];
  for (var d = 1; d <= 7; d++) if (state.settings.activeDays[d - 1]) o.push(d);
  return o;
}
/**
 * O kayıt, o gün kurumda hiç bulunmuyor mu?
 * Öğretmen: sözleşme tablosundaki günün tamamı 0 ise “İZİNLİ”.
 * Sınıf    : classDays[gün] = 0 ise o gün gelmiyor.
 * Kurumda olunan ama sözleşme saati dışında kalan tekil saatler bu kapsamda DEĞİLDİR;
 * onlar hücre bazında “kurum saati dışı” olarak gösterilir.
 */
function rowDayOff(mode, id, d) {
  if (!state.settings.activeDays[d - 1]) return true;
  if (mode === 'sinif') return !(((state.classDays || {})[id] || [])[d - 1] | 0);
  var s = ((state.teacherAvail || {})[id] || {})[d] || '';
  return String(s).indexOf('1') < 0;
}
function dayOffWord(mode) { return mode === 'sinif' ? 'GELMİYOR' : 'İZİNLİ'; }

function allCards() {
  return state.schedule.concat(state.etuts.map(function (e) {
    return { classId: e.classId, teacherId: e.teacherId, subjectId: e.subjectId || null, day: e.day,
             period: e.period, kind: 'etut', locked: true, etutId: e.id, student: e.student, note: e.note };
  }));
}
function lessonsOfClass(cid) { return state.curriculum.filter(function (L) { return L.classId === cid; }); }
function lessonsOfTeacher(tid) { return state.curriculum.filter(function (L) { return L.teacherId === tid; }); }

/* ---------------- yenile ---------------- */
function refresh(rerender) {
  CL = idxBy(state.classes); TE = idxBy(state.teachers); SU = idxBy(state.subjects);
  DN = state.settings.dayNames; DS = state.settings.dayShort;
  var maps = E.buildMaps(state);
  /* Kapasite/tanılama, sınıfın DARALTILMIŞ değil, geldiği OTURUMLARIN tamamı üzerinden ölçülür */
  var baseMaps = E.buildMaps({ settings: state.settings, classes: state.classes, teachers: state.teachers,
                               classDays: state.classDays, classSlots: baseSlots(),
                               teacherAvail: state.teacherAvail });
  var cards = allCards();
  view = {
    maps: maps, baseMaps: baseMaps, cards: cards,
    gaps: E.teacherGaps(state, maps, cards),
    freeBy: E.freeCountBySlot(state, maps, cards),
    groups: E.detectGroups(state),
    diag: E.diagnose(state, baseMaps, cards.filter(function (c) { return c.kind === 'etut' || c.locked; }),
      lastRun ? { cards: state.schedule, missing: lastRun.missingBlocks || [],
                  activeOk: null, overflow: lastRun.overflow || [] } : null),
    errs: E.validate(state, maps, state.schedule),
    optionalDays: lastRun ? (lastRun.optionalDays || {}) : {},
  };
  renderKpis(); renderTabs();
  if (rerender !== false) render();
  save();
}

/* ---------------- KPI ---------------- */
function renderKpis() {
  var box = document.getElementById('kpis');
  box.innerHTML = '';
  var total = state.curriculum.reduce(function (s, l) { return s + l.hours; }, 0);
  var placed = state.schedule.length, missing = total - placed;
  var nerr = view.diag.filter(function (d) { return d.level === 'error'; }).length;
  var nwarn = view.diag.filter(function (d) { return d.level === 'warn'; }).length;
  var freeH = 0;
  for (var k in view.gaps) freeH += view.gaps[k].free;
  function kpi(l, v, c, t) {
    box.appendChild(h('<div class="kpi ' + (c || '') + '" title="' + esc(t || '') + '"><span>' +
      esc(l) + '</span><b>' + esc(v) + '</b></div>'));
  }
  kpi('Yerleşen', placed + '/' + total, placed && !missing ? 'ok' : (missing ? 'warn' : ''), 'Yerleşen / toplam ders saati');
  if (missing > 0) kpi('Eksik', missing + ' saat', 'err', 'Yerleşemeyen ders saati — 🩺 Tanılama');
  kpi('Öğretmen boş', freeH + ' saat', '', 'Öğretmenlerin müsait olup dersi olmayan toplam saati');
  kpi('Etüt', state.etuts.length, state.etuts.length ? 'ok' : '', 'Planlanmış etüt / özel ders');
  if (nerr) kpi('Hata', nerr, 'err', 'Tanılama sekmesindeki hata sayısı');
  else if (nwarn) kpi('Uyarı', nwarn, 'warn', 'Tanılama sekmesindeki uyarı sayısı');
  else kpi('Tanı', 'temiz', 'ok', 'Hiç hata yok');
  if (view.errs.length) kpi('ÇAKIŞMA', view.errs.length, 'err', view.errs.slice(0, 3).join(' / '));
  if (lastRun && lastRun.splits != null) {
    var brk = (lastRun.splits || 0) + (lastRun.classGaps || 0);
    kpi('Ardışıklık', brk ? brk + ' kopukluk' : 'tam', brk ? 'warn' : 'ok',
      'Aynı dersin gün içinde kopuk yerleştiği yer: ' + (lastRun.splits || 0) +
      ' · sınıfların gün içi ara boşluğu: ' + (lastRun.classGaps || 0) + ' saat (0 = dersler arka arkaya)');
  }
  if (lastRun) kpi('Süre', lastRun.ms + ' ms', '', lastRun.attempts + ' deneme');
}

/* ---------------- sekmeler ---------------- */
var TABS = [
  ['takvim', '📅 Takvim'], ['bosluk', '🕳 Öğretmen Boşlukları'], ['etut', '🎓 Etüt Paneli'],
  ['sinif', '🏫 Sınıflar'], ['ogretmen', '👩‍🏫 Öğretmenler'],
  ['ayar', '⚙️ Kurum Ayarları'], ['tani', '🩺 Tanılama']
];
function renderTabs() {
  var box = document.getElementById('tabs');
  box.innerHTML = '';
  var nerr = view.diag.filter(function (d) { return d.level === 'error'; }).length;
  var nwarn = view.diag.filter(function (d) { return d.level === 'warn'; }).length;
  TABS.forEach(function (t) {
    var b = el('button', 'tab' + (tab === t[0] ? ' on' : ''));
    b.appendChild(document.createTextNode(t[1]));
    if (t[0] === 'tani' && (nerr || nwarn)) b.appendChild(el('span', 'badge' + (nerr ? '' : ' w'), String(nerr || nwarn)));
    b.onclick = function () { tab = t[0]; renderTabs(); render(); };
    box.appendChild(b);
  });
}

var ui = { calRows: 'sinif', calView: 'one', calLayout: 'days', calDay: 'all', calZoom: 'md',
           calDetail: null, calFind: '',
           gapSel: null, etutT: null, etutC: null, etutS: '',
           clsSel: null, tchSel: null, avmMode: 'durum' };
function render() {
  var v = document.getElementById('view');
  v.innerHTML = '';
  var fn = { takvim: viewTakvim, bosluk: viewBosluk, etut: viewEtut, sinif: viewSinif,
             ogretmen: viewOgretmen, ayar: viewAyar, tani: viewTani }[tab];
  fn(v);
}

/* ============================================================
   📅 TAKVİM — aSc ana program görünümü
   ============================================================ */
/** Takvimde gösterilecek günler (gün süzgecine göre) */
function calDays() {
  var all = activeDayList();
  if (ui.calDay === 'week') return all.filter(function (d) { return d <= 5; });
  if (ui.calDay === 'wend') return all.filter(function (d) { return d >= 6; });
  if (ui.calDay !== 'all') {
    var d1 = +ui.calDay;
    return all.indexOf(d1) >= 0 ? [d1] : all;
  }
  return all;
}

/** Seçili kipte listelenen kayıtlar (sınıflar ya da öğretmenler) */
function calRowList() { return ui.calRows === 'sinif' ? state.classes : state.teachers; }

/** “Tek program” kipi: bir sınıfın/öğretmenin haftalık programı büyük ve tek başına */
function calOnePicker(root) {
  var list = calRowList();
  if (!list.length) { root.appendChild(h('<div class="empty">Kayıt yok.</div>')); return; }
  var idx = -1, i;
  for (i = 0; i < list.length; i++) if (list[i].id === ui.calDetail) idx = i;
  if (idx < 0) { idx = 0; ui.calDetail = list[0].id; }

  var bar = el('div', 'onepick');
  var prev = el('button', 'btn sm', '◀');
  prev.title = 'Önceki';
  prev.onclick = function () { ui.calDetail = list[(idx - 1 + list.length) % list.length].id; render(); };
  bar.appendChild(prev);

  var sel = el('select');
  sel.title = ui.calRows === 'sinif' ? 'Sınıf seç' : 'Öğretmen seç';
  var q = (ui.calFind || '').toLocaleLowerCase('tr');
  list.forEach(function (x) {
    if (q && x.name.toLocaleLowerCase('tr').indexOf(q) < 0 && x.id !== ui.calDetail) return;
    var o = el('option', '', x.name);
    o.value = x.id;
    if (x.id === ui.calDetail) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = function () { ui.calDetail = sel.value; render(); };
  bar.appendChild(sel);

  var nx = el('button', 'btn sm', '▶');
  nx.title = 'Sonraki';
  nx.onclick = function () { ui.calDetail = list[(idx + 1) % list.length].id; render(); };
  bar.appendChild(nx);

  var f = el('input', 'search');
  f.type = 'search';
  f.placeholder = ui.calRows === 'sinif' ? 'Sınıf ara…' : 'Öğretmen ara…';
  f.value = ui.calFind || '';
  f.oninput = function () {
    ui.calFind = f.value;
    var hit = null;
    var qq = f.value.toLocaleLowerCase('tr');
    if (qq) {
      list.forEach(function (x) {
        if (!hit && x.name.toLocaleLowerCase('tr').indexOf(qq) >= 0) hit = x.id;
      });
      if (hit) ui.calDetail = hit;
    }
    render();
    var nf = document.querySelector('.onepick input.search');
    if (nf) { nf.focus(); nf.setSelectionRange(nf.value.length, nf.value.length); }
  };
  bar.appendChild(f);

  bar.appendChild(h('<span class="hint" style="margin-left:auto">' + (idx + 1) + ' / ' + list.length +
    ' · ← → tuşlarıyla da gezebilirsiniz</span>'));
  root.appendChild(bar);
  root.appendChild(detailCard(ui.calRows, ui.calDetail, true));
}

function viewTakvim(root) {
  /* --- satır kipi + görünüm --- */
  var bar = el('div', 'bar');
  var seg = el('div', 'seg');
  [['sinif', '🏫 Sınıflara göre'], ['ogretmen', '👩‍🏫 Öğretmenlere göre']].forEach(function (m) {
    var b = el('button', ui.calRows === m[0] ? 'on' : '', m[1]);
    b.onclick = function () { ui.calRows = m[0]; ui.calDetail = null; ui.calFind = ''; render(); };
    seg.appendChild(b);
  });
  bar.appendChild(seg);

  var lv = el('label');
  lv.appendChild(document.createTextNode('Görünüm'));
  var vseg = el('div', 'seg');
  [['one', '🗓 Tek program'], ['grid', '📊 Toplu ızgara']].forEach(function (v) {
    var b = el('button', ui.calView === v[0] ? 'on' : '', v[1]);
    b.title = v[0] === 'one'
      ? 'Tek sınıfın/öğretmenin haftalık programı — büyük ve net'
      : 'Tüm sınıf/öğretmenler tek ızgarada (aSc görünümü)';
    b.onclick = function () { ui.calView = v[0]; render(); };
    vseg.appendChild(b);
  });
  lv.appendChild(vseg);
  bar.appendChild(lv);

  if (ui.calView === 'one') {
    root.appendChild(bar);
    calOnePicker(root);
    return;
  }

  var ll = el('label');
  ll.appendChild(document.createTextNode('Yerleşim'));
  var lseg = el('div', 'seg');
  [['days', '📆 Gün gün'], ['strip', '↔ Tek şerit']].forEach(function (v) {
    var b = el('button', ui.calLayout === v[0] ? 'on' : '', v[1]);
    b.title = v[0] === 'days'
      ? 'Her gün ayrı tablo — 12 ders saati ekrana sığar, yana kaydırmaya gerek kalmaz'
      : 'Bütün günler tek uzun şeritte (7 gün × 12 saat yan yana)';
    b.onclick = function () { ui.calLayout = v[0]; render(); };
    lseg.appendChild(b);
  });
  ll.appendChild(lseg);
  bar.appendChild(ll);

  var lz = el('label');
  lz.appendChild(document.createTextNode('Boyut'));
  var zseg = el('div', 'seg');
  [['sm', 'Küçük'], ['md', 'Orta'], ['lg', 'Büyük']].forEach(function (z) {
    var b = el('button', ui.calZoom === z[0] ? 'on' : '', z[1]);
    b.onclick = function () { ui.calZoom = z[0]; render(); };
    zseg.appendChild(b);
  });
  lz.appendChild(zseg);
  bar.appendChild(lz);
  root.appendChild(bar);

  /* --- gün süzgeci --- */
  var dbar = el('div', 'bar');
  dbar.appendChild(h('<label style="margin-right:2px">Gün</label>'));
  var ch0 = el('div', 'chips');
  var opts = [['all', 'Tümü (' + activeDayList().length + ' gün)'], ['week', 'Hafta içi'], ['wend', 'Hafta sonu']];
  activeDayList().forEach(function (d) { opts.push([String(d), DN[d - 1]]); });
  opts.forEach(function (o) {
    var b = el('button', 'chip' + (String(ui.calDay) === o[0] ? ' on' : ''), o[1]);
    b.onclick = function () { ui.calDay = o[0]; render(); };
    ch0.appendChild(b);
  });
  dbar.appendChild(ch0);
  root.appendChild(dbar);

  var days = calDays();
  var nCol = days.length * P;
  var rowW = ui.calRows === 'sinif' ? 'sınıflar' : 'öğretmenler';
  root.appendChild(h('<div class="hint" style="margin-bottom:10px">' +
    (ui.calLayout === 'days'
      ? '<b>' + days.length + ' gün</b> alt alta, her gün ayrı tablo: kolonlar <b>' + P +
        ' ders saati</b> (ekrana sığar), satırlar <b>' + rowW + '</b>.'
      : 'Günler sabit kolon, satırlar <b>' + rowW + '</b>. Şu an <b>' + days.length + ' gün · ' +
        nCol + ' kolon</b> gösteriliyor' +
        (nCol > 36 ? ' — yana kaydırmadan görmek için <b>📆 Gün gün</b> yerleşimine geçin.' : '.')) +
    '<br>Satır başlığına (sınıf/öğretmen adına) tıklayınca o kaydın <b>haftalık programı 🗓 Tek program ' +
    'kipinde büyük olarak</b> açılır. Ders kartına tıklamak <b>kilitler / kilidi açar</b>.</div>'));

  /* --- detay görünümü --- */
  if (ui.calDetail) {
    var okD = ui.calRows === 'sinif' ? CL[ui.calDetail] : TE[ui.calDetail];
    if (okD) root.appendChild(detailCard(ui.calRows, ui.calDetail));
    else ui.calDetail = null;
  }

  root.appendChild(ui.calLayout === 'days' ? dayBoards(ui.calRows, days) : ascGrid(ui.calRows, days));
  root.appendChild(h('<div class="legend" style="margin-top:10px">' +
    '<span><i style="background:#cfe0f5"></i>Ders (öğretmen renginde)</span>' +
    '<span><i style="background:var(--etut-soft);border-color:var(--etut-line);' +
      'box-shadow:inset 3px 0 0 var(--etut)"></i><b style="color:var(--etut)">Etüt</b></span>' +
    '<span><i style="background:#fff;box-shadow:inset 0 0 0 1.5px #7b4fd1"></i>🔒 Kilitli ders</span>' +
    '<span><i style="background:#eefaf3;border-color:#bfe6d2"></i><b style="color:#1c6b48">Boş</b> ' +
      '(kurumda, dersi yok)</span>' +
    '<span><i style="background:#fdf6e4;border-color:#eddba5"></i>“Gelebilir” günü</span>' +
    '<span><i style="background:repeating-linear-gradient(45deg,var(--absent-soft),var(--absent-soft) 3px,' +
      '#fbdad6 3px,#fbdad6 6px);border-color:var(--absent-line)"></i>' +
      '<b style="color:var(--absent)">' + (ui.calRows === 'sinif' ? 'Gelmiyor' : 'İzinli') +
      '</b> — o gün hiç kurumda değil</span>' +
    '<span><i style="background:repeating-linear-gradient(45deg,#f4f7fa,#f4f7fa 3px,#e6edf5 3px,#e6edf5 6px)"></i>' +
      'Saat dışı — o gün kurumda, bu saat sözleşme dışı</span>' +
    '<span><i style="background:#f0f3f6"></i>Etüt arası — ders yerleşmez</span></div>'));

  var chosen = view.optionalDays || {};
  var rowsC = Object.keys(chosen).filter(function (cid) { return chosen[cid] && chosen[cid].length; });
  if (rowsC.length) {
    var c = el('div', 'card soft');
    c.style.marginTop = '14px';
    c.appendChild(h('<h3>Çözücünün seçtiği “Gelebilir” günler <span class="chip">' + rowsC.length + ' sınıf</span></h3>'));
    c.appendChild(h('<div class="hint">Bu sınıfların haftalık yükü kesin günlerine sığmadı; program, o dersi ' +
      'veren öğretmenin en müsait olduğu ek günü seçti ve paralel şubeleri ayrı günlere dağıttı. ' +
      'Sınıf başına en fazla <b>' + (state.settings.maxOptionalDays == null ? 1 : state.settings.maxOptionalDays) +
      '</b> ek gün kullanılır (⚙️ Kurum Ayarları).</div>'));
    var tb = el('table');
    tb.appendChild(h('<thead><tr><th>Sınıf</th><th>Ek gün</th><th>O güne yerleşen dersler</th></tr></thead>'));
    var tbody = el('tbody');
    rowsC.sort(function (a, b) { return cname(a).localeCompare(cname(b), 'tr'); }).forEach(function (cid) {
      var ds = chosen[cid];
      var uniq = [];
      state.schedule.forEach(function (x) {
        if (x.classId !== cid || ds.indexOf(x.day) < 0) return;
        var w = sshort(x.subjectId) + ' · ' + tshort(x.teacherId);
        if (uniq.indexOf(w) < 0) uniq.push(w);
      });
      tbody.appendChild(h('<tr><td class="rowhead">' + esc(cname(cid)) + '</td><td><b>' +
        ds.map(function (d) { return esc(DN[d - 1]); }).join(', ') + '</b></td><td>' +
        esc(uniq.join(' · ') || '—') + '</td></tr>'));
    });
    tb.appendChild(tbody);
    var sc = el('div', 'scroll'); sc.appendChild(tb); c.appendChild(sc);
    root.appendChild(c);
  }
}

/* ---------- 📆 Gün gün yerleşim: her gün ayrı tablo (aSc “günlük plan” görünümü) ---------- */
function dayBoards(mode, days) {
  days = days || activeDayList();
  var rows = mode === 'sinif' ? state.classes : state.teachers;
  var occ = {};
  view.cards.forEach(function (c) {
    occ[(mode === 'sinif' ? c.classId : c.teacherId) + '_' + c.day + '_' + c.period] = c;
  });
  var chosen = view.optionalDays || {};
  var box = el('div');

  days.forEach(function (d) {
    var rs = [], nH = 0, nE = 0, nF = 0, nOff = 0;
    rows.forEach(function (rw) {
      var ok = mode === 'sinif' ? view.maps.classOk[rw.id] : view.maps.teachOk[rw.id];
      if (!ok) return;
      var off = rowDayOff(mode, rw.id, d);
      var hrs = 0, et = 0, fr = 0;
      for (var p = 1; p <= P; p++) {
        var cc = occ[rw.id + '_' + d + '_' + p];
        if (cc) { if (cc.kind === 'etut') et++; else hrs++; }
        else if (ok[E.si(d, p)]) fr++;
      }
      nH += hrs; nE += et; nF += fr;
      if (off) nOff++;
      rs.push({ rw: rw, ok: ok, off: off, hrs: hrs, et: et, fr: fr });
    });

    var card = el('div', 'card dayboard');
    var who = mode === 'sinif' ? 'sınıf' : 'öğretmen';
    card.appendChild(h('<h3>' + esc(DN[d - 1]) +
      '<span class="chip">' + (rs.length - nOff) + ' ' + who + ' kurumda</span>' +
      '<span class="chip">' + nH + ' ders saati</span>' +
      '<span class="chip" style="background:var(--ok-soft);border-color:#b6e2cc;color:#1c6b48">' +
        nF + ' boş saat</span>' +
      (nE ? '<span class="chip" style="background:var(--etut-soft);border-color:var(--etut-line);' +
        'color:var(--etut)">' + nE + ' etüt</span>' : '') +
      (nOff ? '<span class="chip" style="background:var(--absent-soft);border-color:var(--absent-line);' +
        'color:var(--absent)">' + nOff + ' ' + esc(dayOffWord(mode).toLocaleLowerCase('tr')) + '</span>' : '') +
      '</h3>'));
    if (!rs.length) {
      card.appendChild(h('<div class="empty">Kayıt yok.</div>'));
      box.appendChild(card);
      return;
    }

    var wrap = el('div', 'dbw z-' + (ui.calZoom || 'md'));
    var t = el('table', 'db');
    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(h('<th class="corner">' + (mode === 'sinif' ? 'Sınıf' : 'Öğretmen') + '</th>'));
    for (var p1 = 1; p1 <= P; p1++) {
      var tl = E.timeLabel(state.settings, d, p1) || '';
      hr.appendChild(h('<th title="' + esc(DN[d - 1] + ' ' + p1 + '. ders · ' + tl) + '">' + p1 + '. ders' +
        '<small>' + esc(tl) + '</small></th>'));
    }
    thead.appendChild(hr);
    t.appendChild(thead);

    var tbody = el('tbody');
    rs.forEach(function (r) {
      var tr = el('tr', r.off ? 'rowoff' : '');
      var sub = r.off
        ? '<small class="x">' + esc(dayOffWord(mode).toLocaleLowerCase('tr')) + '</small>'
        : '<small class="' + (r.fr ? 'f' : 'e') + '">' + r.fr + ' boş' +
          (r.et ? ' · ' + r.et + ' etüt' : '') + '</small>';
      var rh = h('<td class="rh" title="' + esc(r.rw.name + ' — ' + DN[d - 1] + ': ' +
        (r.off ? dayOffWord(mode) + ' (sözleşme gereği kurumda değil)'
               : r.hrs + ' ders · ' + r.et + ' etüt · ' + r.fr + ' boş saat')) +
        '\nHaftalık programını büyük açmak için tıkla">' + esc(r.rw.name) + sub + '</td>');
      (function (id) {
        rh.onclick = function () {
          ui.calDetail = id;
          ui.calView = 'one';
          render();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        };
      })(r.rw.id);
      tr.appendChild(rh);

      /* sözleşme gereği o gün hiç kurumda değil — tüm günü tek kırmızı şerit yap */
      if (r.off) {
        var tdo = h('<td class="ac dayoff" colspan="' + P + '"><div class="fl">' +
          esc(dayOffWord(mode)) + ' — ' + esc(DN[d - 1]) + ' günü kurumda değil, boş saati yok</div></td>');
        tdo.title = r.rw.name + ' — ' + DN[d - 1] + ': ' + dayOffWord(mode) +
          '\nSözleşmesinde bu gün yok; bu güne ders ya da etüt yazılamaz.';
        tr.appendChild(tdo);
        tbody.appendChild(tr);
        return;
      }

      for (var p = 1; p <= P; p++) {
        var td = el('td', 'ac');
        var c = occ[r.rw.id + '_' + d + '_' + p], stt = r.ok[E.si(d, p)];
        var isOptChosen = mode === 'sinif' && stt === 2 && (chosen[r.rw.id] || []).indexOf(d) >= 0;
        if (c) {
          fillAsc(td, c, mode, isOptChosen);
        } else if (!E.lessonBand(state.settings, d, p)) {
          td.className += ' nolesson';
          td.title = 'Etüt arası (' + E.timeLabel(state.settings, d, p) + ') — ders yerleşmez';
        } else if (stt) {
          td.className += ' free' + (stt === 2 ? ' opt' : '');
          td.appendChild(h('<div class="fl">' + (stt === 2 ? '~ boş' : 'boş') + '</div>'));
          td.title = r.rw.name + ' — ' + DN[d - 1] + ' ' + p + '. ders (' +
            E.timeLabel(state.settings, d, p) + ')\nBOŞ' +
            (stt === 2 ? '\n“Gelebilir” günü' + (isOptChosen ? ' — bu programda kullanılıyor' : ' — kullanılmıyor') : '');
        } else {
          td.className += ' off';
          td.appendChild(h('<div class="fl">saat dışı</div>'));
          td.title = r.rw.name + ' — ' + DN[d - 1] + ' ' + p + '. ders (' +
            E.timeLabel(state.settings, d, p) + ')\nBu gün kurumda, ama bu saat sözleşme saatleri dışında.';
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
    wrap.appendChild(t);
    card.appendChild(wrap);
    box.appendChild(card);
  });
  return box;
}

function ascGrid(mode, days) {
  days = days || activeDayList();
  var rows = mode === 'sinif' ? state.classes : state.teachers;
  var occ = {};
  view.cards.forEach(function (c) {
    occ[(mode === 'sinif' ? c.classId : c.teacherId) + '_' + c.day + '_' + c.period] = c;
  });
  var chosen = view.optionalDays || {};
  var single = days.length === 1;
  var wrap = el('div', 'ascwrap z-' + (ui.calZoom || 'md'));
  var t = el('table', 'asc');

  var thead = el('thead');
  var r1 = el('tr');
  r1.appendChild(h('<th class="corner" rowspan="2">' + (mode === 'sinif' ? 'Sınıf' : 'Öğretmen') + '</th>'));
  days.forEach(function (d) {
    r1.appendChild(h('<th colspan="' + P + '" class="dayend">' + esc(DN[d - 1]) + '</th>'));
  });
  thead.appendChild(r1);
  var r2 = el('tr');
  days.forEach(function (d) {
    for (var p = 1; p <= P; p++) {
      var tl = E.timeLabel(state.settings, d, p) || '';
      // tek gün ya da büyük boyutta tam aralık, aksi hâlde yalnızca başlangıç saati
      var lbl = (single || ui.calZoom === 'lg') ? tl : tl.split('-')[0];
      r2.appendChild(h('<th class="' + (p === P ? 'dayend' : '') + '" title="' +
        esc(DN[d - 1] + ' ' + p + '. ders · ' + tl) + '">' + p + '. ders' +
        '<small>' + esc(lbl) + '</small></th>'));
    }
  });
  thead.appendChild(r2);
  t.appendChild(thead);

  var tbody = el('tbody');
  rows.forEach(function (rw) {
    var ok = mode === 'sinif' ? view.maps.classOk[rw.id] : view.maps.teachOk[rw.id];
    if (!ok) return;
    var any = false, s;
    for (s = 0; s < E.NSLOT; s++) if (ok[s]) { any = true; break; }
    if (!any) {
      for (var d0 = 1; d0 <= 7 && !any; d0++) {
        for (var p0 = 1; p0 <= P; p0++) if (occ[rw.id + '_' + d0 + '_' + p0]) { any = true; break; }
      }
    }
    if (!any) return;
    var tr = el('tr');
    var rh = h('<td class="rh" title="' + esc(rw.name) + ' — haftalık programını büyük açmak için tıkla">' +
      esc(mode === 'sinif' ? rw.name : tshort(rw.id)) + '</td>');
    rh.onclick = function () {
      ui.calDetail = rw.id;
      ui.calView = 'one';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    tr.appendChild(rh);
    days.forEach(function (d) {
      /* sözleşme gereği o gün hiç kurumda değil — günün tamamı tek kırmızı hücre */
      if (rowDayOff(mode, rw.id, d)) {
        var tdo = h('<td class="ac dayoff dayend" colspan="' + P + '"><div class="fl">' +
          esc(dayOffWord(mode)) + '</div></td>');
        tdo.title = (mode === 'sinif' ? cname(rw.id) : tname(rw.id)) + ' — ' + DN[d - 1] + ': ' +
          dayOffWord(mode) + '\nSözleşmesinde bu gün yok; boş saati de yok.';
        tr.appendChild(tdo);
        return;
      }
      for (var p = 1; p <= P; p++) {
        var td = el('td', 'ac' + (p === P ? ' dayend' : ''));
        var card = occ[rw.id + '_' + d + '_' + p], stt = ok[E.si(d, p)];
        var isOptChosen = mode === 'sinif' && stt === 2 && (chosen[rw.id] || []).indexOf(d) >= 0;
        if (card) {
          fillAsc(td, card, mode, isOptChosen);
        } else if (!E.lessonBand(state.settings, d, p)) {
          td.className += ' nolesson';
          if (single) td.appendChild(h('<div class="fl">etüt arası</div>'));
          td.title = 'Etüt arası (' + E.timeLabel(state.settings, d, p) + ') — ders yerleşmez';
        } else if (stt) {
          td.className += ' free' + (stt === 2 ? ' opt' : '');
          td.appendChild(h('<div class="fl">' + (stt === 2 ? '~ boş' : 'boş') + '</div>'));
          td.title = (mode === 'sinif' ? cname(rw.id) : tname(rw.id)) + ' — ' + DN[d - 1] + ' ' + p +
            '. ders (' + E.timeLabel(state.settings, d, p) + ')\nBOŞ' +
            (stt === 2 ? '\n“Gelebilir” günü' + (isOptChosen ? ' — bu programda kullanılıyor' : ' — kullanılmıyor') : '');
        } else {
          td.className += ' off';
          if (single) td.appendChild(h('<div class="fl">saat dışı</div>'));
          td.title = (mode === 'sinif' ? cname(rw.id) : tname(rw.id)) + ' — ' + DN[d - 1] + ' ' + p +
            '. ders\nBu gün kurumda, ama bu saat sözleşme saatleri dışında.';
        }
        tr.appendChild(td);
      }
    });
    tbody.appendChild(tr);
  });
  t.appendChild(tbody);
  wrap.appendChild(t);
  return wrap;
}

/* ---------- tek sınıf / öğretmen: büyük haftalık program ---------- */
function detailCard(mode, id, big) {
  var card = el('div', 'card');
  card.id = 'detcard';
  var hd = el('h3');
  hd.appendChild(document.createTextNode((mode === 'sinif' ? '🏫 ' : '👩‍🏫 ') +
    (mode === 'sinif' ? cname(id) : tname(id)) + ' — haftalık program'));
  if (!big) {
    var sel = el('select');
    sel.style.marginLeft = '6px';
    (mode === 'sinif' ? state.classes : state.teachers).forEach(function (x) {
      var o = el('option', '', x.name); o.value = x.id;
      if (x.id === id) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () { ui.calDetail = sel.value; render(); };
    hd.appendChild(sel);
  }
  var bp = el('button', 'btn sm', '🖨 Yazdır');
  bp.title = 'Yalnızca bu haftalık programı yazdır';
  bp.style.marginLeft = 'auto';
  bp.onclick = function () { printOne(mode, id); };
  hd.appendChild(bp);
  var bx = el('button', 'btn sm', big ? '📊 Toplu ızgara' : '✕ Kapat');
  bx.style.marginLeft = '6px';
  bx.onclick = function () {
    if (big) ui.calView = 'grid'; else ui.calDetail = null;
    render();
  };
  hd.appendChild(bx);
  card.appendChild(hd);

  var days = activeDayList(), chosen = view.optionalDays || {};
  var ok = mode === 'sinif' ? view.maps.classOk[id] : view.maps.teachOk[id];
  var occ = {};
  view.cards.forEach(function (c) {
    if ((mode === 'sinif' ? c.classId : c.teacherId) === id) occ[c.day + '_' + c.period] = c;
  });

  // kurumda olunan / dersi bulunan günler — kolon aralığını bunlar belirler
  var shown = days.filter(function (d) {
    for (var p = 1; p <= P; p++) if (ok[E.si(d, p)] || occ[d + '_' + p]) return true;
    return false;
  });
  // tabloda tüm aktif günler yer alır; kurumda olunmayanlar kırmızı şerit olarak görünür
  var listed = days;
  if (!shown.length) {
    card.appendChild(h('<div class="empty">Bu kayıt hiçbir gün kurumda değil.</div>'));
    return card;
  }

  var wrap = el('div', 'dw');
  var t = el('table', 'det' + (big ? ' big' : ''));
  var thead = el('thead');
  var hr = el('tr');
  hr.appendChild(h('<th class="dh">Gün</th>'));
  // gösterilecek ders saati aralığı: kaydın fiilen kullandığı saatler
  var pFrom = P, pTo = 1;
  shown.forEach(function (d) {
    for (var p = 1; p <= P; p++) {
      if (ok[E.si(d, p)] || occ[d + '_' + p]) { pFrom = Math.min(pFrom, p); pTo = Math.max(pTo, p); }
    }
  });
  var refDay = shown[0];
  for (var p2 = pFrom; p2 <= pTo; p2++) {
    hr.appendChild(h('<th>' + p2 + '. ders<small>' +
      esc(E.timeLabel(state.settings, refDay, p2)) + '</small></th>'));
  }
  thead.appendChild(hr);
  t.appendChild(thead);

  var tbody = el('tbody');
  listed.forEach(function (d) {
    var tr = el('tr');
    var isOpt = mode === 'sinif' && (chosen[id] || []).indexOf(d) >= 0;
    var dOff = rowDayOff(mode, id, d);
    tr.appendChild(h('<td class="dh" title="' + esc(E.isWeekend(d) ? 'Hafta sonu' : 'Hafta içi') + '"' +
      (dOff ? ' style="background:var(--absent-soft);color:var(--absent)"' : '') + '>' +
      esc(DN[d - 1]) + (isOpt ? '<br><span style="font-size:9px;color:#8a6100">ek gün</span>' : '') + '</td>'));
    if (dOff) {
      var tdo = h('<td class="dc dayoff" colspan="' + (pTo - pFrom + 1) + '"><div class="fl">' +
        esc(dayOffWord(mode)) + ' — bu gün kurumda değil, boş saati yok</div></td>');
      tdo.title = (mode === 'sinif' ? cname(id) : tname(id)) + ' — ' + DN[d - 1] + ': ' + dayOffWord(mode) +
        '\nSözleşmesinde bu gün yok; bu güne ders ya da etüt yazılamaz.';
      tr.appendChild(tdo);
      tbody.appendChild(tr);
      return;
    }
    for (var p = pFrom; p <= pTo; p++) {
      var td = el('td', 'dc');
      var c = occ[d + '_' + p], stt = ok[E.si(d, p)];
      var optHere = mode === 'sinif' && stt === 2 && isOpt;
      if (c) {
        var isEt = c.kind === 'etut';
        td.className += (isEt ? ' etut' : '') + (c.locked && !isEt ? ' locked' : '') + (optHere ? ' optday' : '');
        var z = el('div', 'z');
        if (!isEt) {
          z.style.background = tint(tcolor(c.teacherId), 0.28);
          z.style.borderLeftColor = tcolor(c.teacherId);
        }
        if (isEt) {
          z.appendChild(h('<span class="a">🎓 ETÜT</span>'));
          z.appendChild(h('<span class="b">' + esc(mode === 'sinif' ? tname(c.teacherId) : cname(c.classId)) + '</span>'));
          z.appendChild(h('<span class="c">' + esc(c.student || (c.subjectId ? sname(c.subjectId) : '—')) + '</span>'));
          z.style.cursor = 'default';
        } else {
          z.appendChild(h('<span class="a">' + esc(sname(c.subjectId)) + '</span>'));
          z.appendChild(h('<span class="b">' + esc(mode === 'sinif' ? tname(c.teacherId) : cname(c.classId)) + '</span>'));
          z.appendChild(h('<span class="c">' + esc(E.timeLabel(state.settings, d, p)) +
            (c.blockLen > 1 ? ' · blok ' + (c.blockPos + 1) + '/' + c.blockLen : '') + '</span>'));
          if (c.locked) z.appendChild(h('<span class="lk">🔒</span>'));
          (function (cc) { z.onclick = function () { toggleLock(cc); }; })(c);
          td.title = 'Tıkla: ' + (c.locked ? 'kilidi aç' : 'kilitle');
        }
        td.appendChild(z);
      } else if (!E.lessonBand(state.settings, d, p)) {
        td.className += ' nolesson';
        td.appendChild(h('<div class="fl">etüt arası<br>' +
          esc(E.timeLabel(state.settings, d, p)) + '</div>'));
      } else if (stt) {
        td.className += ' free' + (stt === 2 ? ' opt' : '');
        td.appendChild(h('<div class="fl">BOŞ<br>' + esc(E.timeLabel(state.settings, d, p)) + '</div>'));
      } else {
        td.className += ' off';
        td.appendChild(h('<div class="fl">saat dışı<br>' +
          esc(E.timeLabel(state.settings, d, p)) + '</div>'));
        td.title = 'Bu gün kurumda, ama bu saat sözleşme saatleri dışında.';
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  t.appendChild(tbody);
  wrap.appendChild(t);
  card.appendChild(wrap);

  // özet
  var mine = view.cards.filter(function (c) { return (mode === 'sinif' ? c.classId : c.teacherId) === id; });
  var nL = mine.filter(function (c) { return c.kind !== 'etut'; }).length;
  var nE = mine.length - nL;
  var cap = 0, nFree = 0;
  for (var s = 0; s < E.NSLOT; s++) {
    if (!ok[s]) continue;
    cap++;
    if (!occ[E.sd(s) + '_' + E.sp(s)]) nFree++;
  }
  var offDays = days.filter(function (d) { return rowDayOff(mode, id, d); });
  card.appendChild(h('<div class="hint" style="margin-top:9px"><b>' + nL + '</b> ders saati' +
    (nE ? ' · <b style="color:var(--etut)">' + nE + '</b> etüt' : '') +
    ' · kurumda <b>' + cap + '</b> saat · <b style="color:#1c6b48">' + nFree + '</b> boş saat' +
    (offDays.length ? ' · <b style="color:var(--absent)">' +
      esc(offDays.map(function (d) { return DN[d - 1]; }).join(', ')) + '</b> ' +
      esc(dayOffWord(mode).toLocaleLowerCase('tr')) : '') +
    (mode === 'sinif' && (chosen[id] || []).length
      ? ' · ek gün: <b>' + chosen[id].map(function (d) { return DN[d - 1]; }).join(', ') + '</b>' : '') +
    '</div>'));
  return card;
}

function fillAsc(td, card, mode, isOptChosen) {
  var isEtut = card.kind === 'etut';
  td.className += (isEtut ? ' etut' : '') + (card.locked && !isEtut ? ' locked' : '') + (isOptChosen ? ' optday' : '');
  var z = el('div', 'lz');
  if (!isEtut) {
    z.style.background = tint(tcolor(card.teacherId), 0.30);
    z.style.borderLeftColor = tcolor(card.teacherId);
  }
  z.appendChild(h('<span class="sj">' + esc(isEtut ? 'ETÜT' : sshort(card.subjectId)) + '</span>'));
  z.appendChild(h('<span class="tc">' + esc(mode === 'sinif' ? tshort(card.teacherId) : cname(card.classId)) + '</span>'));
  if (!isEtut && card.blockLen > 1) {
    z.appendChild(h('<span class="bp">' + (card.blockPos + 1) + '/' + card.blockLen + '</span>'));
  }
  if (card.locked && !isEtut) z.appendChild(h('<span class="lk">🔒</span>'));
  if (isEtut) {
    z.style.cursor = 'default';
    td.title = 'ETÜT / özel ders\n' + tname(card.teacherId) + '\n' + cname(card.classId) +
      (card.student ? '\nÖğrenci: ' + card.student : '') +
      (card.subjectId ? '\nDers: ' + sname(card.subjectId) : '') +
      (card.note ? '\nNot: ' + card.note : '');
  } else {
    td.title = sname(card.subjectId) + '\n' + cname(card.classId) + '\n' + tname(card.teacherId) +
      '\n' + card.blockLen + ' saatlik blok · ' + E.timeLabel(state.settings, card.day, card.period) +
      (isOptChosen ? '\n(“Gelebilir” gününe yerleşti)' : '') +
      '\n\nTıkla: ' + (card.locked ? 'kilidi aç' : 'kilitle');
    z.onclick = function () { toggleLock(card); };
  }
  td.appendChild(z);
}

function toggleLock(card) {
  var t = state.schedule.filter(function (c) {
    return c.lessonId === card.lessonId && c.day === card.day && c.period === card.period && c.classId === card.classId;
  })[0];
  if (!t) return;
  var same = state.schedule.filter(function (c) { return c.blockId && c.blockId === t.blockId; });
  var to = !t.locked;
  (same.length ? same : [t]).forEach(function (c) { c.locked = to; });
  logIt((to ? '🔒 Kilitlendi' : '🔓 Kilit açıldı') + ': ' + cname(t.classId) + ' · ' + sname(t.subjectId) +
        ' (' + DS[t.day - 1] + ' ' + t.period + '. saat)');
  refresh();
}

/* ============================================================
   🕳 ÖĞRETMEN BOŞLUKLARI (+ toplu müsaitlik matrisi)
   ============================================================ */
function viewBosluk(root) {
  root.appendChild(h('<div class="card soft"><h3>🕳 Öğretmen boş saatleri</h3><div class="hint">' +
    '<b>Ara boşluk</b> = öğretmenin o gündeki ilk ve son dersi arasında kalan boş saatler; öğretmen zaten ' +
    'kurumda olduğu için etüt açmak en verimli burada olur.<br><b>Uç boşluk</b> = günün başındaki/sonundaki, ' +
    'müsait ama dersi olmayan saatler.</div></div>'));

  var mc = el('div', 'card');
  var hd = el('h3');
  hd.appendChild(document.createTextNode('📋 Tüm öğretmenlerin müsait olduğu saatler'));
  var seg = el('div', 'seg'); seg.style.marginLeft = 'auto';
  [['durum', 'Ders / boşluk'], ['sadeceBos', 'Yalnız boş saatler']].forEach(function (m) {
    var b = el('button', ui.avmMode === m[0] ? 'on' : '', m[1]);
    b.onclick = function () { ui.avmMode = m[0]; render(); };
    seg.appendChild(b);
  });
  hd.appendChild(seg);
  mc.appendChild(hd);
  mc.appendChild(h('<div class="legend" style="margin-bottom:9px">' +
    '<span><i style="background:#cfe0f5"></i>Ders</span>' +
    '<span><i style="background:#a8e3c4"></i>Ara boşluk</span>' +
    '<span><i style="background:#e0f5ea"></i>Uç boşluk</span>' +
    '<span><i style="background:#ffe3ad"></i>Etüt</span>' +
    '<span><i style="background:#eef2f6"></i>Kurumda değil</span>' +
    '<span>Alt satır: o saatte <b>boş öğretmen sayısı</b></span></div>'));
  mc.appendChild(availMatrix());
  var top = [];
  for (var s = 0; s < E.NSLOT; s++) top.push({ s: s, n: view.freeBy.count[s] });
  top.sort(function (a, b) { return b.n - a.n; });
  mc.appendChild(h('<div class="hint" style="margin-top:9px">En çok öğretmenin boş olduğu saatler: ' +
    top.slice(0, 6).filter(function (x) { return x.n; }).map(function (x) {
      return '<b>' + esc(DS[E.sd(x.s) - 1]) + ' ' + E.sp(x.s) + '. ders</b> (' + x.n + ' öğretmen)';
    }).join(' · ') + '</div>'));
  root.appendChild(mc);

  var rows = state.teachers.map(function (t) {
    return { t: t, g: view.gaps[t.id], etut: E.etutCapacity(state, view.maps, view.cards, t.id).length };
  }).sort(function (a, b) { return b.g.inner - a.g.inner || b.g.free - a.g.free; });

  var card = el('div', 'card');
  card.appendChild(h('<h3>Boş saat tablosu <span class="hint" style="font-weight:400">' +
    '(ara boşluğa göre sıralı — satıra tıklayın)</span></h3>'));
  var sc = el('div', 'scroll'); sc.style.maxHeight = '340px';
  var tb = el('table');
  tb.appendChild(h('<thead><tr><th class="rowhead">Öğretmen</th><th class="num">Ders</th><th class="num">Müsait</th>' +
    '<th class="num">Ara boşluk</th><th class="num">Uç boşluk</th>' +
    '<th class="num" title="Etüt penceresinde uygun boş saat">Etüt slotu</th>' +
    '<th style="width:120px">Doluluk</th><th>Günlere göre boş saat</th></tr></thead>'));
  var body = el('tbody');
  rows.forEach(function (r) {
    var capH = r.g.busy + r.g.free;
    var pct = capH ? Math.round(r.g.busy / capH * 100) : 0;
    var per = activeDayList().map(function (d) {
      var dd = r.g.days[d], f = dd.inner + dd.edge;
      return f ? DS[d - 1] + ':' + f + (dd.inner ? '<b style="color:#1c6b48"> (' + dd.inner + ' ara)</b>' : '') : '';
    }).filter(Boolean).join(' · ') || '<span style="color:var(--muted)">—</span>';
    var tr = h('<tr style="cursor:pointer"><td class="rowhead">' + esc(r.t.name) + '</td>' +
      '<td class="num">' + r.g.busy + '</td><td class="num">' + capH + '</td>' +
      '<td class="num"><b style="color:#1c6b48">' + r.g.inner + '</b></td><td class="num">' + r.g.edge + '</td>' +
      '<td class="num">' + (r.etut ? '<b>' + r.etut + '</b>' : '0') + '</td>' +
      '<td><div class="bars" title="' + pct + '%"><i style="width:' + pct + '%"></i></div></td>' +
      '<td style="font-size:12px">' + per + '</td></tr>');
    tr.onclick = function () {
      ui.gapSel = r.t.id; render();
      var g = document.getElementById('gapmap');
      if (g) g.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    body.appendChild(tr);
  });
  tb.appendChild(body); sc.appendChild(tb); card.appendChild(sc); root.appendChild(card);

  if (!ui.gapSel || !TE[ui.gapSel]) ui.gapSel = rows.length ? rows[0].t.id : null;
  var mapCard = el('div', 'card'); mapCard.id = 'gapmap';
  var head = el('h3');
  head.appendChild(document.createTextNode('Saat saat boşluk haritası: '));
  var sel = el('select');
  state.teachers.forEach(function (t) {
    var o = el('option', '', t.name); o.value = t.id;
    if (t.id === ui.gapSel) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = function () { ui.gapSel = sel.value; render(); };
  head.appendChild(sel);
  mapCard.appendChild(head);
  if (ui.gapSel) mapCard.appendChild(gapMap(ui.gapSel));
  root.appendChild(mapCard);
}

function availMatrix() {
  var days = activeDayList(), etutAt = {};
  view.cards.forEach(function (c) { if (c.kind === 'etut') etutAt[c.teacherId + '_' + E.si(c.day, c.period)] = 1; });
  var wrap = el('div', 'ascwrap'); wrap.style.maxHeight = '52vh';
  var t = el('table', 'avm');
  var thead = el('thead');
  var r1 = el('tr');
  r1.appendChild(h('<th class="corner" rowspan="2">Öğretmen (' + state.teachers.length + ')</th>'));
  days.forEach(function (d) { r1.appendChild(h('<th colspan="' + P + '" class="dayend">' + esc(DS[d - 1]) + '</th>')); });
  thead.appendChild(r1);
  var r2 = el('tr');
  days.forEach(function (d) {
    for (var p = 1; p <= P; p++) {
      r2.appendChild(h('<th class="' + (p === P ? 'dayend' : '') + '" title="' +
        esc(DN[d - 1] + ' ' + p + '. ders · ' + E.timeLabel(state.settings, d, p)) + '">' + p + '</th>'));
    }
  });
  thead.appendChild(r2);
  t.appendChild(thead);

  var tbody = el('tbody');
  state.teachers.forEach(function (tc) {
    var g = view.gaps[tc.id], tr = el('tr');
    tr.appendChild(h('<td class="rh" title="' + esc(tc.name) + '">' + esc(tc.name) + '</td>'));
    days.forEach(function (d) {
      for (var p = 1; p <= P; p++) {
        var it = g.days[d].row[p - 1];
        var kind = etutAt[tc.id + '_' + E.si(d, p)] ? 'etut' : it.kind;
        var shown = kind;
        if (ui.avmMode === 'sadeceBos' && (kind === 'busy' || kind === 'etut')) shown = 'off';
        var td = el('td', 's ' + shown + (p === P ? ' dayend' : ''));
        if (shown === 'inner' || shown === 'edge') td.textContent = '●';
        else if (shown === 'etut') td.textContent = '🎓';
        td.title = tc.name + '\n' + DN[d - 1] + ' ' + p + '. ders (' + E.timeLabel(state.settings, d, p) + ')\n' +
          (kind === 'busy' ? sname((it.card || {}).subjectId) + ' — ' + cname((it.card || {}).classId)
            : kind === 'etut' ? 'Etüt / özel ders'
            : kind === 'inner' ? 'ARA BOŞLUK — etüt için uygun'
            : kind === 'edge' ? 'Uç boşluk' : 'Kurumda değil');
        tr.appendChild(td);
      }
    });
    tbody.appendChild(tr);
  });
  t.appendChild(tbody);

  var tfoot = el('tfoot');
  var fr = el('tr');
  fr.appendChild(h('<td class="rh">Boş öğretmen sayısı</td>'));
  var mx = 0;
  for (var s2 = 0; s2 < E.NSLOT; s2++) mx = Math.max(mx, view.freeBy.count[s2]);
  days.forEach(function (d) {
    for (var p = 1; p <= P; p++) {
      var n = view.freeBy.count[E.si(d, p)];
      fr.appendChild(h('<td class="cnt' + (mx && n >= mx * 0.75 && n > 0 ? ' hi' : '') +
        (p === P ? ' dayend' : '') + '" title="' + esc(DN[d - 1] + ' ' + p + '. ders') + ' — ' + n +
        ' öğretmen boş">' + (n || '') + '</td>'));
    }
  });
  tfoot.appendChild(fr);
  t.appendChild(tfoot);
  wrap.appendChild(t);
  return wrap;
}

function gapMap(tid) {
  var g = view.gaps[tid], days = activeDayList(), occE = {};
  view.cards.forEach(function (c) { if (c.teacherId === tid && c.kind === 'etut') occE[c.day + '_' + c.period] = 1; });
  var wrap = el('div', 'scroll'); wrap.style.padding = '8px';
  var m = el('div', 'map');
  m.style.gridTemplateColumns = '58px repeat(' + P + ',minmax(52px,1fr)) 92px';
  m.appendChild(el('div'));
  for (var p = 1; p <= P; p++) {
    m.appendChild(h('<div class="mlab"><b>' + p + '</b><br>' +
      esc(E.timeLabel(state.settings, days[0] || 6, p)).replace('-', '<br>') + '</div>'));
  }
  m.appendChild(h('<div class="mlab"><b>boş</b></div>'));
  days.forEach(function (d) {
    m.appendChild(h('<div class="mrow">' + esc(DS[d - 1]) + '</div>'));
    var row = g.days[d];
    for (var p2 = 1; p2 <= P; p2++) {
      var it = row.row[p2 - 1], k = occE[d + '_' + p2] ? 'etut' : it.kind;
      var lbl = k === 'busy' ? sshort((it.card || {}).subjectId) : k === 'etut' ? '🎓' : k === 'off' ? '' : '●';
      var c = h('<div class="mc ' + k + '">' + esc(lbl || '') + '</div>');
      c.title = DN[d - 1] + ' ' + p2 + '. ders (' + E.timeLabel(state.settings, d, p2) + ')\n' +
        (k === 'busy' ? sname((it.card || {}).subjectId) + ' — ' + cname((it.card || {}).classId)
          : k === 'etut' ? 'Etüt / özel ders'
          : k === 'inner' ? 'ARA BOŞLUK — etüt için uygun' : k === 'edge' ? 'Uç boşluk' : 'Kurumda değil');
      m.appendChild(c);
    }
    m.appendChild(h('<div class="mlab" style="text-align:left;padding-left:6px">' +
      (row.inner ? '<b style="color:#1c6b48">' + row.inner + ' ara</b>' : '') +
      (row.inner && row.edge ? ' · ' : '') + (row.edge ? row.edge + ' uç' : '') +
      (!row.inner && !row.edge ? '<span style="color:#b8c6d4">—</span>' : '') + '</div>'));
  });
  wrap.appendChild(m);
  var box = el('div');
  box.appendChild(wrap);
  box.appendChild(h('<div class="hint" style="margin-top:9px">Toplam: <b>' + g.busy + '</b> saat ders · ' +
    '<b style="color:#1c6b48">' + g.inner + '</b> saat ara boşluk · <b>' + g.edge + '</b> saat uç boşluk ' +
    '(müsait toplam ' + (g.busy + g.free) + ' saat)</div>'));
  return box;
}

/* ============================================================
   🎓 ETÜT PANELİ
   ============================================================ */
function viewEtut(root) {
  var w = state.settings.etutWindow;
  root.appendChild(h('<div class="card soft"><h3>🎓 Etüt / özel ders planlama</h3><div class="hint">' +
    'Uygun saat için: <b>öğretmen kurumda</b> + <b>öğretmenin dersi yok</b> + ' +
    '<b>öğrencinin sınıfının dersi yok</b> + saat <b>etüt penceresi</b> içinde.<br>' +
    'Pencere — hafta içi <b>' + w.weekday.from + '-' + w.weekday.to + '. ders (' +
    esc(E.timeLabel(state.settings, 1, w.weekday.from)) + ' ve sonrası)</b>, öğrenciler kendi okullarından ' +
    'sonra gelebilsin; hafta sonu <b>' + w.weekend.from + '-' + w.weekend.to + '. ders</b>. ' +
    '⚙️ Kurum Ayarları\'ndan değiştirilir.</div></div>'));

  if (!ui.etutT || !TE[ui.etutT]) ui.etutT = state.teachers.length ? state.teachers[0].id : null;
  if (!ui.etutT) { root.appendChild(h('<div class="empty">Öğretmen yok.</div>')); return; }

  var bar = el('div', 'bar');
  var lt = el('label'); lt.appendChild(document.createTextNode('Öğretmen'));
  var st = el('select');
  state.teachers.forEach(function (t) {
    var n = E.etutCapacity(state, view.maps, view.cards, t.id).length;
    var o = el('option', '', t.name + '  —  ' + n + ' boş slot');
    o.value = t.id;
    if (t.id === ui.etutT) o.selected = true;
    st.appendChild(o);
  });
  st.onchange = function () { ui.etutT = st.value; ui.etutC = null; render(); };
  lt.appendChild(st); bar.appendChild(lt);
  root.appendChild(bar);

  var myClasses = E.teacherClasses(state, ui.etutT);
  var cc = el('div', 'card');
  cc.appendChild(h('<h3>' + esc(tname(ui.etutT)) + ' — girdiği sınıflar <span class="chip">' +
    myClasses.length + '</span></h3>'));
  if (!myClasses.length) {
    cc.appendChild(h('<div class="hint">Bu öğretmene atanmış ders yok. 👩‍🏫 Öğretmenler sekmesinden ders ekleyin.</div>'));
    root.appendChild(cc);
    etutList(root);
    return;
  }
  if (!ui.etutC || !myClasses.some(function (x) { return x.classId === ui.etutC; })) ui.etutC = myClasses[0].classId;
  var ch = el('div', 'chips');
  myClasses.forEach(function (x) {
    var b = el('button', 'chip' + (x.classId === ui.etutC ? ' on' : ''));
    b.innerHTML = '<b>' + esc(cname(x.classId)) + '</b> <span style="opacity:.75">· ' +
      esc(x.subjectIds.map(sshort).join(', ')) + '</span>';
    b.title = cname(x.classId) + ' — ' + x.subjectIds.map(sname).join(', ');
    b.onclick = function () { ui.etutC = x.classId; render(); };
    ch.appendChild(b);
  });
  cc.appendChild(ch);
  cc.appendChild(h('<div class="hint" style="margin-top:8px">Etüt talebinde bulunan öğrencinin sınıfını seçin. ' +
    'Yalnızca bu öğretmenin ders verdiği sınıflar listelenir.</div>'));
  root.appendChild(cc);

  var bar2 = el('div', 'bar');
  var ls = el('label'); ls.appendChild(document.createTextNode('Etüt talep eden öğrenci'));
  var si2 = el('input'); si2.type = 'text'; si2.placeholder = 'örn. Ali Yılmaz'; si2.value = ui.etutS;
  si2.style.minWidth = '200px';
  si2.oninput = function () { ui.etutS = si2.value; };
  ls.appendChild(si2); bar2.appendChild(ls);
  var lsub = el('label'); lsub.appendChild(document.createTextNode('Ders'));
  var ssub = el('select');
  var mySubs = (myClasses.filter(function (x) { return x.classId === ui.etutC; })[0] || {}).subjectIds || [];
  mySubs.forEach(function (sid) { var o = el('option', '', sname(sid)); o.value = sid; ssub.appendChild(o); });
  lsub.appendChild(ssub); bar2.appendChild(lsub);
  root.appendChild(bar2);

  var slots = E.etutSlots(state, view.maps, view.cards, ui.etutT, ui.etutC);
  var card = el('div', 'card');
  card.appendChild(h('<h3>Uygun saatler — ' + esc(tname(ui.etutT)) + ' × ' + esc(cname(ui.etutC)) +
    ' <span class="chip' + (slots.length ? ' on' : '') + '">' + slots.length + ' saat</span></h3>'));
  if (!slots.length) {
    card.appendChild(h('<div class="empty" style="text-align:left">' + esc(whyNoEtut(ui.etutT, ui.etutC)) + '</div>'));
  } else {
    var byDay = {};
    slots.forEach(function (s) { (byDay[s.day] ??= []).push(s); });
    activeDayList().forEach(function (d) {
      if (!byDay[d]) return;
      var row = el('div'); row.style.marginBottom = '10px';
      row.appendChild(h('<div style="font-weight:650;color:var(--accent2);margin-bottom:5px">' +
        esc(DN[d - 1]) + '</div>'));
      var ch2 = el('div', 'chips');
      byDay[d].forEach(function (s) {
        var inner = s.gapKind === 'inner';
        var b = el('button', 'btn sm');
        b.style.borderColor = inner ? '#8fcfae' : 'var(--line2)';
        b.style.background = inner ? '#e4f6ed' : 'var(--surface)';
        b.innerHTML = '<b>' + s.period + '. ders</b> ' + esc(s.time) +
          (inner ? ' <span style="color:#1c6b48">· ara boşluk</span>'
                 : ' <span style="color:var(--muted)">· uç boşluk</span>') +
          (s.classInSession ? ' <span style="color:var(--accent)">· sınıf okulda</span>'
                            : ' <span style="color:var(--warn)">· sınıf oturumu dışı</span>');
        b.title = (inner ? 'Öğretmen zaten kurumda (iki dersi arasında) — en verimli saat'
                         : 'Öğretmenin gün başı/sonu boş saati') +
          (s.classInSession ? '\nSınıf o saatte okulda' : '\nSınıfın oturumu değil — öğrenci özel gelir');
        b.onclick = function () { addEtut(ui.etutT, ui.etutC, s, ui.etutS, ssub.value); };
        ch2.appendChild(b);
      });
      row.appendChild(ch2);
      card.appendChild(row);
    });
    card.appendChild(h('<div class="hint" style="margin-top:8px">Saate tıklandığında etüt programa işlenir ve ' +
      '<b>kilitlenir</b>; yeniden oluşturmada yeri değişmez.</div>'));
  }
  root.appendChild(card);
  etutList(root);
}

function etutList(root) {
  var lc = el('div', 'card');
  lc.appendChild(h('<h3>Planlanmış etüt / özel dersler <span class="chip">' + state.etuts.length + '</span></h3>'));
  if (!state.etuts.length) {
    lc.appendChild(h('<div class="hint">Henüz etüt planlanmadı.</div>'));
    root.appendChild(lc);
    return;
  }
  var tb = el('table');
  tb.appendChild(h('<thead><tr><th>Gün</th><th>Saat</th><th>Öğretmen</th><th>Sınıf</th>' +
    '<th>Öğrenci</th><th>Ders</th><th>Not</th><th></th></tr></thead>'));
  var tbody = el('tbody');
  state.etuts.slice().sort(function (a, b) { return a.day - b.day || a.period - b.period; }).forEach(function (e) {
    var tr = el('tr');
    tr.appendChild(h('<td class="rowhead">' + esc(DN[e.day - 1]) + '</td>'));
    tr.appendChild(h('<td>' + e.period + '. ders · ' + esc(E.timeLabel(state.settings, e.day, e.period)) + '</td>'));
    tr.appendChild(h('<td>' + esc(tname(e.teacherId)) + '</td>'));
    tr.appendChild(h('<td>' + esc(cname(e.classId)) + '</td>'));
    var tds = el('td');
    var inpS = el('input'); inpS.type = 'text'; inpS.value = e.student || ''; inpS.placeholder = 'öğrenci…';
    inpS.style.maxWidth = '150px';
    inpS.onchange = function () { e.student = inpS.value; logIt('🎓 Etüt öğrencisi güncellendi'); save(); };
    tds.appendChild(inpS); tr.appendChild(tds);
    tr.appendChild(h('<td>' + esc(e.subjectId ? sname(e.subjectId) : '—') + '</td>'));
    var tdn = el('td');
    var inp = el('input'); inp.type = 'text'; inp.value = e.note || ''; inp.placeholder = 'not…';
    inp.style.maxWidth = '170px';
    inp.onchange = function () { e.note = inp.value; save(); };
    tdn.appendChild(inp); tr.appendChild(tdn);
    var tdx = el('td');
    var bx = el('button', 'btn sm danger', '✕ Sil');
    bx.onclick = function () {
      state.etuts = state.etuts.filter(function (x) { return x.id !== e.id; });
      logIt('🎓 Etüt silindi: ' + tname(e.teacherId) + ' × ' + cname(e.classId) +
            ' (' + DS[e.day - 1] + ' ' + e.period + '. saat)');
      refresh();
    };
    tdx.appendChild(bx); tr.appendChild(tdx);
    tbody.appendChild(tr);
  });
  tb.appendChild(tbody);
  var sc = el('div', 'scroll'); sc.appendChild(tb); lc.appendChild(sc);
  root.appendChild(lc);
}

function whyNoEtut(tid, cid) {
  var w = state.settings.etutWindow, maps = view.maps, st = state.settings;
  var inWin = 0, tOk = 0, tFree = 0, occT = {}, occC = {};
  view.cards.forEach(function (c) {
    if (c.teacherId === tid) occT[E.si(c.day, c.period)] = 1;
    if (c.classId === cid) occC[E.si(c.day, c.period)] = 1;
  });
  for (var d = 1; d <= 7; d++) {
    if (!st.activeDays[d - 1]) continue;
    for (var p = 1; p <= P; p++) {
      if (!E.inEtutWindow(st, d, p)) continue;
      inWin++;
      var s = E.si(d, p);
      if (!maps.teachOk[tid][s]) continue;
      tOk++;
      if (occT[s]) continue;
      tFree++;
    }
  }
  if (!inWin) return 'Etüt penceresi hiç saat içermiyor. Ne yapmalı: ⚙️ Kurum Ayarları → Etüt penceresini genişletin.';
  if (!tOk) return tname(tid) + ' etüt penceresindeki ' + inWin + ' saatin hiçbirinde kurumda değil. ' +
    'Ne yapmalı: 👩‍🏫 Öğretmenler sekmesinde hafta içi ' + w.weekday.from + '-' + w.weekday.to +
    '. ders arası (' + E.timeLabel(st, 1, w.weekday.from) + ' sonrası) müsaitlik işaretleyin.';
  if (!tFree) return tname(tid) + ' etüt penceresinde kurumda olduğu ' + tOk + ' saatin tamamında ders veriyor. ' +
    'Ne yapmalı: müsaitliğini genişletin ya da 📅 Takvim\'den bazı derslerin kilidini açıp yeniden oluşturun.';
  return cname(cid) + ' sınıfının, öğretmenin boş olduğu ' + tFree + ' saatin tamamında dersi var. ' +
    'Ne yapmalı: başka bir sınıf/öğretmen seçin ya da 🔄 Yeniden Oluştur ile farklı bir dizilim deneyin.';
}

function addEtut(tid, cid, slot, student, subjectId) {
  state.etuts.push({
    id: 'E' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    teacherId: tid, classId: cid, day: slot.day, period: slot.period,
    student: (student || '').trim(), subjectId: subjectId || null, note: ''
  });
  logIt('🎓 Etüt eklendi: ' + tname(tid) + ' × ' + cname(cid) + (student ? ' (' + student + ')' : '') +
        ' — ' + DS[slot.day - 1] + ' ' + slot.period + '. saat');
  toast('Etüt eklendi ve kilitlendi: ' + DS[slot.day - 1] + ' ' + slot.period + '. ders', 'ok');
  ui.etutS = '';
  refresh();
}

/* ============================================================
   🏫 SINIFLAR
   ============================================================ */
function viewSinif(root) {
  root.appendChild(h('<div class="card soft"><h3>🏫 Sınıfların kurumda olduğu gün ve oturumlar</h3><div class="hint">' +
    'Üstteki düğme günün durumunu değiştirir: <b>✕ Gelmiyor</b> → <b>✓ Geliyor</b> → <b>~ Gelebilir</b>.<br>' +
    '<b>Geliyor</b> = sınıf o gün kesin gelir. <b>Gelebilir</b> = program gerekirse kullanır; hangi günün ' +
    'kullanılacağını <b>çözücü seçer</b> (o dersi veren öğretmenin en müsait olduğu gün) ve paralel şubeleri ' +
    'ayrı günlere dağıtır. Sarı çerçeveli “Gelebilir” günler bu programda fiilen kullanılanlardır.<br>' +
    'Alttaki küçük düğmeler oturumu belirler (hafta içi <b>S</b>=sabah 1-6, <b>A</b>=akşam 10-12 · ' +
    'hafta sonu <b>S</b>=sabah 1-6, <b>Ö</b>=öğleden sonra 7-12).</div></div>'));

  var days = activeDayList(), chosen = view.optionalDays || {};
  var card = el('div', 'card');
  var sc = el('div', 'scroll'); sc.style.maxHeight = '56vh';
  var tb = el('table');
  var hr = '<thead><tr><th class="rowhead">Sınıf</th>';
  days.forEach(function (d) { hr += '<th style="text-align:center">' + esc(DS[d - 1]) + '</th>'; });
  hr += '<th class="num">Yük</th><th class="num">Yer</th><th style="width:110px">Doluluk</th></tr></thead>';
  tb.appendChild(h(hr));
  var body = el('tbody');
  var loadC = E.classLoad(state);

  state.classes.forEach(function (c) {
    var tr = el('tr');
    var th = h('<td class="rowhead" style="cursor:pointer" title="Derslerini görmek için tıkla">' +
      esc(c.name) + '</td>');
    th.onclick = function () {
      ui.clsSel = c.id; render();
      var t2 = document.getElementById('clslessons');
      if (t2) t2.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    tr.appendChild(th);
    days.forEach(function (d) {
      var td = el('td'); td.style.textAlign = 'center';
      var box = el('div', 'cd');
      var stt = state.classDays[c.id][d - 1] | 0;
      var isChosen = stt === 2 && (chosen[c.id] || []).indexOf(d) >= 0;
      var b = el('button', 'st s' + stt + (isChosen ? ' chosen' : ''),
        stt === 0 ? '✕ Gelmiyor' : stt === 1 ? '✓ Geliyor' : (isChosen ? '~ Gelebilir ✓' : '~ Gelebilir'));
      b.title = isChosen ? 'Bu programda kullanılıyor — tıkla: durumu değiştir' : 'Tıkla: durumu değiştir';
      b.onclick = function () {
        var nx = (stt + 1) % 3;
        state.classDays[c.id][d - 1] = nx;
        if (nx > 0 && !anyBand(c.id, d)) {
          setBand(c.id, d, E.bandsOf(state.settings, d).filter(function (x) { return !x.noLesson; })[0], true);
        }
        logIt('🏫 ' + c.name + ' · ' + DS[d - 1] + ' → ' + ['Gelmiyor', 'Geliyor', 'Gelebilir'][nx]);
        refresh();
      };
      box.appendChild(b);
      var brow = el('div', 'bandrow');
      E.bandsOf(state.settings, d).forEach(function (bd) {
        if (bd.noLesson) return;
        var on = bandOn(c.id, d, bd);
        var bb = el('button', 'bt' + (on ? ' on' : ''), bd.id === 'sabah' ? 'S' : bd.id === 'ogleden' ? 'Ö' : 'A');
        bb.title = bd.label + ' (' + bd.from + '-' + bd.to + '. ders)';
        bb.disabled = stt === 0;
        bb.onclick = function () {
          setBand(c.id, d, bd, !on);
          logIt('🏫 ' + c.name + ' · ' + DS[d - 1] + ' ' + bd.label + (!on ? ' açıldı' : ' kapatıldı'));
          refresh();
        };
        brow.appendChild(bb);
      });
      box.appendChild(brow);
      td.appendChild(box); tr.appendChild(td);
    });
    var cap = E.classCapacity(state, view.baseMaps, c.id), L = loadC[c.id] || 0;
    var pct = cap.total ? Math.min(100, Math.round(L / cap.total * 100)) : 0;
    tr.appendChild(h('<td class="num">' + L + '</td>'));
    tr.appendChild(h('<td class="num" title="kesin günler ' + cap.mandatory + ' saat + kullanılabilir ' +
      '“Gelebilir” ' + cap.optional + ' saat">' + cap.total + '</td>'));
    tr.appendChild(h('<td><div class="bars" title="' + L + '/' + cap.total + '"><i class="' +
      (L > cap.total ? 'over' : L === cap.total ? 'full' : '') + '" style="width:' + pct + '%"></i></div>' +
      (L > cap.total ? '<span style="font-size:11px;color:var(--err)">' + (L - cap.total) + ' saat fazla</span>' : '') +
      '</td>'));
    body.appendChild(tr);
  });
  tb.appendChild(body); sc.appendChild(tb); card.appendChild(sc); root.appendChild(card);

  if (!ui.clsSel || !CL[ui.clsSel]) ui.clsSel = state.classes.length ? state.classes[0].id : null;
  var lc = el('div', 'card'); lc.id = 'clslessons';
  var hd = el('h3');
  hd.appendChild(document.createTextNode('Sınıfın aldığı dersler: '));
  var sel = el('select');
  state.classes.forEach(function (c) {
    var o = el('option', '', c.name); o.value = c.id;
    if (c.id === ui.clsSel) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = function () { ui.clsSel = sel.value; render(); };
  hd.appendChild(sel);
  lc.appendChild(hd);
  if (ui.clsSel) lc.appendChild(lessonTable('class', ui.clsSel));
  root.appendChild(lc);

  root.appendChild(groupCard());
  root.appendChild(seedNoteCard('class',
    'Örnek veri üretilirken <code>sınıfların_geldiği_günler.md</code> ile <code>ders programı.xml</code> ' +
    'arasındaki farklardan doğan varsayımlar:'));
}

function groupCard() {
  var card = el('div', 'card');
  var nDiff = view.groups.reduce(function (a, g) { return a + g.diffs.length; }, 0);
  card.appendChild(h('<h3>👥 Paralel şube grupları <span class="chip">' + view.groups.length + ' grup</span>' +
    (nDiff ? '<span class="chip" style="background:var(--warn-soft);border-color:#eddba5;color:#8a6100">' +
      nDiff + ' ders farkı</span>'
    : '<span class="chip" style="background:var(--ok-soft);border-color:#b6e2cc;color:#1c6b48">tutarlı</span>') +
    '</h3>'));
  card.appendChild(h('<div class="hint">Gruplar, sınıfların <b>ders kümelerine</b> bakılarak otomatik bulunur ' +
    '(aynı seviyede benzerliği ≥%60 olanlar aynı alan sayılır). Böylece sayısal ve sözel şubeler karışmaz. ' +
    'Aynı gruptaki sınıflar aynı dersleri aynı saat sayısıyla almalıdır.</div>'));
  if (!view.groups.length) {
    card.appendChild(h('<div class="hint" style="margin-top:8px">Grup bulunamadı.</div>'));
    return card;
  }
  var tb = el('table');
  tb.appendChild(h('<thead><tr><th class="rowhead">Grup</th><th>Sınıflar</th><th class="num">Ders</th>' +
    '<th>Durum</th><th></th></tr></thead>'));
  var body = el('tbody');
  view.groups.forEach(function (g) {
    var tr = el('tr');
    tr.appendChild(h('<td class="rowhead">' + esc(g.name) + '</td>'));
    tr.appendChild(h('<td>' + esc(g.classIds.map(cname).join(', ')) + '</td>'));
    tr.appendChild(h('<td class="num">' + g.subjects.length + '</td>'));
    if (!g.diffs.length) {
      tr.appendChild(h('<td><span style="color:#1c6b48">✓ tüm şubeler aynı dersleri alıyor</span></td>'));
      tr.appendChild(el('td'));
    } else {
      tr.appendChild(h('<td><span style="color:#8a6100">⚠ ' + esc(g.diffs.map(function (d) {
        return cname(d.classId) + ' · ' + sshort(d.subjectId) + ' ' + d.hours + '≠' + d.expected;
      }).join(' · ')) + '</span></td>'));
      var td = el('td');
      var b = el('button', 'btn sm go', 'Eşitle');
      b.onclick = function () { equalizeGroup(g.name); };
      td.appendChild(b); tr.appendChild(td);
    }
    body.appendChild(tr);
  });
  tb.appendChild(body);
  var sc = el('div', 'scroll'); sc.appendChild(tb); card.appendChild(sc);
  return card;
}

function seedNoteCard(kind, intro) {
  var notes = (SEED.seedNotes || []).filter(function (n) { return n && n.kind === kind; });
  if (!notes.length) return el('div');
  var nc = el('div', 'card soft');
  nc.appendChild(h('<h3>📄 Kaynak dosya notları <span class="chip">' + notes.length + '</span></h3>'));
  nc.appendChild(h('<div class="hint">' + intro + '</div>'));
  var ul = el('ul'); ul.style.fontSize = '12px'; ul.style.margin = '8px 0 0 18px';
  notes.forEach(function (n) { ul.appendChild(el('li', '', n.m)); });
  nc.appendChild(ul);
  return nc;
}

/* ---------- sınıfın geliş saatleri ----------
   classBaseSlots : sınıfın GELDİĞİ OTURUMLAR (kurumun kararı, kullanıcı düzenler)
   classSlots     : o anki programda sınıfın FİİLEN kurumda olduğu saatler
   Üretimden önce oturumlar bütün hâlinde açılır (çözücü serbest kalsın),
   üretimden sonra yalnız ders görülen saatlere daraltılır → sınıfın boş dersi kalmaz. */
function baseSlots() {
  if (!state.classBaseSlots) state.classBaseSlots = JSON.parse(JSON.stringify(state.classSlots));
  return state.classBaseSlots;
}
function bandOn(cid, d, bd) {
  var bs = baseSlots(), s = bs[cid] && bs[cid][d];
  if (!s) return false;
  for (var p = bd.from; p <= bd.to; p++) if (s.charAt(p - 1) === '1') return true;
  return false;
}
function anyBand(cid, d) {
  return E.bandsOf(state.settings, d).some(function (b) { return !b.noLesson && bandOn(cid, d, b); });
}
function setBand(cid, d, bd, on) {
  var bs = baseSlots();
  [bs, state.classSlots].forEach(function (tgt) {
    tgt[cid] = tgt[cid] || {};
    var cur = tgt[cid][d] || '', arr = [];
    for (var i = 0; i < P; i++) arr.push(cur.charAt(i) === '1' ? '1' : '0');
    for (var p = bd.from; p <= bd.to; p++) arr[p - 1] = on ? '1' : '0';
    tgt[cid][d] = arr.join('');
  });
}
/** Üretim öncesi: sınıfların geldiği oturumları bütün hâlinde aç */
function expandClassSlots() {
  var st = state.settings, bs = baseSlots();
  state.classes.forEach(function (c) {
    var base = bs[c.id] || (bs[c.id] = {});
    var out = state.classSlots[c.id] = {};
    for (var d = 1; d <= 7; d++) {
      var arr = [], i;
      for (i = 0; i < P; i++) arr.push('0');
      E.bandsOf(st, d).forEach(function (bd) {
        if (bd.noLesson) return;
        var on = false, p, cur = base[d] || '';
        for (p = bd.from; p <= bd.to; p++) if (cur.charAt(p - 1) === '1') on = true;
        if (!on) return;
        for (p = bd.from; p <= bd.to; p++) if (E.lessonBand(st, d, p)) arr[p - 1] = '1';
      });
      out[d] = arr.join('');
    }
  });
}
/** Üretim sonrası: sınıf yalnız fiilen dersi/etüdü olan saatlerde kurumda sayılır */
function trimClassSlots() {
  var used = {};
  state.schedule.forEach(function (c) { (used[c.classId] ??= {})[c.day + ':' + c.period] = 1; });
  (state.etuts || []).forEach(function (e) { (used[e.classId] ??= {})[e.day + ':' + e.period] = 1; });
  state.classes.forEach(function (c) {
    var u = used[c.id] || {}, out = state.classSlots[c.id] = {};
    for (var d = 1; d <= 7; d++) {
      var s = '';
      for (var p = 1; p <= P; p++) s += u[d + ':' + p] ? '1' : '0';
      out[d] = s;
    }
  });
}

/* ---------- ders tablosu ---------- */
function lessonTable(mode, id) {
  var rows = mode === 'class' ? lessonsOfClass(id) : lessonsOfTeacher(id);
  var placed = {};
  state.schedule.forEach(function (c) { placed[c.lessonId] = (placed[c.lessonId] || 0) + 1; });
  var box = el('div');
  var tot = rows.reduce(function (s, l) { return s + l.hours; }, 0);
  box.appendChild(h('<div class="hint" style="margin-bottom:8px"><b>' + rows.length + '</b> ders satırı · ' +
    '<b>' + tot + '</b> saat/hafta' +
    (mode === 'class' ? ' (yer: ' + E.classCapacity(state, view.baseMaps, id).total + ' saat)' : '') + '</div>'));
  var tb = el('table');
  tb.appendChild(h('<thead><tr>' +
    (mode === 'class' ? '<th>Ders</th><th>Öğretmen</th>' : '<th>Sınıf</th><th>Ders</th>') +
    '<th class="num">Saat</th><th>Blok</th><th class="num">Yerleşen</th><th></th></tr></thead>'));
  var body = el('tbody');
  rows.forEach(function (L) {
    var tr = el('tr');
    if (mode === 'class') {
      tr.appendChild(mkSel(state.subjects, L.subjectId, function (v) {
        L.subjectId = v; logIt('📚 ' + cname(L.classId) + ': ders değişti'); refresh();
      }));
      tr.appendChild(mkSel(state.teachers, L.teacherId, function (v) {
        L.teacherId = v; logIt('📚 ' + cname(L.classId) + ': öğretmen değişti'); refresh();
      }));
    } else {
      tr.appendChild(mkSel(state.classes, L.classId, function (v) {
        L.classId = v; logIt('📚 ' + tname(L.teacherId) + ': sınıf değişti'); refresh();
      }));
      tr.appendChild(mkSel(state.subjects, L.subjectId, function (v) {
        L.subjectId = v; logIt('📚 ' + tname(L.teacherId) + ': ders değişti'); refresh();
      }));
    }
    var tdh = el('td', 'num');
    var inp = el('input'); inp.type = 'number'; inp.min = '0'; inp.max = '20'; inp.value = L.hours;
    inp.style.width = '58px';
    inp.onchange = function () {
      L.hours = Math.max(0, Math.min(20, +inp.value || 0));
      logIt('📚 ' + cname(L.classId) + ' · ' + sname(L.subjectId) + ' → ' + L.hours + ' saat');
      refresh();
    };
    tdh.appendChild(inp); tr.appendChild(tdh);
    tr.appendChild(h('<td>' + E.splitBlocks(L.hours, state.settings.preferredBlock, state.settings.maxBlock).join('+') + '</td>'));
    var got = placed[L.id] || 0;
    tr.appendChild(h('<td class="num">' + (got === L.hours
      ? '<span style="color:#1c6b48">' + got + '</span>'
      : '<b style="color:var(--err)">' + got + '</b>') + '</td>'));
    var tdx = el('td');
    var bx = el('button', 'btn sm danger', '✕');
    bx.title = 'Ders satırını sil';
    bx.onclick = function () {
      state.curriculum = state.curriculum.filter(function (x) { return x.id !== L.id; });
      state.schedule = state.schedule.filter(function (c) { return c.lessonId !== L.id; });
      logIt('📚 Ders silindi: ' + cname(L.classId) + ' · ' + sname(L.subjectId));
      refresh();
    };
    tdx.appendChild(bx); tr.appendChild(tdx);
    body.appendChild(tr);
  });
  tb.appendChild(body);
  var sc = el('div', 'scroll'); sc.appendChild(tb); box.appendChild(sc);

  var add = el('button', 'btn primary sm', '+ Ders ekle');
  add.style.marginTop = '9px';
  add.onclick = function () {
    state.curriculum.push({
      id: 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36),
      classId: mode === 'class' ? id : state.classes[0].id,
      subjectId: state.subjects[0].id,
      teacherId: mode === 'class' ? state.teachers[0].id : id,
      hours: 2
    });
    logIt('📚 Ders eklendi');
    refresh();
  };
  box.appendChild(add);
  box.appendChild(h('<span class="hint" style="margin-left:10px">Değişiklikten sonra üstteki ' +
    '🔄 <b>Yeniden Oluştur</b> ile programı yenileyin.</span>'));
  return box;
}
function mkSel(list, val, onch) {
  var td = el('td');
  var s = el('select'); s.style.maxWidth = '100%';
  list.forEach(function (x) {
    var o = el('option', '', x.name); o.value = x.id;
    if (x.id === val) o.selected = true;
    s.appendChild(o);
  });
  s.onchange = function () { onch(s.value); };
  td.appendChild(s);
  return td;
}

/* ============================================================
   👩‍🏫 ÖĞRETMENLER
   ============================================================ */
function viewOgretmen(root) {
  root.appendChild(h('<div class="card soft"><h3>👩‍🏫 Öğretmenlerin anlaşma gün ve saatleri</h3><div class="hint">' +
    'Başlangıç değerleri <code>2026-2027_Ogretmen_Sozlesme_Tablosu.md</code> sözleşme saatlerinden üretildi ' +
    '(“FULL”, “15.00\'DAN SONRA”, “13.00\'E KADAR YARIM GÜN”, “İZİNLİ” gibi ifadeler zil cetveline çevrildi).<br>' +
    'Hücrelere tıklayın ya da <b>sürükleyerek boyayın</b>. Yeşil = öğretmen o saatte kurumda. ' +
    'Alt kenarında mavi çizgi olan hücrelerde <b>şu an dersi var</b>.</div></div>'));

  if (!ui.tchSel || !TE[ui.tchSel]) ui.tchSel = state.teachers.length ? state.teachers[0].id : null;
  if (!ui.tchSel) { root.appendChild(h('<div class="empty">Öğretmen yok.</div>')); return; }

  var bar = el('div', 'bar');
  var sel = el('select');
  state.teachers.forEach(function (t) {
    var cap = 0, ok = view.maps.teachOk[t.id];
    for (var s = 0; s < E.NSLOT; s++) if (ok[s]) cap++;
    var load = lessonsOfTeacher(t.id).reduce(function (a, l) { return a + l.hours; }, 0);
    var o = el('option', '', t.name + '  —  ' + load + ' saat ders / ' + cap + ' saat müsait');
    o.value = t.id;
    if (t.id === ui.tchSel) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = function () { ui.tchSel = sel.value; render(); };
  bar.appendChild(sel);
  var bfill = el('button', 'btn', '🪄 Günleri derslerinden doldur');
  bfill.title = 'Bu öğretmeni, ders verdiği sınıfların kurumda olduğu tüm saatlerde müsait işaretler';
  bfill.onclick = function () { fillFromCurriculum(ui.tchSel); };
  bar.appendChild(bfill);
  var bclr = el('button', 'btn danger', 'Temizle');
  bclr.onclick = function () {
    var store = leaveStore(ui.tchSel);
    for (var d = 1; d <= 7; d++) {
      var cur = state.teacherAvail[ui.tchSel][d] || '';
      if (String(cur).indexOf('1') >= 0) store[d] = cur;   /* gün geri açılırsa eski saatler dönsün */
      state.teacherAvail[ui.tchSel][d] = '000000000000';
    }
    logIt('👩‍🏫 ' + tname(ui.tchSel) + ' müsaitliği temizlendi — tüm günler İZİNLİ');
    refresh();
  };
  bar.appendChild(bclr);
  root.appendChild(bar);
  root.appendChild(leaveDayChips(ui.tchSel));
  root.appendChild(availGrid(ui.tchSel));

  var lc = el('div', 'card');
  lc.appendChild(h('<h3>' + esc(tname(ui.tchSel)) + ' — verdiği dersler</h3>'));
  lc.appendChild(lessonTable('teacher', ui.tchSel));
  root.appendChild(lc);

  var card = el('div', 'card');
  card.appendChild(h('<h3>Tüm öğretmenler — yük / müsaitlik dengesi</h3>'));
  var sc2 = el('div', 'scroll'); sc2.style.maxHeight = '320px';
  var tb = el('table');
  tb.appendChild(h('<thead><tr><th class="rowhead">Öğretmen</th><th class="num">Ders</th><th class="num">Müsait</th>' +
    '<th style="width:120px">Doluluk</th><th>Kurumda olduğu günler</th></tr></thead>'));
  var body = el('tbody');
  state.teachers.forEach(function (t) {
    var ok = view.maps.teachOk[t.id], cap = 0, dl = [];
    for (var d = 1; d <= 7; d++) {
      var n = 0;
      for (var p = 1; p <= P; p++) if (ok[E.si(d, p)]) n++;
      cap += n;
      if (n) dl.push(DS[d - 1] + ':' + n);
    }
    var load = lessonsOfTeacher(t.id).reduce(function (a, l) { return a + l.hours; }, 0);
    var pct = cap ? Math.min(100, Math.round(load / cap * 100)) : 0;
    var tr = h('<tr style="cursor:pointer"><td class="rowhead">' + esc(t.name) + '</td>' +
      '<td class="num">' + load + '</td><td class="num">' + cap + '</td>' +
      '<td><div class="bars"><i class="' + (load > cap ? 'over' : load === cap ? 'full' : '') +
      '" style="width:' + pct + '%"></i></div>' +
      (load > cap ? '<span style="font-size:11px;color:var(--err)">' + (load - cap) + ' saat açık</span>' : '') +
      '</td><td style="font-size:12px">' +
      (dl.join(' · ') || '<span style="color:var(--err)">hiç gün yok</span>') + '</td></tr>');
    tr.onclick = function () { ui.tchSel = t.id; render(); };
    body.appendChild(tr);
  });
  tb.appendChild(body); sc2.appendChild(tb); card.appendChild(sc2); root.appendChild(card);

  root.appendChild(seedNoteCard('teacher',
    'Müsaitlikler <code>2026-2027_Ogretmen_Sozlesme_Tablosu.md</code> dosyasındaki sözleşme saatlerinden ' +
    'üretildi. Aşağıdakiler o dosyayla <code>ders programı.xml</code> arasındaki farklardır:'));
}

function availGrid(tid) {
  var days = activeDayList(), busy = {};
  view.cards.forEach(function (c) { if (c.teacherId === tid) busy[c.day + '_' + c.period] = c; });
  var card = el('div', 'card');
  card.appendChild(h('<h3>' + esc(tname(tid)) + ' — gün × ders saati müsaitliği</h3>'));
  var wrap = el('div', 'scroll'); wrap.style.padding = '8px';
  var g = el('div', 'av');
  g.style.gridTemplateColumns = '58px repeat(' + P + ',minmax(50px,1fr))';
  g.appendChild(el('div'));
  for (var p = 1; p <= P; p++) {
    g.appendChild(h('<div class="mlab"><b>' + p + '</b><br>' +
      esc(E.timeLabel(state.settings, days[0] || 6, p)).replace('-', '<br>') + '</div>'));
  }
  var painting = false, paintTo = 1;
  days.forEach(function (d) {
    var off = teacherDayOff(tid, d);
    var rowLab = h('<div class="mrow clk' + (off ? ' leave' : '') + '">' + esc(DS[d - 1]) +
      '<span class="lv">' + (off ? '🚫' : '⏻') + '</span></div>');
    rowLab.title = off
      ? DN[d - 1] + ' — İZİNLİ. Tıklayın: günü aç.'
      : DN[d - 1] + ' — kurumda. Tıklayın: günü kapat (İZİNLİ).';
    (function (dd) { rowLab.onclick = function () { toggleTeacherDay(tid, dd); }; })(d);
    g.appendChild(rowLab);
    for (var p2 = 1; p2 <= P; p2++) {
      var dead = !E.lessonBand(state.settings, d, p2);
      var on = (state.teacherAvail[tid][d] || '').charAt(p2 - 1) === '1';
      var cell = el('div', 'c' + (on ? ' on' : '') + (dead ? ' dead' : '') + (busy[d + '_' + p2] ? ' busy-here' : ''));
      cell.textContent = busy[d + '_' + p2]
        ? (busy[d + '_' + p2].kind === 'etut' ? '🎓' : sshort(busy[d + '_' + p2].subjectId))
        : (on ? '✓' : '');
      cell.title = DN[d - 1] + ' ' + p2 + '. ders (' + E.timeLabel(state.settings, d, p2) + ')' +
        (dead ? '\nEtüt arası — ders yerleşmez' : on ? '\nKurumda' : '\nKurumda değil') +
        (busy[d + '_' + p2] ? '\nŞu an: ' + (busy[d + '_' + p2].kind === 'etut' ? 'etüt'
          : sname(busy[d + '_' + p2].subjectId) + ' — ' + cname(busy[d + '_' + p2].classId)) : '');
      if (!dead) {
        (function (dd, pp, o) {
          cell.onmousedown = function (ev) {
            ev.preventDefault(); painting = true; paintTo = o ? 0 : 1; paint(tid, dd, pp, paintTo);
          };
          cell.onmouseenter = function () { if (painting) paint(tid, dd, pp, paintTo); };
        })(d, p2, on);
      }
      g.appendChild(cell);
    }
  });
  document.onmouseup = function () {
    if (painting) { painting = false; logIt('👩‍🏫 ' + tname(tid) + ' müsaitliği düzenlendi'); refresh(); }
  };
  wrap.appendChild(g); card.appendChild(wrap);
  var cap = 0;
  for (var s = 0; s < E.NSLOT; s++) if (view.maps.teachOk[tid][s]) cap++;
  var load = lessonsOfTeacher(tid).reduce(function (a, l) { return a + l.hours; }, 0);
  card.appendChild(h('<div class="hint" style="margin-top:9px">Müfredat yükü <b>' + load + '</b> saat · müsait <b>' +
    cap + '</b> saat' + (load > cap ? ' — <b style="color:var(--err)">' + (load - cap) +
    ' saat açık, program tamamlanamaz</b>' : '') + '</div>'));
  return card;
}
function paint(tid, d, p, to) {
  var cur = state.teacherAvail[tid][d] || '', arr = [];
  for (var i = 0; i < P; i++) arr.push(cur.charAt(i) === '1' ? '1' : '0');
  if (arr[p - 1] === String(to)) return;
  arr[p - 1] = String(to);
  state.teacherAvail[tid][d] = arr.join('');
  if (to) delete leaveStore(tid)[d];   /* elle saat açıldıysa gün artık izinli değil */
  var cells = document.querySelectorAll('.av .c');
  var days = activeDayList(), k = days.indexOf(d) * P + (p - 1);
  if (cells[k]) { cells[k].classList.toggle('on', !!to); cells[k].textContent = to ? '✓' : ''; }
}
/* ---- öğretmen izin günleri: bir günü bütünüyle aç / kapa ---- */
function teacherDayOff(tid, d) {
  return String(((state.teacherAvail || {})[tid] || {})[d] || '').indexOf('1') < 0;
}
/* O günün ders yerleşebilen tüm saatleri (etüt arası hariç) */
function fullDayPattern(d) {
  var a = [];
  for (var p = 1; p <= P; p++) a.push(E.lessonBand(state.settings, d, p) ? '1' : '0');
  return a.join('');
}
function leaveStore(tid) {
  if (!state.teacherLeave) state.teacherLeave = {};
  if (!state.teacherLeave[tid]) state.teacherLeave[tid] = {};
  return state.teacherLeave[tid];
}
/**
 * Günü kapatınca: o günün saatleri hatırlanır (geri açınca aynen döner),
 * müsaitlik sıfırlanır ve o güne yerleşmiş dersler programdan düşer.
 * Etütler kullanıcı kaydı olduğu için silinmez, yalnız bildirilir.
 */
function toggleTeacherDay(tid, d) {
  if (!state.settings.activeDays[d - 1]) {
    toast(DN[d - 1] + ' kurumda çalışma günü değil — ⚙️ Kurum Ayarları’ndan açın', 'err');
    return;
  }
  var store = leaveStore(tid), nm = tname(tid), dn = DN[d - 1];
  if (teacherDayOff(tid, d)) {
    var prev = store[d] || '';
    state.teacherAvail[tid][d] = String(prev).indexOf('1') >= 0 ? prev : fullDayPattern(d);
    delete store[d];
    logIt('👩‍🏫 ' + nm + ' — ' + dn + ' izni kaldırıldı, gün açıldı');
    toast(nm + ' · ' + dn + ' açıldı — 🔄 Yeniden Oluştur ile programa yansıtın', 'ok');
  } else {
    var mine = view.cards.filter(function (c) { return c.teacherId === tid && c.day === d; });
    var nEt = mine.filter(function (c) { return c.kind === 'etut'; }).length;
    var nDers = mine.length - nEt;
    if (nDers || nEt) {
      if (!confirm(nm + ' · ' + dn + ' günü İZİNLİ işaretlenecek.\n\n' +
        (nDers ? '• O güne yerleşmiş ' + nDers + ' ders saati programdan kaldırılacak ' +
          '(🔄 Yeniden Oluştur ile başka güne dağıtılır).\n' : '') +
        (nEt ? '• O gündeki ' + nEt + ' etüt korunur; gerekirse 🎓 Etüt Paneli’nden silin.\n' : '') +
        '\nDevam edilsin mi?')) return;
    }
    store[d] = state.teacherAvail[tid][d] || '';
    state.teacherAvail[tid][d] = '000000000000';
    if (nDers) {
      state.schedule = state.schedule.filter(function (c) {
        return !(c.teacherId === tid && c.day === d);
      });
    }
    logIt('👩‍🏫 ' + nm + ' — ' + dn + ' İZİNLİ işaretlendi' +
      (nDers ? ' (' + nDers + ' ders saati programdan kaldırıldı)' : ''));
    toast(nm + ' · ' + dn + ' İZİNLİ' +
      (nDers ? ' — ' + nDers + ' ders saati boşta, 🔄 Yeniden Oluştur ile dağıtın' : ''), 'ok');
  }
  refresh();
}
function leaveDayChips(tid) {
  var card = el('div', 'card soft');
  card.appendChild(h('<h3>📆 ' + esc(tname(tid)) + ' — kurumda olduğu / izinli günler</h3>' +
    '<div class="hint">Güne tıklayın: <b>yeşil</b> = kurumda, <b>kırmızı</b> = İZİNLİ. ' +
    'Kapattığınız günün saatleri saklanır; günü yeniden açtığınızda aynı saatler geri gelir.</div>'));
  var ch = el('div', 'chips'); ch.style.marginTop = '8px';
  activeDayList().forEach(function (d) {
    var off = teacherDayOff(tid, d);
    var b = el('button', 'chip day ' + (off ? 'leave' : 'here'),
      (off ? '🚫 ' : '✓ ') + DN[d - 1] + (off ? ' · İZİNLİ' : ''));
    b.title = off ? 'Tıklayın: günü aç (izni kaldır)' : 'Tıklayın: günü kapat (İZİNLİ işaretle)';
    b.onclick = function () { toggleTeacherDay(tid, d); };
    ch.appendChild(b);
  });
  card.appendChild(ch);
  return card;
}
function fillFromCurriculum(tid, silent) {
  var fresh = {};
  for (var d = 1; d <= 7; d++) fresh[d] = '000000000000'.split('');
  lessonsOfTeacher(tid).forEach(function (L) {
    var ok = view.baseMaps.classOk[L.classId];   // sınıfın geldiği oturumun tamamı
    if (!ok) return;
    for (var s = 0; s < E.NSLOT; s++) if (ok[s]) fresh[E.sd(s)][E.sp(s) - 1] = '1';
  });
  for (var d2 = 1; d2 <= 7; d2++) state.teacherAvail[tid][d2] = fresh[d2].join('');
  if (state.teacherLeave) state.teacherLeave[tid] = {};
  if (!silent) {
    logIt('🪄 ' + tname(tid) + ' müsaitliği derslerinden dolduruldu');
    toast('Müsaitlik, ders verdiği sınıfların saatlerine göre dolduruldu', 'ok');
    refresh();
  }
}

/* ============================================================
   ⚙️ KURUM AYARLARI
   ============================================================ */
function viewAyar(root) {
  var st = state.settings;

  var c1 = el('div', 'card');
  c1.appendChild(h('<h3>Çalışma günleri</h3>'));
  var ch = el('div', 'chips');
  for (var d = 1; d <= 7; d++) {
    (function (dd) {
      var on = !!st.activeDays[dd - 1];
      var b = el('button', 'chip' + (on ? ' on' : ''), DN[dd - 1]);
      b.onclick = function () {
        st.activeDays[dd - 1] = on ? 0 : 1;
        logIt('⚙️ ' + DN[dd - 1] + (on ? ' kapatıldı' : ' açıldı'));
        refresh();
      };
      ch.appendChild(b);
    })(d);
  }
  c1.appendChild(ch);
  c1.appendChild(h('<div class="hint" style="margin-top:8px">Kapatılan güne hiçbir ders veya etüt yerleşmez.</div>'));
  root.appendChild(c1);

  var c2 = el('div', 'card');
  c2.appendChild(h('<h3>Blok kuralları, gün dağıtımı ve üretim</h3>'));
  var b1 = el('div', 'bar');
  b1.appendChild(numField('Tercih edilen blok', st.preferredBlock, 1, 6, function (v) {
    st.preferredBlock = v; logIt('⚙️ Tercih edilen blok = ' + v); refresh();
  }, 'aynı ders kaç saat arka arkaya'));
  b1.appendChild(numField('En uzun blok', st.maxBlock, 1, 8, function (v) {
    st.maxBlock = v; logIt('⚙️ En uzun blok = ' + v); refresh();
  }, 'bir blok en fazla kaç saat'));
  b1.appendChild(numField('Sınıf başına “Gelebilir” gün',
    st.maxOptionalDays == null ? 1 : st.maxOptionalDays, 0, 5, function (v) {
      st.maxOptionalDays = v; logIt('⚙️ Sınıf başına en fazla “Gelebilir” gün = ' + v); refresh();
    }, 'kesin günlere sığmayan saatler için en fazla kaç ek gün'));
  b1.appendChild(numField('Deneme sayısı', st.attempts, 1, 400, function (v) {
    st.attempts = v; logIt('⚙️ Deneme sayısı = ' + v); refresh();
  }, 'artırmak daha derli toplu program üretir'));
  c2.appendChild(b1);

  var shBar = el('div', 'bar');
  (function () {
    var on = st.sessionShift !== false;
    var b = el('button', 'chip' + (on ? ' on' : ''),
      (on ? '✓ ' : '✕ ') + 'Boşluk kalmasın diye sınıf oturumu değiştirilebilir');
    b.onclick = function () {
      st.sessionShift = !on;
      logIt('⚙️ Oturum değiştirme ' + (on ? 'kapatıldı' : 'açıldı'));
      refresh();
    };
    shBar.appendChild(b);
  })();
  c2.appendChild(shBar);
  c2.appendChild(h('<div class="hint" style="margin-bottom:9px">Her yeniden oluşturmada bir sınıfın o günkü ' +
    'dersleri <b>tek kesintisiz dizi</b> hâline getirilir ve oturumun en erken saatinden başlatılır ' +
    '(hafta sonu 1. ders, akşam oturumunda 10. ders). <b>Öğretmenlerin gün ve saatleri değişmez;</b> ' +
    'değişen tek şey sınıfın o gün kaçta geldiğidir. Bu anahtar açıkken, kendi oturumunda boşluksuz ' +
    'yerleşemeyen bir sınıf o gün <b>öbür oturuma</b> (öğleden önce ↔ öğleden sonra) taşınabilir; ' +
    'taşınan sınıf-günleri işlem günlüğüne yazılır.</div>'));
  c2.appendChild(h('<div class="hint" style="margin-bottom:9px"><b>Sınıf başına “Gelebilir” gün</b> = 1 ise, ' +
    'haftalık yükü kesin günlerine sığmayan bir sınıf (örn. 401-411: 15 saat, hafta sonu 12 saat) tek bir ek ' +
    'akşama gelir. Hangi akşam olacağını program, o derslerin öğretmenlerinin müsaitliğine göre seçer ve ' +
    'paralel şubeleri ayrı günlere dağıtır.</div>'));
  var tbl = el('table');
  tbl.appendChild(h('<thead><tr><th>Haftalık saat</th><th>Blok dizilimi</th></tr></thead>'));
  var tb = el('tbody');
  [1, 2, 3, 4, 5, 6, 7, 8].forEach(function (n) {
    tb.appendChild(h('<tr><td>' + n + ' saat</td><td><b>' +
      E.splitBlocks(n, st.preferredBlock, st.maxBlock).join(' + ') + '</b></td></tr>'));
  });
  tbl.appendChild(tb);
  var w1 = el('div', 'scroll'); w1.style.maxWidth = '340px'; w1.appendChild(tbl);
  c2.appendChild(w1);
  root.appendChild(c2);

  var c3 = el('div', 'card');
  c3.appendChild(h('<h3>Etüt / özel ders penceresi</h3>'));
  c3.appendChild(h('<div class="hint" style="margin-bottom:10px">Etüt yalnızca bu ders saati aralığında ' +
    'planlanabilir. Kurum kararı: hafta içi <b>16.00 ve sonrası</b> (10-12. ders) — öğrenciler kendi ' +
    'okullarından sonra gelir.</div>'));
  var b3 = el('div', 'bar');
  b3.appendChild(numField('Hafta içi ilk saat', st.etutWindow.weekday.from, 1, P, function (v) {
    st.etutWindow.weekday.from = v; logIt('⚙️ Etüt penceresi (hafta içi) ilk saat = ' + v); refresh();
  }, E.timeLabel(st, 1, st.etutWindow.weekday.from)));
  b3.appendChild(numField('Hafta içi son saat', st.etutWindow.weekday.to, 1, P, function (v) {
    st.etutWindow.weekday.to = v; refresh();
  }, E.timeLabel(st, 1, st.etutWindow.weekday.to)));
  b3.appendChild(numField('Hafta sonu ilk saat', st.etutWindow.weekend.from, 1, P, function (v) {
    st.etutWindow.weekend.from = v; refresh();
  }, E.timeLabel(st, 6, st.etutWindow.weekend.from)));
  b3.appendChild(numField('Hafta sonu son saat', st.etutWindow.weekend.to, 1, P, function (v) {
    st.etutWindow.weekend.to = v; refresh();
  }, E.timeLabel(st, 6, st.etutWindow.weekend.to)));
  c3.appendChild(b3);
  c3.appendChild(h('<div class="hint">Şu an: hafta içi <b>' +
    esc(E.timeLabel(st, 1, st.etutWindow.weekday.from)) + ' → ' +
    esc(E.timeLabel(st, 1, st.etutWindow.weekday.to)) + '</b> · hafta sonu <b>' +
    esc(E.timeLabel(st, 6, st.etutWindow.weekend.from)) + ' → ' +
    esc(E.timeLabel(st, 6, st.etutWindow.weekend.to)) + '</b></div>'));
  root.appendChild(c3);

  var c4 = el('div', 'card');
  c4.appendChild(h('<h3>Ders saatleri — zaman aralıkları ve oturumlar</h3>'));
  c4.appendChild(h('<div class="hint" style="margin-bottom:9px">Zaman aralıklarını doğrudan düzenleyin ' +
    '(<code>09.00-09.40</code> biçiminde). Oturum sınırları blokların öğle/akşam arasını atlamasını engeller; ' +
    'oturum aralıklarını da aşağıdan değiştirebilirsiniz.</div>'));
  var sc = el('div', 'scroll');
  var t4 = el('table');
  t4.appendChild(h('<thead><tr><th class="num rowhead">Ders</th><th>Hafta içi saat</th><th>Hafta içi oturum</th>' +
    '<th>Hafta sonu saat</th><th>Hafta sonu oturum</th></tr></thead>'));
  var b4 = el('tbody');
  for (var p = 1; p <= P; p++) {
    (function (pp) {
      var tr = el('tr');
      tr.appendChild(h('<td class="num rowhead">' + pp + '.</td>'));
      [['weekdayTimes', 1], ['weekendTimes', 6]].forEach(function (pair) {
        var td = el('td');
        var inp = el('input'); inp.type = 'text'; inp.value = st[pair[0]][pp - 1] || '';
        inp.style.width = '112px';
        inp.onchange = function () {
          st[pair[0]][pp - 1] = inp.value.trim();
          logIt('⚙️ Zil saati: ' + (pair[1] === 1 ? 'hafta içi' : 'hafta sonu') + ' ' + pp + '. ders = ' + inp.value);
          refresh();
        };
        td.appendChild(inp);
        tr.appendChild(td);
        var bd = E.bandOf(st, pair[1], pp);
        tr.appendChild(h('<td>' + (bd ? (bd.noLesson
          ? '<span style="color:var(--muted)">' + esc(bd.label) + ' — ders yerleşmez</span>'
          : '<b style="color:var(--accent2)">' + esc(bd.label) + '</b>') : '—') + '</td>'));
      });
      b4.appendChild(tr);
    })(p);
  }
  t4.appendChild(b4); sc.appendChild(t4); c4.appendChild(sc);

  var bandBox = el('div'); bandBox.style.marginTop = '12px';
  [['weekdayBands', 'Hafta içi oturumlar', 1], ['weekendBands', 'Hafta sonu oturumlar', 6]].forEach(function (grp) {
    var wrapB = el('div'); wrapB.style.marginBottom = '10px';
    wrapB.appendChild(h('<div style="font-size:12px;font-weight:650;color:var(--accent2);margin-bottom:5px">' +
      esc(grp[1]) + '</div>'));
    var bb = el('div', 'bar'); bb.style.marginBottom = '0';
    st[grp[0]].forEach(function (bd, bi) {
      var l = el('label');
      l.appendChild(document.createTextNode(bd.label + (bd.noLesson ? ' (ders yerleşmez)' : '')));
      var i1 = el('input'); i1.type = 'number'; i1.min = 1; i1.max = P; i1.value = bd.from; i1.style.width = '58px';
      var i2 = el('input'); i2.type = 'number'; i2.min = 1; i2.max = P; i2.value = bd.to; i2.style.width = '58px';
      i1.onchange = i2.onchange = function () {
        st[grp[0]][bi].from = Math.max(1, Math.min(P, +i1.value || 1));
        st[grp[0]][bi].to = Math.max(st[grp[0]][bi].from, Math.min(P, +i2.value || 1));
        logIt('⚙️ Oturum aralığı: ' + bd.label + ' = ' + st[grp[0]][bi].from + '-' + st[grp[0]][bi].to);
        refresh();
      };
      l.appendChild(i1);
      l.appendChild(document.createTextNode('→'));
      l.appendChild(i2);
      bb.appendChild(l);
    });
    wrapB.appendChild(bb);
    bandBox.appendChild(wrapB);
  });
  c4.appendChild(bandBox);
  root.appendChild(c4);

  var c5 = el('div', 'card soft');
  c5.appendChild(h('<h3>🧪 Kendini test</h3>'));
  c5.appendChild(h('<div class="hint">Mevcut programı çakışma, müsaitlik, blok ardışıklığı, saat sayısı, ' +
    'ek gün sınırı ve grup tutarlılığı açısından denetler.</div>'));
  var bt = el('button', 'btn primary', 'Testi çalıştır');
  bt.style.marginTop = '10px';
  var out = el('div');
  bt.onclick = function () { out.innerHTML = ''; out.appendChild(selfTest()); };
  c5.appendChild(bt); c5.appendChild(out);
  root.appendChild(c5);
}
function numField(label, val, min, max, onch, hint) {
  var l = el('label');
  l.appendChild(document.createTextNode(label));
  var i = el('input'); i.type = 'number'; i.value = val; i.min = min; i.max = max; i.style.width = '76px';
  i.onchange = function () { onch(Math.max(min, Math.min(max, +i.value || min))); };
  l.appendChild(i);
  if (hint) l.appendChild(h('<span style="color:var(--muted);font-size:11px">' + esc(hint) + '</span>'));
  return l;
}

function selfTest() {
  var box = el('div'); box.style.marginTop = '12px';
  var res = [];
  function t(name, pass, det) { res.push({ name: name, pass: pass, det: det }); }

  t('Çakışma ve müsaitlik denetimi', view.errs.length === 0, view.errs.slice(0, 5).join(' · '));

  var got = {};
  state.schedule.forEach(function (c) { got[c.lessonId] = (got[c.lessonId] || 0) + 1; });
  var shortL = state.curriculum.filter(function (L) { return (got[L.id] || 0) !== L.hours; });
  t('Her ders satırı haftalık saatini aldı', shortL.length === 0,
    shortL.slice(0, 5).map(function (L) {
      return cname(L.classId) + '·' + sname(L.subjectId) + ' ' + (got[L.id] || 0) + '/' + L.hours;
    }).join(' · '));

  var byB = {};
  state.schedule.forEach(function (c) { (byB[c.blockId] ??= []).push(c); });
  var bad = [];
  Object.keys(byB).forEach(function (k) {
    var cs = byB[k].slice().sort(function (a, b) { return a.period - b.period; });
    var dset = {};
    cs.forEach(function (c) { dset[c.day] = 1; });
    if (Object.keys(dset).length > 1) { bad.push(k + ' (birden çok gün)'); return; }
    for (var i = 1; i < cs.length; i++) if (cs[i].period !== cs[i - 1].period + 1) bad.push(k + ' (ardışık değil)');
    var bs = {};
    cs.forEach(function (c) { bs[(E.bandOf(state.settings, c.day, c.period) || {}).id] = 1; });
    if (Object.keys(bs).length > 1) bad.push(k + ' (oturum sınırını aşıyor)');
  });
  t('Bloklar ardışık ve tek oturum içinde', bad.length === 0, bad.slice(0, 5).join(' · '));

  var nc = state.schedule.filter(function (c) { return (state.classDays[c.classId][c.day - 1] | 0) === 0; });
  t("Sınıfın 'Gelmiyor' olduğu güne ders yok", nc.length === 0,
    nc.slice(0, 4).map(function (c) { return cname(c.classId) + ' ' + DS[c.day - 1]; }).join(' · '));

  var maxOpt = state.settings.maxOptionalDays == null ? 1 : state.settings.maxOptionalDays;
  var over = Object.keys(view.optionalDays || {}).filter(function (cid) {
    return (view.optionalDays[cid] || []).length > maxOpt;
  });
  t('Hiçbir sınıf izin verilenden fazla “Gelebilir” gün kullanmıyor (en fazla ' + maxOpt + ')',
    over.length === 0,
    over.map(function (cid) { return cname(cid) + ': ' + view.optionalDays[cid].length; }).join(' · '));

  var eb = [];
  state.etuts.forEach(function (e) {
    if (!E.inEtutWindow(state.settings, e.day, e.period)) {
      eb.push(tname(e.teacherId) + ' ' + DS[e.day - 1] + ' ' + e.period + '. saat');
    }
  });
  t('Tüm etütler etüt penceresi içinde', eb.length === 0, eb.join(' · '));

  var dup = {}, clash = [];
  view.cards.forEach(function (c) {
    var k1 = 'c' + c.classId + '_' + c.day + '_' + c.period, k2 = 't' + c.teacherId + '_' + c.day + '_' + c.period;
    if (dup[k1]) clash.push(cname(c.classId) + ' ' + DS[c.day - 1] + ' ' + c.period + '. saat (sınıf)');
    if (dup[k2]) clash.push(tname(c.teacherId) + ' ' + DS[c.day - 1] + ' ' + c.period + '. saat (öğretmen)');
    dup[k1] = 1; dup[k2] = 1;
  });
  t('Etütler dahil hiç çakışma yok', clash.length === 0, clash.slice(0, 5).join(' · '));

  /* Sınıfın günü: boşluksuz ve oturumun en erken saatinden başlıyor mu? */
  var byCD = {}, gapRows = [], lateRows = [];
  view.cards.forEach(function (c) { (byCD[c.classId + '|' + c.day] ??= []).push(c.period); });
  Object.keys(byCD).forEach(function (k) {
    var ps = byCD[k].slice().sort(function (a, b) { return a - b; });
    var cid = k.split('|')[0], d = +k.split('|')[1];
    var lbl = cname(cid) + ' ' + DS[d - 1];
    if (ps[ps.length - 1] - ps[0] + 1 !== ps.length) { gapRows.push(lbl); return; }
    var band = E.lessonBand(state.settings, d, ps[0]);
    if (band && ps[0] !== band.from) lateRows.push(lbl + ' → ' + ps[0] + '. dersten başlıyor');
  });
  t('Sınıfların gün içinde boş dersi yok', gapRows.length === 0, gapRows.slice(0, 6).join(' · '));
  t('Sınıflar oturumun ilk ders saatinden başlıyor', lateRows.length === 0, lateRows.slice(0, 6).join(' · '));

  var gd = view.groups.reduce(function (a, g) { return a + g.diffs.length; }, 0);
  t('Paralel şubeler aynı dersleri alıyor', gd === 0,
    view.groups.filter(function (g) { return g.diffs.length; }).map(function (g) {
      return g.name + ': ' + g.diffs.length + ' fark';
    }).join(' · '));

  var nfail = res.filter(function (r) { return !r.pass; }).length;
  box.appendChild(h('<div class="diag ' + (nfail ? 'error' : 'info') + '"><div class="t">' +
    (nfail ? '✗ ' + nfail + ' test başarısız' : '✓ ' + res.length + ' testin tamamı geçti') + '</div></div>'));
  var ul = el('div');
  res.forEach(function (r) {
    ul.appendChild(h('<div style="padding:5px 2px;border-bottom:1px solid var(--line);font-size:13px">' +
      (r.pass ? '<span style="color:#1c6b48">✓</span> ' : '<span style="color:var(--err)">✗</span> ') +
      esc(r.name) + (r.det && !r.pass
        ? '<div style="font-size:12px;color:var(--err);margin-left:18px">' + esc(r.det) + '</div>' : '') +
      '</div>'));
  });
  box.appendChild(ul);
  return box;
}

/* ============================================================
   🩺 TANILAMA
   ============================================================ */
function viewTani(root) {
  var errs = view.diag.filter(function (d) { return d.level === 'error'; });
  var warns = view.diag.filter(function (d) { return d.level === 'warn'; });
  var total = state.curriculum.reduce(function (s, l) { return s + l.hours; }, 0);
  var missing = total - state.schedule.length;

  var head = el('div', 'card ' + (errs.length ? '' : 'soft'));
  head.appendChild(h('<h3>🩺 Durum</h3>'));
  if (!errs.length && !missing) {
    head.appendChild(h('<div class="diag info"><div class="t">✓ Program eksiksiz — ' + total +
      ' ders saatinin tamamı yerleşti, engel bulunamadı.</div>' +
      (warns.length ? '<div class="fx">' + warns.length + ' uyarı var (aşağıda). Uyarılar programı ' +
        'engellemez.</div>' : '') + '</div>'));
  } else if (missing) {
    head.appendChild(h('<div class="diag error"><div class="t">' + missing + ' ders saati yerleşemedi (' +
      state.schedule.length + '/' + total + ').</div><div class="fx">Her maddenin altında ' +
      '<b>uygulanabilir alternatifler</b> var — düğmeye basınca değişiklik yapılır ve program yeniden ' +
      'üretilir. Öncesinde otomatik kayıt noktası alınır.</div></div>'));
  } else {
    head.appendChild(h('<div class="diag error"><div class="t">Program tamamlandı ama ' + errs.length +
      ' yapısal engel bulundu.</div><div class="fx">Bu engeller bir sonraki yeniden oluşturmada soruna ' +
      'yol açabilir.</div></div>'));
  }
  var fixable = errs.filter(function (d) {
    return d.actions && d.actions.filter(function (x) { return x.type !== 'regenerate'; }).length;
  });
  if (fixable.length) {
    var ba = el('button', 'btn go', '⚡ İlk alternatifleri otomatik uygula (' + fixable.length + ' hata)');
    ba.style.marginTop = '4px';
    ba.onclick = function () { autoFixAll(fixable); };
    head.appendChild(ba);
  }
  root.appendChild(head);

  /* --- son üretimde atılan kilitler / geçersiz etütler --- */
  if (lastRun && ((lastRun.droppedLocks || []).length || (lastRun.badEtuts || []).length)) {
    var nc2 = el('div', 'card');
    nc2.appendChild(h('<h3>🔓 Son yeniden oluşturmada düşen kayıtlar</h3>'));
    if ((lastRun.droppedLocks || []).length) {
      var box2 = el('div', 'diag warn');
      box2.appendChild(h('<div class="t">' + lastRun.droppedLocks.length +
        ' kilitli ders saati geçersiz kaldığı için kilidi açıldı.<span class="code">lock-dropped</span></div>'));
      var ul2 = el('ul');
      lastRun.droppedLocks.slice(0, 12).forEach(function (d) {
        ul2.appendChild(el('li', '', cname(d.c.classId) + ' · ' + sname(d.c.subjectId) + ' — ' +
          DS[d.c.day - 1] + ' ' + d.c.period + '. ders: ' + d.why));
      });
      box2.appendChild(ul2);
      box2.appendChild(h('<div class="fx">Müsaitlik, gün ya da ders bilgisi değiştiğinde eski kilitler ' +
        'geçerliliğini yitirir. Sabit kaldıklarında programın tamamlanmasını engelledikleri için atılırlar; ' +
        'dersler yeniden dağıtıldı.</div>'));
      nc2.appendChild(box2);
    }
    if ((lastRun.badEtuts || []).length) {
      var box3 = el('div', 'diag error');
      box3.appendChild(h('<div class="t">' + lastRun.badEtuts.length +
        ' etüt artık geçersiz saatte.<span class="code">etut-invalid</span></div>'));
      var ul3 = el('ul');
      lastRun.badEtuts.forEach(function (e) {
        ul3.appendChild(el('li', '', tname(e.teacherId) + ' × ' + cname(e.classId) + ' — ' +
          DN[e.day - 1] + ' ' + e.period + '. ders: ' +
          (!E.inEtutWindow(state.settings, e.day, e.period) ? 'etüt penceresi dışında'
            : 'öğretmen o saatte kurumda değil')));
      });
      box3.appendChild(ul3);
      box3.appendChild(h('<div class="fx">Ne yapmalı: 🎓 Etüt Paneli\'nden bu etütleri silip yeniden ' +
        'planlayın ya da 👩‍🏫 Öğretmenler sekmesinden ilgili saati açın.</div>'));
      var bdel = el('button', 'btn sm danger', 'Geçersiz etütleri sil (' + lastRun.badEtuts.length + ')');
      bdel.onclick = function () {
        var ids = {};
        lastRun.badEtuts.forEach(function (e) { ids[e.id] = 1; });
        state.etuts = state.etuts.filter(function (e) { return !ids[e.id]; });
        logIt('🎓 ' + Object.keys(ids).length + ' geçersiz etüt silindi');
        lastRun.badEtuts = [];
        refresh();
        toast('Geçersiz etütler silindi', 'ok');
      };
      box3.appendChild(bdel);
      nc2.appendChild(box3);
    }
    root.appendChild(nc2);
  }

  if (view.errs.length) {
    var vc = el('div', 'card');
    vc.appendChild(h('<h3 style="color:var(--err)">⚠ Program tutarsız</h3>'));
    view.errs.slice(0, 20).forEach(function (e) {
      vc.appendChild(h('<div class="diag error"><div class="t">' + esc(e) + '</div></div>'));
    });
    vc.appendChild(h('<div class="hint">Bu bir iç tutarsızlık — 🔄 Yeniden Oluştur ile programı baştan üretin.</div>'));
    root.appendChild(vc);
  }

  [['Hatalar — programı engelleyenler', errs], ['Uyarılar', warns]].forEach(function (grp) {
    if (!grp[1].length) return;
    var card = el('div', 'card');
    card.appendChild(h('<h3>' + esc(grp[0]) + ' <span class="chip">' + grp[1].length + '</span></h3>'));
    grp[1].forEach(function (d) {
      var box = el('div', 'diag ' + d.level);
      box.appendChild(h('<div class="t">' + esc(d.title) + '<span class="code">' + esc(d.code) + '</span></div>'));
      if (d.detail && d.detail.length) {
        var ul = el('ul');
        d.detail.forEach(function (x) { ul.appendChild(el('li', '', x)); });
        box.appendChild(ul);
      }
      if (d.fix) box.appendChild(h('<div class="fx">' + esc(d.fix) + '</div>'));
      if (d.actions && d.actions.length) {
        var alts = el('div', 'alts');
        d.actions.forEach(function (a, i) {
          var row = el('div', 'alt');
          row.appendChild(el('div', 'n', String(i + 1)));
          row.appendChild(h('<div class="l">' + esc(a.label) + '</div>'));
          var b = el('button', 'btn sm go', 'Uygula');
          b.onclick = function () { applyAction(a); };
          row.appendChild(b);
          alts.appendChild(row);
        });
        box.appendChild(alts);
      }
      var go = null;
      if (d.classId) go = ['sinif', '🏫 Sınıflar'];
      if (d.teacherId) go = ['ogretmen', '👩‍🏫 Öğretmenler'];
      if (d.code === 'unplaced-block') go = ['takvim', '📅 Takvim'];
      if (go) {
        var gb = el('button', 'btn sm', go[1] + ' sekmesine git');
        gb.style.marginTop = '7px';
        gb.onclick = function () {
          tab = go[0];
          if (d.teacherId) { ui.tchSel = d.teacherId; ui.gapSel = d.teacherId; }
          if (d.classId) ui.clsSel = d.classId;
          renderTabs(); render();
        };
        box.appendChild(gb);
      }
      card.appendChild(box);
    });
    root.appendChild(card);
  });

  var lb = el('div', 'card');
  lb.appendChild(h('<h3>Yük dengesi</h3>'));
  var sc = el('div', 'scroll'); sc.style.maxHeight = '380px';
  var tb = el('table');
  tb.appendChild(h('<thead><tr><th class="rowhead">Öğretmen</th><th class="num">Ders</th><th class="num">Yerleşen</th>' +
    '<th class="num">Müsait</th><th class="num">Boş</th><th style="width:120px">Doluluk</th></tr></thead>'));
  var body = el('tbody');
  var pl = {};
  state.schedule.forEach(function (c) { pl[c.teacherId] = (pl[c.teacherId] || 0) + 1; });
  state.teachers.map(function (t) {
    var load = lessonsOfTeacher(t.id).reduce(function (a, l) { return a + l.hours; }, 0), cap = 0;
    for (var s = 0; s < E.NSLOT; s++) if (view.maps.teachOk[t.id][s]) cap++;
    return { t: t, load: load, cap: cap, got: pl[t.id] || 0, g: view.gaps[t.id] };
  }).sort(function (a, b) { return b.load - a.load; }).forEach(function (r) {
    var pct = r.cap ? Math.min(100, Math.round(r.load / r.cap * 100)) : 0;
    body.appendChild(h('<tr><td class="rowhead">' + esc(r.t.name) + '</td><td class="num">' + r.load + '</td>' +
      '<td class="num">' + (r.got === r.load ? r.got : '<b style="color:var(--err)">' + r.got + '</b>') + '</td>' +
      '<td class="num">' + r.cap + '</td><td class="num">' + r.g.free + '</td>' +
      '<td><div class="bars" title="' + pct + '%"><i class="' +
      (r.load > r.cap ? 'over' : r.load === r.cap ? 'full' : '') + '" style="width:' + pct + '%"></i></div></td></tr>'));
  });
  tb.appendChild(body); sc.appendChild(tb); lb.appendChild(sc); root.appendChild(lb);
}

/* ---------------- alternatifleri uygula ---------------- */
function applyAction(a, silent) {
  var lesson = a.lessonId ? state.curriculum.filter(function (x) { return x.id === a.lessonId; })[0] : null;
  switch (a.type) {
    case 'open-class-day':
      state.classDays[a.classId][a.day - 1] = a.status == null ? 2 : a.status;
      var bd = E.bandsOf(state.settings, a.day).filter(function (x) { return x.id === a.band; })[0];
      if (bd) setBand(a.classId, a.day, bd, true);
      break;
    case 'teacher-avail':
      a.slots.forEach(function (x) {
        var cur = state.teacherAvail[a.teacherId][x[0]] || '', arr = [];
        for (var i = 0; i < P; i++) arr.push(cur.charAt(i) === '1' ? '1' : '0');
        arr[x[1] - 1] = '1';
        state.teacherAvail[a.teacherId][x[0]] = arr.join('');
        delete leaveStore(a.teacherId)[x[0]];
      });
      break;
    case 'set-hours':
      if (!lesson) return;
      lesson.hours = Math.max(0, a.hours);
      state.schedule = state.schedule.filter(function (c) { return c.lessonId !== lesson.id; });
      break;
    case 'reassign-teacher':
      if (!lesson) return;
      lesson.teacherId = a.teacherId;
      state.schedule = state.schedule.filter(function (c) { return c.lessonId !== lesson.id; });
      break;
    case 'delete-lesson':
      state.curriculum = state.curriculum.filter(function (x) { return x.id !== a.lessonId; });
      state.schedule = state.schedule.filter(function (c) { return c.lessonId !== a.lessonId; });
      break;
    case 'setting':
      state.settings[a.path] = a.value;
      break;
    case 'equalize':
      equalizeOne(a);
      break;
    case 'equalize-group':
      equalizeGroup(a.groupName, true);
      break;
    case 'regenerate':
      break;
    default:
      toast('Bilinmeyen işlem: ' + a.type, 'err');
      return;
  }
  logIt('⚡ Alternatif uygulandı: ' + a.label);
  if (silent) return;
  snapshot('Alternatif uygulanmadan önce (otomatik)', true);
  regenerate(true);
  toast('Uygulandı: ' + a.label, 'ok');
}

function autoFixAll(errs) {
  var withAct = errs.filter(function (d) {
    return d.actions && d.actions.filter(function (x) { return x.type !== 'regenerate'; }).length;
  });
  if (!withAct.length) { toast('Otomatik uygulanabilir alternatif yok', 'err'); return; }
  if (!confirm(withAct.length + ' hatanın ilk alternatifi sırayla uygulanacak ve program yeniden üretilecek.\n' +
      'Önce otomatik kayıt noktası alınır.\n\nDevam edilsin mi?')) return;
  snapshot('Otomatik düzeltme öncesi (otomatik)', true);
  var n = 0;
  withAct.forEach(function (d) {
    var a = d.actions.filter(function (x) { return x.type !== 'regenerate'; })[0];
    if (a) { applyAction(a, true); n++; }
  });
  logIt('⚡ ' + n + ' alternatif otomatik uygulandı');
  regenerate(true);
  toast(n + ' alternatif uygulandı, program yeniden üretildi', 'ok');
}

function equalizeOne(a) {
  var rows = state.curriculum.filter(function (L) {
    return L.classId === a.classId && L.subjectId === a.subjectId;
  });
  if (a.hours <= 0) {
    state.curriculum = state.curriculum.filter(function (L) {
      return !(L.classId === a.classId && L.subjectId === a.subjectId);
    });
  } else if (rows.length) {
    rows[0].hours = a.hours;
    for (var i = 1; i < rows.length; i++) {
      state.curriculum = state.curriculum.filter(function (L) { return L !== rows[i]; });
    }
  } else {
    var tid = a.teacherId;
    if (!tid) {
      var g = view.groups.filter(function (x) { return x.classIds.indexOf(a.classId) >= 0; })[0];
      if (g) {
        var peer = state.curriculum.filter(function (L) {
          return L.subjectId === a.subjectId && g.classIds.indexOf(L.classId) >= 0;
        })[0];
        tid = peer ? peer.teacherId : state.teachers[0].id;
      } else tid = state.teachers[0].id;
    }
    state.curriculum.push({
      id: 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36),
      classId: a.classId, subjectId: a.subjectId, teacherId: tid, hours: a.hours
    });
  }
  state.schedule = state.schedule.filter(function (c) { return c.classId !== a.classId; });
}

function equalizeGroup(name, silent) {
  var g = view.groups.filter(function (x) { return x.name === name; })[0];
  if (!g || !g.diffs.length) { if (!silent) toast('Bu grupta fark yok', 'ok'); return; }
  if (!silent && !confirm('“' + name + '” grubundaki ' + g.diffs.length +
      ' ders farkı, grubun çoğunluk saatine getirilecek. Önce otomatik kayıt noktası alınır.\n\nDevam?')) return;
  if (!silent) snapshot('Grup eşitleme öncesi (otomatik)', true);
  var n = g.diffs.length;
  g.diffs.forEach(function (d) {
    equalizeOne({ classId: d.classId, subjectId: d.subjectId, hours: d.expected, teacherId: d.teacherId });
  });
  logIt('👥 ' + name + ' grubunda ' + n + ' ders farkı eşitlendi');
  if (silent) return;
  regenerate(true);
  toast(name + ': ' + n + ' fark eşitlendi', 'ok');
}

/* ============================================================
   ÜRETİM
   ============================================================ */
/**
 * Kilitli kartlardan artık geçersiz olanları ayıklar.
 * Müsaitlik/gün/ders değişince eski kilitler "sabit" sayılıp yer tuttuğu için
 * programın tamamlanmasını engelliyordu — bu yüzden sessizce değil, bildirerek atılır.
 */
function pruneLocks(locked, maps) {
  var kept = [], dropped = [];
  locked.forEach(function (c) {
    var s = E.si(c.day, c.period);
    var L = state.curriculum.filter(function (x) { return x.id === c.lessonId; })[0];
    var why = null;
    if (!L) why = 'ders satırı silindi';
    else if (L.teacherId !== c.teacherId) why = 'ders başka öğretmene verildi';
    else if (!maps.classOk[c.classId] || !maps.classOk[c.classId][s]) why = 'sınıf o saatte kurumda değil';
    else if (!maps.teachOk[c.teacherId] || !maps.teachOk[c.teacherId][s]) why = 'öğretmen o saatte kurumda değil';
    else if (!E.lessonBand(state.settings, c.day, c.period)) why = 'o saate ders yerleşmiyor';
    if (why) dropped.push({ c: c, why: why }); else kept.push(c);
  });
  // bir bloğun bir saati düştüyse tamamını düşür (yarım blok kalmasın)
  var badBlocks = {};
  dropped.forEach(function (d) { if (d.c.blockId) badBlocks[d.c.blockId] = 1; });
  kept = kept.filter(function (c) {
    if (c.blockId && badBlocks[c.blockId]) { dropped.push({ c: c, why: 'bloğun diğer saati geçersiz kaldı' }); return false; }
    return true;
  });
  // lesson başına kilitli saat, dersin haftalık saatini aşmasın
  var per = {};
  kept = kept.filter(function (c) {
    var L = state.curriculum.filter(function (x) { return x.id === c.lessonId; })[0];
    per[c.lessonId] = (per[c.lessonId] || 0) + 1;
    if (L && per[c.lessonId] > L.hours) { dropped.push({ c: c, why: 'ders saati azaltıldı' }); return false; }
    return true;
  });
  return { kept: kept, dropped: dropped };
}

function regenerate(keepLocks) {
  expandClassSlots();            // çözücü sınıfın geldiği oturumun tamamını kullanabilsin
  var maps0 = E.buildMaps(state);
  var locked = [], droppedLocks = [];
  if (keepLocks) {
    var pr = pruneLocks(state.schedule.filter(function (c) { return c.locked; }), maps0);
    locked = pr.kept;
    droppedLocks = pr.dropped;
  }
  // artık geçersiz etütler
  var badEtuts = state.etuts.filter(function (e) {
    var s = E.si(e.day, e.period);
    return !maps0.teachOk[e.teacherId] || !maps0.teachOk[e.teacherId][s] ||
           !E.inEtutWindow(state.settings, e.day, e.period);
  });
  var fixed = locked.concat(state.etuts.map(function (e) {
    return { classId: e.classId, teacherId: e.teacherId, day: e.day, period: e.period, kind: 'etut' };
  }));
  var t0 = Date.now(), res;
  try {
    res = E.generate(state, fixed, {
      attempts: state.settings.attempts, repairSteps: 20000,
      sessionShift: state.settings.sessionShift !== false,
      seed: (Math.random() * 0x7fffffff) | 0
    });
  } catch (err) {
    console.error(err);
    toast('Üretim hatası: ' + err.message, 'err');
    return;
  }
  // Sınıfın geliş oturumu değiştiyse (öğleden önce ↔ öğleden sonra) geliş saatlerini yaz
  var shifted = res.slotShifts || [];
  shifted.forEach(function (x) {
    (state.classSlots[x.classId] || (state.classSlots[x.classId] = {}))[x.day] = x.bits;
    (baseSlots()[x.classId] || (baseSlots()[x.classId] = {}))[x.day] = x.bits;
  });
  state.schedule = locked.concat(res.cards);
  trimClassSlots();              // sınıfın boş dersi kalmasın: yalnız ders gördüğü saatler
  lastRun = { ms: Date.now() - t0, attempts: res.stats.attempts, missingHours: res.stats.missingHours,
              missingBlocks: res.missing, maybeDayHours: res.stats.maybeDayHours,
              optionalDays: res.optionalDays, optionalDayCount: res.stats.optionalDayCount,
              teacherGaps: res.stats.teacherGaps, splits: res.stats.splits,
              classGaps: res.stats.classGaps };
  lastRun.droppedLocks = droppedLocks;
  lastRun.badEtuts = badEtuts;
  bufferRun(keepLocks ? 'kilitler korunarak' : 'tamamen yeni');
  logIt('🔄 Program yeniden oluşturuldu — ' + state.schedule.length + ' saat' +
        (res.stats.missingHours ? ', ' + res.stats.missingHours + ' saat eksik' : '') +
        (res.stats.splits ? ', ' + res.stats.splits + ' kopuk ders' : ', dersler arka arkaya') +
        (res.stats.classGaps ? ', sınıflarda ' + res.stats.classGaps + ' saat ara boşluk'
                             : ', sınıflarda boş ders yok') +
        (locked.length ? ', ' + locked.length + ' kilitli korundu' : '') +
        (droppedLocks.length ? ', ' + droppedLocks.length + ' geçersiz kilit atıldı' : '') +
        ', ' + res.stats.optionalDayCount + ' ek gün seçildi');
  if (shifted.length) {
    logIt('🕘 Geliş oturumu değişen sınıflar: ' + shifted.map(function (x) {
      return cname(x.classId) + ' ' + DS[x.day - 1] + ' ' + x.fromLabel + ' → ' + x.toLabel;
    }).join(' · '));
  }
  if (droppedLocks.length) {
    logIt('🔓 Geçersiz kalan kilitler atıldı: ' + droppedLocks.slice(0, 6).map(function (d) {
      return cname(d.c.classId) + ' ' + DS[d.c.day - 1] + ' ' + d.c.period + '. saat (' + d.why + ')';
    }).join(' · ') + (droppedLocks.length > 6 ? ' …' : ''));
  }
  refresh();
  toast(res.stats.missingHours === 0
    ? '✓ Program oluşturuldu: ' + state.schedule.length + ' ders saati, çakışma yok (' + lastRun.ms + ' ms)' +
      (res.stats.classGaps ? ' · ⚠ sınıflarda ' + res.stats.classGaps + ' saat ara boşluk'
                           : ' · sınıflarda boş ders yok') +
      (shifted.length ? ' · ' + shifted.length + ' sınıf-günü oturum değiştirdi' : '') +
      (droppedLocks.length ? ' · ' + droppedLocks.length + ' geçersiz kilit atıldı' : '')
    : '⚠ ' + res.stats.missingHours + ' saat yerleşemedi — 🩺 Tanılama sekmesine bakın',
    res.stats.missingHours === 0 ? 'ok' : 'err');
  if (res.stats.missingHours) { tab = 'tani'; renderTabs(); render(); }
}

/* ============================================================
   🧪 GEÇİCİ BELLEK — üretilen program denemeleri
   Yalnız bu oturumda yaşar (sayfa kapanınca silinir). Kalıcı olsun
   istenen deneme “💾 Kalıcı kaydet” ile kayıt noktasına çevrilir.
   ============================================================ */
var runBuf = [], runSeq = 0, curRunId = null;
var RUNBUF_MAX = 10;

function bufferRun(kind) {
  runSeq++;
  var e = {
    id: 'R' + runSeq, n: runSeq, t: Date.now(), kind: kind || 'üretim',
    schedule: JSON.parse(JSON.stringify(state.schedule)),
    /* sınıfların o üretimdeki geliş saatleri — denemeyle birlikte geri gelsin */
    classSlots: JSON.parse(JSON.stringify(state.classSlots)),
    classBaseSlots: JSON.parse(JSON.stringify(baseSlots())),
    stats: lastRun ? JSON.parse(JSON.stringify(lastRun)) : null,
    placed: state.schedule.length,
    total: state.curriculum.reduce(function (s, l) { return s + l.hours; }, 0),
    locks: state.schedule.filter(function (c) { return c.locked; }).length,
    splits: lastRun ? (lastRun.splits || 0) : 0,
    cgaps: lastRun ? (lastRun.classGaps || 0) : 0,
    gaps: lastRun ? (lastRun.teacherGaps || 0) : 0,
    optDays: lastRun ? (lastRun.optionalDayCount || 0) : 0,
    missing: lastRun ? (lastRun.missingHours || 0) : 0
  };
  runBuf.unshift(e);
  if (runBuf.length > RUNBUF_MAX) runBuf.length = RUNBUF_MAX;
  curRunId = e.id;
  renderRunBadge();
  return e;
}
/* Deneme, o günkü müsaitlik/müfredatla hâlâ tutarlı mı? */
function runIssues(e) {
  var maps = view.maps, bad = 0;
  if (e.classSlots) {                       // deneme kendi geliş saatleriyle ölçülür
    maps = E.buildMaps({ settings: state.settings, classes: state.classes, teachers: state.teachers,
                         classDays: state.classDays, classSlots: e.classSlots,
                         teacherAvail: state.teacherAvail });
  }
  var have = {};
  state.curriculum.forEach(function (L) { have[L.id] = L; });
  e.schedule.forEach(function (c) {
    var s = E.si(c.day, c.period);
    if (c.lessonId && !have[c.lessonId]) { bad++; return; }
    if (!maps.teachOk[c.teacherId] || !maps.teachOk[c.teacherId][s]) { bad++; return; }
    if (!maps.classOk[c.classId] || !maps.classOk[c.classId][s]) bad++;
  });
  return bad;
}
function applyRun(id, keep) {
  var e = runBuf.filter(function (x) { return x.id === id; })[0];
  if (!e) return;
  var bad = runIssues(e);
  if (bad && !confirm('Deneme #' + e.n + ' bugünkü ayarlarla tam uyuşmuyor: ' + bad +
      ' ders saati artık geçersiz (müsaitlik ya da müfredat değişmiş).\n\n' +
      'Yine de uygulansın mı? (Sonra 🔄 Yeniden Oluştur önerilir)')) return;
  state.schedule = JSON.parse(JSON.stringify(e.schedule));
  if (e.classSlots) state.classSlots = JSON.parse(JSON.stringify(e.classSlots));
  if (e.classBaseSlots) state.classBaseSlots = JSON.parse(JSON.stringify(e.classBaseSlots));
  lastRun = e.stats ? JSON.parse(JSON.stringify(e.stats)) : null;
  curRunId = e.id;
  logIt('🧪 Deneme #' + e.n + ' programa uygulandı (' + e.placed + '/' + e.total + ' saat)');
  if (keep) snapshot('Deneme #' + e.n + ' · ' + e.placed + '/' + e.total + ' saat', false);
  closeModal();
  refresh();
  toast('Deneme #' + e.n + ' uygulandı' + (keep ? ' ve kalıcı kaydedildi' : ''), 'ok');
}
function renderRunBadge() {
  var b = document.getElementById('bRuns');
  if (!b) return;
  b.textContent = '🧪 Denemeler' + (runBuf.length ? ' (' + runBuf.length + ')' : '');
  b.disabled = !runBuf.length;
  b.title = runBuf.length
    ? runBuf.length + ' üretim bu oturumda bellekte tutuluyor'
    : 'Henüz üretim yok — 🔄 Yeniden Oluştur';
}
function openRuns() {
  openModal('🧪 Geçici bellek — bu oturumda üretilen programlar', function (body, foot) {
    body.appendChild(h('<div class="hint">Her 🔄 <b>Yeniden Oluştur</b> sonucunda program burada saklanır ' +
      '(en son ' + RUNBUF_MAX + ' deneme). İstediğinize tek tıkla dönebilir, karşılaştırabilirsiniz. ' +
      'Bu liste <b>geçicidir</b> — sayfayı kapatınca silinir; korumak istediğinizi ' +
      '<b>💾 Kalıcı kaydet</b> ile kayıt noktasına çevirin.</div>'));
    if (!runBuf.length) { body.appendChild(h('<div class="empty">Henüz üretim yok.</div>')); }
    var bestSplit = Math.min.apply(null, runBuf.map(function (x) { return x.splits + x.cgaps; }).concat([1e9]));
    var bestGap = Math.min.apply(null, runBuf.map(function (x) { return x.gaps; }).concat([1e9]));
    runBuf.forEach(function (e) {
      var row = el('div', 'snap');
      var tags =
        '<span class="chip' + (e.missing ? '' : ' on') + '">' + e.placed + '/' + e.total + ' saat' +
          (e.missing ? ' · ' + e.missing + ' eksik' : '') + '</span> ' +
        '<span class="chip' + (e.splits + e.cgaps === bestSplit ? ' on' : '') + '" title="' +
          'kopuk ders ' + e.splits + ' · sınıf ara boşluğu ' + e.cgaps + ' saat">' +
          (e.splits + e.cgaps ? 'ardışıklık: ' + (e.splits + e.cgaps) + ' kopukluk' : 'dersler arka arkaya') +
          '</span> ' +
        '<span class="chip' + (e.gaps === bestGap ? ' on' : '') + '">öğretmen boşluğu ' + e.gaps + '</span> ' +
        '<span class="chip">' + e.optDays + ' ek gün</span>' +
        (e.locks ? ' <span class="chip">' + e.locks + ' kilit</span>' : '');
      row.appendChild(h('<div class="n"><b>Deneme #' + e.n +
        (e.id === curRunId ? ' <span class="chip on">şu an ekranda</span>' : '') + '</b>' +
        '<span>' + esc(fmtDate(e.t)) + ' · ' + esc(e.kind) +
        (e.stats ? ' · ' + e.stats.ms + ' ms' : '') + '</span>' +
        '<span style="margin-top:4px;display:block">' + tags + '</span></div>'));
      var ba = el('button', 'btn sm' + (e.id === curRunId ? '' : ' primary'), '↩ Uygula');
      ba.disabled = e.id === curRunId;
      ba.onclick = function () { applyRun(e.id, false); };
      var bk = el('button', 'btn sm', '💾 Kalıcı kaydet');
      bk.title = 'Bu denemeyi uygula ve kayıt noktasına çevir';
      bk.onclick = function () { applyRun(e.id, true); };
      var bd = el('button', 'btn sm danger', '✕');
      bd.title = 'Bu denemeyi bellekten sil';
      bd.onclick = function () {
        runBuf = runBuf.filter(function (x) { return x.id !== e.id; });
        renderRunBadge(); closeModal(); openRuns();
      };
      row.appendChild(ba); row.appendChild(bk); row.appendChild(bd);
      body.appendChild(row);
    });
    if (runBuf.length) {
      var bclr = el('button', 'btn danger', 'Belleği boşalt');
      bclr.onclick = function () {
        if (!confirm('Bu oturumdaki ' + runBuf.length + ' deneme bellekten silinecek. Devam?')) return;
        runBuf = []; curRunId = null; renderRunBadge(); closeModal();
        toast('Geçici bellek boşaltıldı');
      };
      foot.appendChild(bclr);
    }
    var bc = el('button', 'btn', 'Kapat');
    bc.onclick = closeModal;
    foot.appendChild(bc);
  });
}

function askRegenerate() {
  var nLock = state.schedule.filter(function (c) { return c.locked; }).length;
  if (!state.schedule.length) { snapshotAuto(); regenerate(false); return; }
  openModal('🔄 Programı yeniden oluştur', function (body, foot) {
    body.appendChild(h('<div class="hint">Program <b>sıfırdan</b> üretilir: dersler tamamen farklı saatlere ' +
      'gelebilir ve sınıfların kullandığı “Gelebilir” günler yeniden seçilir. Mevcut programın otomatik bir ' +
      'kayıt noktası alınır, dilediğinizde geri dönebilirsiniz.</div>'));
    body.appendChild(h('<div class="card soft" style="margin-top:12px"><b>' + nLock +
      '</b> kilitli ders saati ve <b>' + state.etuts.length +
      '</b> etüt var. Etütler her zaman korunur.</div>'));
    var b2 = el('button', 'btn primary', nLock ? 'Kilitleri de sıfırla — tamamen değiştir' : 'Tamamen değiştir');
    b2.onclick = function () { closeModal(); snapshotAuto(); regenerate(false); };
    var b1 = el('button', 'btn', 'Kilitleri koru (' + nLock + ')');
    b1.onclick = function () { closeModal(); snapshotAuto(); regenerate(true); };
    var b3 = el('button', 'btn', 'Vazgeç');
    b3.onclick = closeModal;
    foot.appendChild(b3);
    if (nLock) foot.appendChild(b1);
    foot.appendChild(b2);
  });
}

/* ============================================================
   HAFIZA
   ============================================================ */
function snapshot(name, auto) {
  var snap = {
    id: 'S' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36),
    t: Date.now(), name: name, auto: !!auto,
    placed: state.schedule.length,
    total: state.curriculum.reduce(function (s, l) { return s + l.hours; }, 0),
    etuts: state.etuts.length,
    data: JSON.stringify({
      settings: state.settings, subjects: state.subjects, teachers: state.teachers, classes: state.classes,
      curriculum: state.curriculum, classDays: state.classDays, classSlots: state.classSlots,
      classBaseSlots: baseSlots(),
      teacherAvail: state.teacherAvail, teacherLeave: state.teacherLeave || {},
      schedule: state.schedule, etuts: state.etuts
    })
  };
  state.memory.snapshots.unshift(snap);
  var MAX = 25;
  if (state.memory.snapshots.length > MAX) {
    var autos = state.memory.snapshots.filter(function (s) { return s.auto; });
    while (state.memory.snapshots.length > MAX && autos.length) {
      var victim = autos.pop();
      state.memory.snapshots = state.memory.snapshots.filter(function (s) { return s !== victim; });
    }
    if (state.memory.snapshots.length > MAX) state.memory.snapshots.length = MAX;
  }
  logIt('💾 Kayıt noktası: ' + name);
  save();
  return snap;
}
function snapshotAuto() { snapshot('Yeniden oluşturma öncesi (otomatik)', true); }
function restoreSnapshot(id) {
  var s = state.memory.snapshots.filter(function (x) { return x.id === id; })[0];
  if (!s) return;
  if (!confirm('“' + s.name + '” kaydına dönülecek. Şu anki durum için önce otomatik kayıt alınır. Devam?')) return;
  snapshot('Geri yükleme öncesi (otomatik)', true);
  var d = JSON.parse(s.data);
  Object.keys(d).forEach(function (k) { state[k] = d[k]; });
  if (!d.classBaseSlots) state.classBaseSlots = JSON.parse(JSON.stringify(state.classSlots));
  lastRun = null;
  logIt('↩ Kayıt noktasına dönüldü: ' + s.name);
  closeModal();
  refresh();
  toast('“' + s.name + '” geri yüklendi', 'ok');
}
function openMemory() {
  openModal('💾 Hafıza — kayıt noktaları ve işlem günlüğü', function (body, foot) {
    var bar = el('div', 'bar');
    var inp = el('input'); inp.type = 'text'; inp.placeholder = 'Kayıt adı… (örn. “Cumartesi denemesi 2”)';
    inp.style.flex = '1'; inp.style.minWidth = '200px';
    var b = el('button', 'btn primary', '💾 Şu anki durumu kaydet');
    b.onclick = function () {
      var n = inp.value.trim() || ('Kayıt · ' + fmtDate(Date.now()));
      snapshot(n, false); closeModal(); openMemory();
      toast('Kaydedildi: ' + n, 'ok');
    };
    bar.appendChild(inp); bar.appendChild(b);
    body.appendChild(bar);
    body.appendChild(h('<h3 style="font-size:13px;color:var(--accent2);margin:14px 0 8px">Kayıt noktaları (' +
      state.memory.snapshots.length + ')</h3>'));
    if (!state.memory.snapshots.length) body.appendChild(h('<div class="hint">Henüz kayıt yok.</div>'));
    state.memory.snapshots.forEach(function (s) {
      var row = el('div', 'snap');
      row.appendChild(h('<div class="n"><b>' + esc(s.name) +
        (s.auto ? ' <span class="chip">otomatik</span>' : '') + '</b><span>' + esc(fmtDate(s.t)) + ' · ' +
        s.placed + '/' + s.total + ' saat · ' + s.etuts + ' etüt</span></div>'));
      var br = el('button', 'btn sm', '↩ Geri yükle');
      br.onclick = function () { restoreSnapshot(s.id); };
      var bd2 = el('button', 'btn sm danger', '✕');
      bd2.title = 'Kaydı sil';
      bd2.onclick = function () {
        state.memory.snapshots = state.memory.snapshots.filter(function (x) { return x.id !== s.id; });
        save(); closeModal(); openMemory();
      };
      row.appendChild(br); row.appendChild(bd2);
      body.appendChild(row);
    });
    body.appendChild(h('<h3 style="font-size:13px;color:var(--accent2);margin:16px 0 8px">İşlem günlüğü</h3>'));
    var log = el('div', 'log');
    if (!state.memory.log.length) log.appendChild(h('<div class="hint" style="padding:10px">Kayıt yok.</div>'));
    state.memory.log.slice(0, 150).forEach(function (l) {
      log.appendChild(h('<div><time>' + esc(fmtDate(l.t)) + '</time><span>' + esc(l.m) + '</span></div>'));
    });
    body.appendChild(log);
    var bc = el('button', 'btn', 'Kapat');
    bc.onclick = closeModal;
    foot.appendChild(bc);
  });
}

/* ---------------- kip ---------------- */
var modalEl = null;
function openModal(title, build) {
  closeModal();
  var mask = el('div', 'mask');
  mask.onclick = function (e) { if (e.target === mask) closeModal(); };
  var m = el('div', 'modal');
  var hd = el('header');
  hd.appendChild(h('<h3>' + esc(title) + '</h3>'));
  var x = el('button', 'btn sm', '✕');
  x.onclick = closeModal;
  hd.appendChild(x);
  var body = el('div', 'body'), foot = el('footer');
  m.appendChild(hd); m.appendChild(body); m.appendChild(foot);
  mask.appendChild(m);
  document.body.appendChild(mask);
  modalEl = mask;
  build(body, foot);
  return m;
}
function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

/* Takvim → 🗓 Tek program: ← / → ile önceki-sonraki kayda geç */
document.addEventListener('keydown', function (e) {
  if (tab !== 'takvim' || ui.calView !== 'one') return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  var t = e.target || {};
  var tg = (t.tagName || '').toLowerCase();
  if (tg === 'input' || tg === 'select' || tg === 'textarea' || t.isContentEditable) return;
  if (modalEl) return;
  var list = calRowList();
  if (!list.length) return;
  var idx = 0, i;
  for (i = 0; i < list.length; i++) if (list[i].id === ui.calDetail) idx = i;
  ui.calDetail = list[(idx + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length].id;
  e.preventDefault();
  render();
});

/* ============================================================
   YEDEK / RAPOR / SIFIRLA
   ============================================================ */
function exportJson() {
  var blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
  var a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ders-programi-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  logIt('⬇ JSON yedek indirildi'); save();
  toast('Yedek indirildi', 'ok');
}
function importJson(file) {
  var fr = new FileReader();
  fr.onload = function () {
    try {
      var d = JSON.parse(fr.result);
      if (!d || !d.settings || !d.classes || !d.curriculum) {
        throw new Error('Beklenen alanlar yok (settings / classes / curriculum)');
      }
      snapshot('İçe aktarma öncesi (otomatik)', true);
      var keep = state.memory.snapshots;
      state = d;
      state.memory = state.memory || { snapshots: [], log: [] };
      state.memory.snapshots = keep;
      migrate();
      lastRun = null;
      logIt('⬆ JSON yedek yüklendi: ' + file.name);
      refresh();
      toast('Yedek yüklendi: ' + file.name, 'ok');
    } catch (e) { toast('Yedek okunamadı — ' + e.message, 'err'); }
  };
  fr.onerror = function () { toast('Dosya okunamadı', 'err'); };
  fr.readAsText(file);
}
function resetAll() {
  if (!confirm('Tüm veriler örnek veriye dönecek. Kayıt noktaları da silinir. Devam?')) return;
  state = freshState();
  lastRun = null;
  logIt('🗑 Örnek veriye dönüldü');
  refresh(false);
  regenerate(false);
}

/** Tek sınıfın / öğretmenin haftalık programını tek sayfa olarak yazdırır */
function printOne(mode, id) {
  var r = document.getElementById('report');
  var ok = mode === 'sinif' ? view.maps.classOk[id] : view.maps.teachOk[id];
  var occ = {};
  view.cards.forEach(function (c) {
    if ((mode === 'sinif' ? c.classId : c.teacherId) === id) occ[c.day + '_' + c.period] = c;
  });
  var days = activeDayList().filter(function (d) {
    for (var p = 1; p <= P; p++) if (ok[E.si(d, p)] || occ[d + '_' + p]) return true;
    return false;
  });
  var out = '<h2>' + esc(mode === 'sinif' ? cname(id) : tname(id)) + ' — Haftalık Program</h2>' +
    '<div class="meta">' + esc(fmtDate(Date.now())) + ' · 2026-2027</div><table><tr><th>Gün</th>';
  for (var p0 = 1; p0 <= P; p0++) {
    out += '<th>' + p0 + '.<br>' + esc(E.timeLabel(state.settings, days[0] || 1, p0)) + '</th>';
  }
  out += '</tr>';
  days.forEach(function (d) {
    out += '<tr><th>' + esc(DS[d - 1]) + '</th>';
    for (var p = 1; p <= P; p++) {
      var k = occ[d + '_' + p];
      var other = k ? (mode === 'sinif' ? tshort(k.teacherId) : cname(k.classId)) : '';
      out += '<td>' + (k ? (k.kind === 'etut' ? 'ETÜT<br>' + esc(other)
        : esc(sshort(k.subjectId)) + '<br>' + esc(other)) : '') + '</td>';
    }
    out += '</tr>';
  });
  out += '</table>';
  r.innerHTML = out;
  setTimeout(function () { window.print(); }, 60);
}

function buildReport() {
  var r = document.getElementById('report');
  var total = state.curriculum.reduce(function (s, l) { return s + l.hours; }, 0);
  var days = activeDayList();
  var out = '<h2>Haftalık Ders Programı — 2026-2027</h2>' +
    '<div class="meta">Oluşturma: ' + esc(fmtDate(Date.now())) + ' · ' + state.schedule.length + '/' + total +
    ' ders saati · ' + state.etuts.length + ' etüt · ' + state.classes.length + ' sınıf · ' +
    state.teachers.length + ' öğretmen</div>';
  var occ = {};
  view.cards.forEach(function (c) { occ[c.classId + '_' + c.day + '_' + c.period] = c; });

  state.classes.forEach(function (c) {
    var has = false;
    for (var s = 0; s < E.NSLOT; s++) if (view.maps.classOk[c.id][s]) { has = true; break; }
    if (!has) return;
    out += '<div class="cw"><h3>' + esc(c.name) + '</h3><table><tr><th>Gün</th>';
    for (var p = 1; p <= P; p++) out += '<th>' + p + '.</th>';
    out += '</tr>';
    days.forEach(function (d) {
      var any = false;
      for (var p2 = 1; p2 <= P; p2++) {
        if (view.maps.classOk[c.id][E.si(d, p2)] || occ[c.id + '_' + d + '_' + p2]) any = true;
      }
      if (!any) return;
      out += '<tr><th>' + esc(DS[d - 1]) + '</th>';
      for (var p3 = 1; p3 <= P; p3++) {
        var k = occ[c.id + '_' + d + '_' + p3];
        out += '<td>' + (k ? (k.kind === 'etut' ? 'ETÜT<br>' + esc(tshort(k.teacherId))
          : esc(sshort(k.subjectId)) + '<br>' + esc(tshort(k.teacherId))) : '') + '</td>';
      }
      out += '</tr>';
    });
    out += '</table></div>';
  });

  /* --- öğretmen haftalık programları --- */
  var tocc = {};
  view.cards.forEach(function (c) { tocc[c.teacherId + '_' + c.day + '_' + c.period] = c; });
  out += '<div class="pb"></div><h2>Öğretmen Haftalık Programları</h2>';
  state.teachers.forEach(function (tc) {
    var has = false;
    for (var s = 0; s < E.NSLOT; s++) if (view.maps.teachOk[tc.id][s]) { has = true; break; }
    if (!has) return;
    out += '<div class="cw"><h3>' + esc(tc.name) + '</h3><table><tr><th>Gün</th>';
    for (var p = 1; p <= P; p++) out += '<th>' + p + '.</th>';
    out += '</tr>';
    days.forEach(function (d) {
      var any = false;
      for (var p2 = 1; p2 <= P; p2++) {
        if (view.maps.teachOk[tc.id][E.si(d, p2)] || tocc[tc.id + '_' + d + '_' + p2]) any = true;
      }
      if (!any) return;
      out += '<tr><th>' + esc(DS[d - 1]) + '</th>';
      for (var p3 = 1; p3 <= P; p3++) {
        var k = tocc[tc.id + '_' + d + '_' + p3];
        out += '<td>' + (k ? (k.kind === 'etut' ? 'ETÜT<br>' + esc(cname(k.classId))
          : esc(sshort(k.subjectId)) + '<br>' + esc(cname(k.classId))) : '') + '</td>';
      }
      out += '</tr>';
    });
    out += '</table></div>';
  });

  out += '<div class="pb"></div><h2>Öğretmen Boş Saatleri</h2>' +
    '<div class="meta">Ara boşluk = öğretmenin ilk ve son dersi arasında kalan boş saatler (etüt için uygun)</div>' +
    '<table><tr><th>Öğretmen</th><th>Ders</th><th>Müsait</th><th>Ara boşluk</th><th>Uç boşluk</th>' +
    '<th>Günlere göre boş saat</th></tr>';
  state.teachers.map(function (t) { return { t: t, g: view.gaps[t.id] }; })
    .sort(function (a, b) { return b.g.inner - a.g.inner; })
    .forEach(function (r2) {
      var per = days.map(function (d) {
        var dd = r2.g.days[d], f = dd.inner + dd.edge;
        return f ? DS[d - 1] + ':' + f + (dd.inner ? '(' + dd.inner + ' ara)' : '') : '';
      }).filter(Boolean).join(' · ');
      out += '<tr><td>' + esc(r2.t.name) + '</td><td>' + r2.g.busy + '</td><td>' + (r2.g.busy + r2.g.free) +
        '</td><td>' + r2.g.inner + '</td><td>' + r2.g.edge + '</td><td>' + esc(per) + '</td></tr>';
    });
  out += '</table>';

  if (state.etuts.length) {
    out += '<div class="pb"></div><h2>Etüt / Özel Ders Programı</h2><table>' +
      '<tr><th>Gün</th><th>Saat</th><th>Öğretmen</th><th>Sınıf</th><th>Öğrenci</th><th>Ders</th><th>Not</th></tr>';
    state.etuts.slice().sort(function (a, b) { return a.day - b.day || a.period - b.period; }).forEach(function (e) {
      out += '<tr><td>' + esc(DS[e.day - 1]) + '</td><td>' + e.period + '. · ' +
        esc(E.timeLabel(state.settings, e.day, e.period)) + '</td><td>' + esc(tname(e.teacherId)) +
        '</td><td>' + esc(cname(e.classId)) + '</td><td>' + esc(e.student || '') + '</td><td>' +
        esc(e.subjectId ? sname(e.subjectId) : '') + '</td><td>' + esc(e.note || '') + '</td></tr>';
    });
    out += '</table>';
  }
  r.innerHTML = out;
}

/* ============================================================
   AÇILIŞ
   ============================================================ */
function migrate() {
  var st = state.settings;
  if (!st.etutWindow) st.etutWindow = { weekday: { from: 10, to: 12 }, weekend: { from: 1, to: 12 } };
  if (st.maxOptionalDays == null) st.maxOptionalDays = 1;
  if (st.sessionShift == null) st.sessionShift = true;   /* boşluk kalmasın diye oturum değiştirilebilir */
  /* sınıfın geldiği oturumlar (kaynak) — classSlots bunun programa göre daraltılmış hâlidir */
  if (!state.classBaseSlots) state.classBaseSlots = JSON.parse(JSON.stringify(state.classSlots));
  if (!st.classGroups) st.classGroups = [];
  if (!state.memory) state.memory = { snapshots: [], log: [] };
  if (!state.etuts) state.etuts = [];
  if (!state.schedule) state.schedule = [];
  if (!state.teacherLeave) state.teacherLeave = {};   /* kapatılan günlerin saklanan saatleri */
}

document.getElementById('bGen').onclick = askRegenerate;
document.getElementById('bRuns').onclick = openRuns;
document.getElementById('bMem').onclick = openMemory;
document.getElementById('bExp').onclick = exportJson;
document.getElementById('bImp').onclick = function () { document.getElementById('fileIn').click(); };
document.getElementById('fileIn').onchange = function (e) {
  if (e.target.files && e.target.files[0]) importJson(e.target.files[0]);
  e.target.value = '';
};
document.getElementById('bRep').onclick = function () {
  buildReport();
  setTimeout(function () { window.print(); }, 60);
};
document.getElementById('bReset').onclick = resetAll;

(function boot() {
  state = load() || freshState();
  migrate();
  refresh(false);
  if (!state.schedule.length) {
    logIt('▶ İlk açılış — örnek veriden program üretiliyor');
    regenerate(false);
  } else {
    render();
    toast('Kaydedilmiş çalışmanız yüklendi (' + state.schedule.length + ' ders saati)');
  }
})();
