/* ================= ENGINE START =================
   Ders programı çizelgeleme + tanılama çekirdeği.
   DOM'a dokunmaz; hem tarayıcıda hem Node'da aynı kodla çalışır.
   ================================================= */

var ENGINE = (function () {
  'use strict';

  var P = 12;                    // gün içi ders saati sayısı
  var DAYS = [1, 2, 3, 4, 5, 6, 7];
  var NSLOT = 7 * P;             // 84

  var si = function (d, p) { return (d - 1) * P + (p - 1); };   // slot index
  var sd = function (s) { return Math.floor(s / P) + 1; };      // slot -> gün
  var sp = function (s) { return (s % P) + 1; };                // slot -> ders saati

  /* ---------- deterministik RNG (mulberry32) ---------- */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = (rnd() * (i + 1)) | 0; var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ---------- band'ler ---------- */
  function isWeekend(d) { return d === 6 || d === 7; }
  function bandsOf(st, d) { return isWeekend(d) ? st.weekendBands : st.weekdayBands; }
  function bandOf(st, d, p) {
    var bs = bandsOf(st, d);
    for (var i = 0; i < bs.length; i++) if (p >= bs[i].from && p <= bs[i].to) return bs[i];
    return null;
  }
  /** Ders yerleşebilir band mi? (hafta içi 7-9 etüt arası yerleşmez) */
  function lessonBand(st, d, p) {
    var b = bandOf(st, d, p);
    return b && !b.noLesson ? b : null;
  }
  function timeLabel(st, d, p) {
    var arr = isWeekend(d) ? st.weekendTimes : st.weekdayTimes;
    return arr[p - 1] || '';
  }

  function unpackDay(str) {
    var a = new Uint8Array(P);
    for (var i = 0; i < P; i++) a[i] = str && str.charCodeAt(i) === 49 ? 1 : 0;
    return a;
  }
  function packDay(arr) {
    var s = '';
    for (var i = 0; i < P; i++) s += arr[i] ? '1' : '0';
    return s;
  }

  /* =========================================================
     1) Müsaitlik haritaları
     ========================================================= */
  /**
   * classOk[cid] : Uint8Array(84) — 0 yok, 1 "Geliyor" (kesin), 2 "Gelebilir" (çözücü seçer)
   * teachOk[tid] : Uint8Array(84) — 0/1
   */
  function buildMaps(data) {
    var st = data.settings, classOk = {}, teachOk = {}, i, c, t, d, p;

    for (i = 0; i < data.classes.length; i++) {
      c = data.classes[i];
      var arr = new Uint8Array(NSLOT);
      var days = data.classDays[c.id] || [];
      var slots = data.classSlots[c.id] || {};
      for (var di = 0; di < DAYS.length; di++) {
        d = DAYS[di];
        var stat = days[d - 1] | 0;
        if (!stat || !st.activeDays[d - 1]) continue;
        var bits = unpackDay(slots[d]);
        for (p = 1; p <= P; p++) {
          if (!bits[p - 1] || !lessonBand(st, d, p)) continue;
          arr[si(d, p)] = stat;
        }
      }
      classOk[c.id] = arr;
    }

    for (i = 0; i < data.teachers.length; i++) {
      t = data.teachers[i];
      var ta = new Uint8Array(NSLOT);
      var tsl = data.teacherAvail[t.id] || {};
      for (var dj = 0; dj < DAYS.length; dj++) {
        d = DAYS[dj];
        if (!st.activeDays[d - 1]) continue;
        var tb = unpackDay(tsl[d]);
        for (p = 1; p <= P; p++) {
          if (!tb[p - 1] || !lessonBand(st, d, p)) continue;
          ta[si(d, p)] = 1;
        }
      }
      teachOk[t.id] = ta;
    }
    return { classOk: classOk, teachOk: teachOk };
  }

  function classLoad(data) {
    var o = {};
    for (var i = 0; i < data.curriculum.length; i++) {
      var L = data.curriculum[i];
      o[L.classId] = (o[L.classId] || 0) + L.hours;
    }
    return o;
  }
  function teacherLoad(data) {
    var o = {};
    for (var i = 0; i < data.curriculum.length; i++) {
      var L = data.curriculum[i];
      o[L.teacherId] = (o[L.teacherId] || 0) + L.hours;
    }
    return o;
  }

  /* =========================================================
     2) "Gelebilir" günlerin seçimi  —  çözücünün kararı
     -----------------------------------------------------------
     Bir sınıfın kesin ("Geliyor") günleri haftalık yüküne yetmiyorsa,
     eksik saatler için "Gelebilir" günlerinden EN AZ sayıda gün seçilir.
     Hangi gün seçilecek? O sınıfın derslerini veren öğretmenlerin
     o gün en çok müsait olduğu gün. Aynı gün başka sınıflarca da
     seçildiyse ceza uygulanır → paralel sınıflar farklı günlere dağılır.
     ========================================================= */
  function resolveClassDays(data, maps, rnd, opts) {
    var st = data.settings;
    var maxOpt = st.maxOptionalDays == null ? 1 : st.maxOptionalDays;
    var load = classLoad(data);
    var lessonsBy = {};
    for (var i = 0; i < data.curriculum.length; i++) {
      (lessonsBy[data.curriculum[i].classId] ??= []).push(data.curriculum[i]);
    }
    var activeOk = {}, chosen = {}, dayUse = {}, overflow = [];
    var order = shuffled(data.classes, rnd);

    /** o gün, sınıfın derslerini veren öğretmenler ne kadar müsait? */
    function dayScore(cid, d, optSlots) {
      var ls = lessonsBy[cid] || [], sum = 0;
      for (var k = 0; k < ls.length; k++) {
        var to = maps.teachOk[ls[k].teacherId];
        if (!to) continue;
        for (var q = 0; q < optSlots.length; q++) if (to[optSlots[q]]) sum += ls[k].hours;
      }
      return sum;
    }

    /* ---------------------------------------------------------
       Sınıfın geliş penceresini haftalık yüküne göre daraltır —
       "sınıfın boş saati olmasın" kuralı burada kurulur.

       · Kesin ("Geliyor") günlerin kapasitesi yükten BÜYÜKSE yük bu
         günlere eşit bölünür ve her gün oturumun EN ERKEN saatinden
         başlar. (Hafta içi gelen mezun: 20 saat / 4 gün → her gün
         1-5. ders.)
       · Kapasite yüke eşit ya da küçükse kesin günler bütün hâlinde
         dolu kalır (hafta sonu 6 saat = oturumun tamamı), artan
         saatler seçilen "Gelebilir" güne gider.

       Böylece kapasite = yük olur: çözücünün pencerede bırakacağı
       boş saat kalmaz, "saat dışı" hücreleri oluşmaz.
       --------------------------------------------------------- */
    function trimToLoad(cid, arr, optDays, need) {
      var byDay = {}, s, d;
      for (s = 0; s < NSLOT; s++) if (arr[s]) (byDay[sd(s)] ??= []).push(s);
      var days = Object.keys(byDay).map(Number);
      if (!days.length || !need) return;
      days.forEach(function (dd) { byDay[dd].sort(function (a, b) { return a - b; }); });
      var isOpt = {};
      (optDays || []).forEach(function (dd) { isOpt[dd] = 1; });
      var mand = days.filter(function (dd) { return !isOpt[dd]; });
      var opt = days.filter(function (dd) { return isOpt[dd]; }).sort(function (a, b) { return a - b; });
      var keep = {}, mandCap = mand.reduce(function (a, dd) { return a + byDay[dd].length; }, 0);

      if (need >= mandCap) {
        mand.forEach(function (dd) { keep[dd] = byDay[dd].length; });
        var rest = need - mandCap;
        opt.forEach(function (dd) {
          var take = Math.min(rest, byDay[dd].length);
          keep[dd] = take; rest -= take;
        });
      } else {
        // yükü kesin günlere dengeli dağıt (kapasitesi küçük gün önce)
        var ord = mand.slice().sort(function (a, b) { return byDay[a].length - byDay[b].length; });
        var left = need, n = ord.length;
        ord.forEach(function (dd) {
          var take = Math.min(Math.ceil(left / n), byDay[dd].length);
          keep[dd] = take; left -= take; n--;
        });
        opt.forEach(function (dd) { keep[dd] = 0; });
      }
      days.forEach(function (dd) {
        var list = byDay[dd], k = keep[dd] || 0;
        for (var z = k; z < list.length; z++) arr[list[z]] = 0;
      });
      // hiç saat kalmayan "Gelebilir" günü seçilmiş sayma
      if (optDays && optDays.length) {
        for (var oi = optDays.length - 1; oi >= 0; oi--) if (!keep[optDays[oi]]) optDays.splice(oi, 1);
      }
    }

    for (var ci = 0; ci < order.length; ci++) {
      var c = order[ci], ok = maps.classOk[c.id];
      if (!ok) { activeOk[c.id] = new Uint8Array(NSLOT); chosen[c.id] = []; continue; }
      var arr = new Uint8Array(NSLOT), optByDay = {}, mandCap = 0, s;
      for (s = 0; s < NSLOT; s++) {
        if (ok[s] === 1) { arr[s] = 1; mandCap++; }
        else if (ok[s] === 2) (optByDay[sd(s)] ??= []).push(s);
      }
      chosen[c.id] = [];
      var deficit = (load[c.id] || 0) - mandCap;
      var cands = Object.keys(optByDay).map(Number).map(function (d) {
        return { d: d, cap: optByDay[d].length, sc: dayScore(c.id, d, optByDay[d]) };
      });
      // puanla: öğretmen müsaitliği + kapasite − başka sınıfların o günü doldurması
      cands.forEach(function (x) {
        x.score = x.sc * 2 + x.cap - (dayUse[x.d] || 0) * 14 + rnd() * 9;
      });
      cands.sort(function (a, b) { return b.score - a.score; });

      var used = 0;
      while (deficit > 0 && used < cands.length) {
        if (chosen[c.id].length >= maxOpt) {
          // sınır aşılmak zorunda: yoksa program hiç çıkmaz
          overflow.push({ classId: c.id, need: deficit });
        }
        var cd = cands[used++];
        chosen[c.id].push(cd.d);
        for (var z = 0; z < optByDay[cd.d].length; z++) arr[optByDay[cd.d][z]] = 2;
        deficit -= cd.cap;
        dayUse[cd.d] = (dayUse[cd.d] || 0) + 1;
      }
      trimToLoad(c.id, arr, chosen[c.id], load[c.id] || 0);
      activeOk[c.id] = arr;
    }
    return { activeOk: activeOk, chosen: chosen, overflow: overflow };
  }

  /** Tanılama için: sınıfın en iyi durumda ulaşabileceği kapasite */
  function classCapacity(data, maps, cid) {
    var st = data.settings;
    var maxOpt = st.maxOptionalDays == null ? 1 : st.maxOptionalDays;
    var ok = maps.classOk[cid];
    if (!ok) return { mandatory: 0, optional: 0, total: 0, optionalDays: [] };
    var mand = 0, byDay = {};
    for (var s = 0; s < NSLOT; s++) {
      if (ok[s] === 1) mand++;
      else if (ok[s] === 2) byDay[sd(s)] = (byDay[sd(s)] || 0) + 1;
    }
    var days = Object.keys(byDay).map(Number).sort(function (a, b) { return byDay[b] - byDay[a]; });
    var take = days.slice(0, maxOpt);
    var optCap = take.reduce(function (a, d) { return a + byDay[d]; }, 0);
    return { mandatory: mand, optional: optCap, total: mand + optCap,
             optionalDays: days, optionalByDay: byDay, usableDays: take };
  }

  /* =========================================================
     3) Blok ayrıştırma
     ========================================================= */
  /**
   * pref=2, max=3 için: 1→[1] · 2→[2] · 3→[2,1] · 4→[2,2] · 5→[3,2] · 6→[2,2,2] · 7→[3,2,2]
   */
  function splitBlocks(hours, pref, max) {
    pref = Math.max(1, Math.min(pref, max));
    if (hours <= 0) return [];
    if (hours <= pref) return [hours];
    var n = Math.floor(hours / pref), r = hours - n * pref, out = [], i;
    for (i = 0; i < n; i++) out.push(pref);
    if (r > 0) {
      if (out.length >= 2 && out[0] + r <= max) out[0] += r;
      else out.push(r);
    }
    out.sort(function (a, b) { return b - a; });
    return out;
  }

  /* =========================================================
     4) Blok listesi + statik alan (domain)
     ========================================================= */
  function buildBlocks(data, maps, activeOk, fixed) {
    var st = data.settings, blocks = [];
    var cFix = {}, tFix = {};
    for (var i = 0; i < data.classes.length; i++) cFix[data.classes[i].id] = new Uint8Array(NSLOT);
    for (var j = 0; j < data.teachers.length; j++) tFix[data.teachers[j].id] = new Uint8Array(NSLOT);
    for (var k = 0; k < fixed.length; k++) {
      var f = fixed[k], s = si(f.day, f.period);
      if (cFix[f.classId]) cFix[f.classId][s] = 1;
      if (tFix[f.teacherId]) tFix[f.teacherId][s] = 1;
    }
    var lockedHours = {}, lFix = {};
    for (var m = 0; m < fixed.length; m++) {
      if (fixed[m].kind === 'lesson' && fixed[m].lessonId) {
        lockedHours[fixed[m].lessonId] = (lockedHours[fixed[m].lessonId] || 0) + 1;
        /* kilitli saatler de ardışıklık hesabına girsin */
        (lFix[fixed[m].lessonId] || (lFix[fixed[m].lessonId] = new Uint8Array(NSLOT)))
          [si(fixed[m].day, fixed[m].period)] = 1;
      }
    }

    for (var li = 0; li < data.curriculum.length; li++) {
      var L = data.curriculum[li];
      var need = L.hours - (lockedHours[L.id] || 0);
      if (need <= 0) continue;
      var co = activeOk[L.classId], to = maps.teachOk[L.teacherId];
      if (!co || !to) continue;
      var parts = splitBlocks(need, st.preferredBlock, st.maxBlock);

      var okDays = {};
      for (var s2 = 0; s2 < NSLOT; s2++) if (co[s2] && to[s2]) okDays[sd(s2)] = 1;
      var nDays = Object.keys(okDays).length;

      // Blok sayısı müsait gün sayısını aşarsa saatleri gün sayısına göre yeniden böl:
      // gün başına tek ardışık blok düşsün ("1. ders + 5. ders" dağınıklığı olmasın).
      var relaxDay = false;
      if (nDays >= 1 && parts.length > nDays) {
        var maxBand = 0;
        for (var s3 = 0; s3 < NSLOT; s3++) {
          if (!co[s3] || !to[s3]) continue;
          var bb = lessonBand(st, sd(s3), sp(s3));
          if (bb) maxBand = Math.max(maxBand, bb.to - bb.from + 1);
        }
        if (Math.ceil(need / nDays) <= maxBand) {
          parts = [];
          var rem = need, left = nDays;
          while (left > 0) { var piece = Math.ceil(rem / left); parts.push(piece); rem -= piece; left--; }
          parts = parts.filter(function (x) { return x > 0; });
          parts.sort(function (a, b) { return b - a; });
        } else relaxDay = true;
      }

      for (var pi = 0; pi < parts.length; pi++) {
        var len = parts[pi], dom = [];
        for (var d = 1; d <= 7; d++) {
          for (var p = 1; p + len - 1 <= P; p++) {
            var band = lessonBand(st, d, p);
            if (!band || p + len - 1 > band.to) continue;
            var good = true, maybe = 0;
            for (var q = 0; q < len; q++) {
              var sx = si(d, p + q);
              if (!co[sx] || !to[sx] || cFix[L.classId][sx] || tFix[L.teacherId][sx]) { good = false; break; }
              if (co[sx] === 2) maybe++;
            }
            if (good) dom.push({ s: si(d, p), maybe: maybe });
          }
        }
        blocks.push({
          i: blocks.length, lessonId: L.id, classId: L.classId, teacherId: L.teacherId,
          subjectId: L.subjectId, len: len, dom: dom, relaxDay: relaxDay, at: -1,
        });
      }
    }
    return { blocks: blocks, cFix: cFix, tFix: tFix, lFix: lFix };
  }

  /* =========================================================
     5) Yerleştirme — MRV greedy + çıkarma (ejection) onarımı
     ========================================================= */
  function solve(data, maps, activeOk, built, seed, opts) {
    var rnd = rng(seed);
    var blocks = built.blocks;
    var cOcc = {}, tOcc = {}, i, b, s;
    for (i = 0; i < data.classes.length; i++) cOcc[data.classes[i].id] = new Int32Array(NSLOT).fill(-1);
    for (i = 0; i < data.teachers.length; i++) tOcc[data.teachers[i].id] = new Int32Array(NSLOT).fill(-1);
    for (i = 0; i < data.classes.length; i++) {
      var cid = data.classes[i].id;
      for (s = 0; s < NSLOT; s++) if (built.cFix[cid][s]) cOcc[cid][s] = -2;
    }
    for (i = 0; i < data.teachers.length; i++) {
      var tid = data.teachers[i].id;
      for (s = 0; s < NSLOT; s++) if (built.tFix[tid][s]) tOcc[tid][s] = -2;
    }
    var lessonDay = {};
    var dayKey = function (lid, d) { return lid + '#' + d; };

    /* Aynı dersin dolu saatleri — aynı güne birden çok blok düşerse
       bunların arka arkaya gelmesini teşvik etmek için tutulur. */
    var lSlots = {};
    function lset(lid) { return lSlots[lid] || (lSlots[lid] = new Uint8Array(NSLOT)); }
    for (var lk in built.lFix) {
      var srcF = built.lFix[lk], dstF = lset(lk);
      for (s = 0; s < NSLOT; s++) if (srcF[s]) dstF[s] = 1;
    }

    function fits(b, s) {
      if (!b.relaxDay && lessonDay[dayKey(b.lessonId, sd(s))]) return false;
      for (var q = 0; q < b.len; q++) {
        if (cOcc[b.classId][s + q] !== -1) return false;
        if (tOcc[b.teacherId][s + q] !== -1) return false;
      }
      return true;
    }
    function blockers(b, s) {
      var out = {}, q, v;
      if (!b.relaxDay && lessonDay[dayKey(b.lessonId, sd(s))]) return null;
      for (q = 0; q < b.len; q++) {
        v = cOcc[b.classId][s + q]; if (v === -2) return null; if (v >= 0) out[v] = 1;
        v = tOcc[b.teacherId][s + q]; if (v === -2) return null; if (v >= 0) out[v] = 1;
      }
      return Object.keys(out).map(Number);
    }
    function put(b, s) {
      var lsp = lset(b.lessonId);
      for (var q = 0; q < b.len; q++) {
        cOcc[b.classId][s + q] = b.i; tOcc[b.teacherId][s + q] = b.i; lsp[s + q] = 1;
      }
      b.at = s;
      var kk = dayKey(b.lessonId, sd(s));
      lessonDay[kk] = (lessonDay[kk] || 0) + 1;
    }
    function pull(b) {
      if (b.at < 0) return;
      var lsp = lset(b.lessonId);
      for (var q = 0; q < b.len; q++) {
        cOcc[b.classId][b.at + q] = -1; tOcc[b.teacherId][b.at + q] = -1; lsp[b.at + q] = 0;
      }
      var kk = dayKey(b.lessonId, sd(b.at));
      lessonDay[kk] = (lessonDay[kk] || 1) - 1;
      if (!lessonDay[kk]) delete lessonDay[kk];
      b.at = -1;
    }
    function gapCount(tid, d) {
      var occ = tOcc[tid], first = -1, last = -1, p;
      for (p = 1; p <= P; p++) if (occ[si(d, p)] !== -1) { if (first < 0) first = p; last = p; }
      if (first < 0) return 0;
      var g = 0;
      for (p = first; p <= last; p++) if (occ[si(d, p)] === -1) g++;
      return g;
    }
    /* Sınıfın o gün ilk ve son dersi arasında kalan boş ders saatleri —
       öğrenci boşta beklemesin, dersler arka arkaya gelsin. */
    function clsGapCount(cid, d) {
      var occ = cOcc[cid], first = -1, last = -1, p;
      for (p = 1; p <= P; p++) if (occ[si(d, p)] !== -1) { if (first < 0) first = p; last = p; }
      if (first < 0) return 0;
      var g = 0;
      for (p = first; p <= last; p++) {
        if (occ[si(d, p)] === -1 && lessonBand(data.settings, d, p)) g++;
      }
      return g;
    }
    /* Aynı ders o güne ikinci kez düşüyorsa: bitişikse ödül, dağınıksa ceza.
       (relaxDay olmayan bloklarda fits() zaten aynı güne ikinciyi almaz.) */
    function contigScore(b, s) {
      var ls = lSlots[b.lessonId];
      if (!ls) return 0;
      var st = data.settings, d = sd(s), p0 = sp(s), p1 = sp(s + b.len - 1), p, any = false;
      for (p = 1; p <= P; p++) if (ls[si(d, p)]) { any = true; break; }
      if (!any) return 0;
      var bandL = lessonBand(st, d, p0), bandR = lessonBand(st, d, p1), nb;
      if (p0 > 1 && ls[s - 1]) {
        nb = lessonBand(st, d, p0 - 1);
        if (nb && bandL && nb.from === bandL.from) return -25;   // arka arkaya
      }
      if (p1 < P && ls[s + b.len]) {
        nb = lessonBand(st, d, p1 + 1);
        if (nb && bandR && nb.from === bandR.from) return -25;
      }
      return 150;                                                // aynı gün ama kopuk
    }
    function cost(b, s) {
      var d = sd(s), before = gapCount(b.teacherId, d), cBefore = clsGapCount(b.classId, d);
      var c = contigScore(b, s), q;
      for (q = 0; q < b.len; q++) if (activeOk[b.classId][s + q] === 2) c += 30;
      for (q = 0; q < b.len; q++) { tOcc[b.teacherId][s + q] = b.i; cOcc[b.classId][s + q] = b.i; }
      var after = gapCount(b.teacherId, d), cAfter = clsGapCount(b.classId, d);
      for (q = 0; q < b.len; q++) { tOcc[b.teacherId][s + q] = -1; cOcc[b.classId][s + q] = -1; }
      c += (after - before) * 8;
      c += (cAfter - cBefore) * 40;     // sınıfın gün içi boşluğu en ağır ceza
      c += rnd() * 6;
      return c;
    }

    // Faz A: MRV greedy
    var pend = blocks.slice();
    for (i = 0; i < pend.length; i++) pend[i]._k = rnd();
    pend.sort(function (x, y) { return (x.dom.length - y.dom.length) || (y.len - x.len) || (x._k - y._k); });

    var unplaced = [];
    for (i = 0; i < pend.length; i++) {
      b = pend[i];
      var best = -1, bestC = Infinity;
      for (var j = 0; j < b.dom.length; j++) {
        var s3 = b.dom[j].s;
        if (!fits(b, s3)) continue;
        var cc = cost(b, s3);
        if (cc < bestC) { bestC = cc; best = s3; }
      }
      if (best >= 0) put(b, best); else unplaced.push(b);
    }

    // Faz B: çıkarma (ejection chain) onarımı
    var maxSteps = (opts && opts.repairSteps) || 6000;
    var step = 0;
    function repair(limit) {
      var tabu = {}, end = step + limit;
      while (unplaced.length && step < end) {
        step++;
        var bi = (rnd() * unplaced.length) | 0;
        b = unplaced[bi];
        var direct = -1, dC = Infinity;
        for (var j2 = 0; j2 < b.dom.length; j2++) {
          var sA = b.dom[j2].s;
          if (!fits(b, sA)) continue;
          var c2 = cost(b, sA);
          if (c2 < dC) { dC = c2; direct = sA; }
        }
        if (direct >= 0) { put(b, direct); unplaced.splice(bi, 1); continue; }
        var pick = null, pickN = 99, pickBl = null;
        var order2 = shuffled(b.dom, rnd);
        for (var j3 = 0; j3 < order2.length; j3++) {
          var bl = blockers(b, order2[j3].s);
          if (!bl) continue;
          var pen = bl.length + (tabu[order2[j3].s + ':' + b.i] > step - 12 ? 3 : 0);
          if (pen < pickN) { pickN = pen; pick = order2[j3].s; pickBl = bl; if (pen <= 1) break; }
        }
        if (pick === null) { unplaced.splice(bi, 1); unplaced.push(b); if (step % 97 === 0) tabu = {}; continue; }
        for (var e = 0; e < pickBl.length; e++) { pull(blocks[pickBl[e]]); unplaced.push(blocks[pickBl[e]]); }
        unplaced = unplaced.filter(function (x) { return x !== b; });
        put(b, pick);
        tabu[pick + ':' + b.i] = step;
      }
    }
    repair(maxSteps);

    /* Faz B2 — son çare: hâlâ yerleşemeyen blok varsa o dersin
       "aynı güne ikinci blok konmaz" kuralı gevşetilir. Sınıfın günü
       tam dolmak zorunda olduğunda (kapasite = yük) bir dersin 2+1
       bloğu aynı güne arka arkaya gelerek 3 saatlik tek dizi oluşturur;
       aksi hâlde o günde 1 saat boş kalırdı. contigScore zaten bitişik
       yerleşimi ödüllendirdiği için dizi kopuk olmaz. */
    if (unplaced.length) {
      var relaxed = {};
      for (i = 0; i < unplaced.length; i++) relaxed[unplaced[i].lessonId] = 1;
      for (i = 0; i < blocks.length; i++) if (relaxed[blocks[i].lessonId]) blocks[i].relaxDay = true;
      repair(Math.max(2000, maxSteps >> 1));
    }
    /* Hâlâ açık varsa: sıkışan SINIFIN bütün dersleri için gevşet — günü tam
       doldurabilmek çoğu zaman o sınıfın başka bir dersinin bloklarını
       birleştirmeyi gerektirir. */
    if (unplaced.length) {
      var relaxC = {};
      for (i = 0; i < unplaced.length; i++) relaxC[unplaced[i].classId] = 1;
      for (i = 0; i < blocks.length; i++) if (relaxC[blocks[i].classId]) blocks[i].relaxDay = true;
      repair(Math.max(2000, maxSteps >> 1));
    }

    /* =========================================================
       Faz C: Sınıf günlerini sıkıştırma — gün içi boşluk kalmasın
       -----------------------------------------------------------
       Öğretmenlerin gün ve saatleri DEĞİŞMEZ; sadece sınıfın o gün
       hangi saatte gelmeye başladığı değişir. Bir sınıfın o günkü
       dersleri tek kesintisiz dizi hâline getirilir ve oturumun EN
       ERKEN saatinden başlatılır (hafta sonu 1. ders, akşam oturumunda
       10. ders). Gerekirse sınıf o gün öbür oturuma taşınır
       (öğleden önce ↔ öğleden sonra) — bu değişiklik geri bildirilir.
       ========================================================= */
    var shifts = [];

    /** cid sınıfının d günü [from..to] oturumunda yerleşmiş (taşınabilir) blokları */
    function movableOf(cid, d, from, to) {
      var out = [], ii, bb, pp;
      for (ii = 0; ii < blocks.length; ii++) {
        bb = blocks[ii];
        if (bb.classId !== cid || bb.at < 0 || sd(bb.at) !== d) continue;
        pp = sp(bb.at);
        if (pp < from || pp > to) continue;
        out.push(bb);
      }
      return out;
    }
    function canPut(bb, s, allow) {
      if (!bb.relaxDay && lessonDay[dayKey(bb.lessonId, sd(s))]) return false;
      var to2 = maps.teachOk[bb.teacherId];
      if (!to2) return false;
      for (var q3 = 0; q3 < bb.len; q3++) {
        var sx = s + q3;
        if (!allow[sp(sx)]) return false;
        if (!to2[sx]) return false;
        if (cOcc[bb.classId][sx] !== -1 || tOcc[bb.teacherId][sx] !== -1) return false;
      }
      return true;
    }
    /** list: doldurulacak saatler (artan). Blokları geri izlemeli olarak yerleştirir. */
    function fillRun(bl, used, list, idx, d, allow) {
      if (idx >= list.length) return true;
      var segLen = 1;
      while (idx + segLen < list.length && list[idx + segLen] === list[idx + segLen - 1] + 1) segLen++;
      for (var k = 0; k < bl.length; k++) {
        if (used[k] || bl[k].len > segLen) continue;
        var s0 = si(d, list[idx]);
        if (!canPut(bl[k], s0, allow)) continue;
        used[k] = 1; put(bl[k], s0);
        if (fillRun(bl, used, list, idx + bl[k].len, d, allow)) return true;
        pull(bl[k]); used[k] = 0;
      }
      return false;
    }
    /**
     * bl bloklarını d gününde [from..to] aralığına, allowPeriods saatlerini
     * kullanarak KESİNTİSİZ tek dizi hâlinde yerleştirir; en erken başlangıç
     * kazanır. Kilitli saatler (etüt / kilitli ders) dizinin içinde kalır.
     * Başarısızsa hiçbir şey değişmez.
     */
    function packInto(bl, d, from, to, allowPeriods, keepFixed) {
      var i3, p3, cid = bl[0].classId;
      var orig = bl.map(function (x) { return x.at; });
      var allow = {}, used = [];
      for (i3 = 0; i3 < allowPeriods.length; i3++) allow[allowPeriods[i3]] = 1;
      for (i3 = 0; i3 < bl.length; i3++) { pull(bl[i3]); used.push(0); }
      var fixedN = 0;
      if (keepFixed) {
        for (p3 = from; p3 <= to; p3++) if (cOcc[cid][si(d, p3)] === -2) fixedN++;
      }
      var need = bl.reduce(function (a, x) { return a + x.len; }, 0) + fixedN;
      for (var start = from; start + need - 1 <= to; start++) {
        var ok = true, cover = 0, list = [];
        for (p3 = start; p3 < start + need; p3++) {
          if (cOcc[cid][si(d, p3)] === -2) { cover++; continue; }
          if (!allow[p3] || cOcc[cid][si(d, p3)] !== -1) { ok = false; break; }
          list.push(p3);
        }
        if (!ok || cover !== fixedN) continue;
        if (fillRun(bl, used, list, 0, d, allow)) return true;
        for (i3 = 0; i3 < bl.length; i3++) { if (bl[i3].at >= 0) pull(bl[i3]); used[i3] = 0; }
      }
      for (i3 = 0; i3 < bl.length; i3++) if (orig[i3] >= 0) put(bl[i3], orig[i3]);
      return false;
    }
    /** Sınıfın her gününü kendi oturumu içinde sıkıştır */
    function compactClass(cid, onlyGapped) {
      var st2 = data.settings, d, bi, p3;
      for (d = 1; d <= 7; d++) {
        if (!st2.activeDays[d - 1]) continue;
        if (onlyGapped && !clsGapCount(cid, d)) continue;
        var bs = bandsOf(st2, d);
        for (bi = 0; bi < bs.length; bi++) {
          var band = bs[bi];
          if (band.noLesson) continue;
          var bl = movableOf(cid, d, band.from, band.to);
          if (!bl.length) continue;
          var allowP = [];
          for (p3 = band.from; p3 <= band.to; p3++) if (activeOk[cid][si(d, p3)]) allowP.push(p3);
          packInto(bl, d, band.from, band.to, allowP, true);
        }
      }
    }
    /** Hâlâ boşluk kalıyorsa sınıfı o gün öbür oturuma taşımayı dene */
    function shiftSessions(cid) {
      var st2 = data.settings, d, bi, bj, p3;
      for (d = 1; d <= 7; d++) {
        if (!st2.activeDays[d - 1] || !clsGapCount(cid, d)) continue;
        var hasFix = false;
        for (p3 = 1; p3 <= P; p3++) if (cOcc[cid][si(d, p3)] === -2) { hasFix = true; break; }
        if (hasFix) continue;                    // kilitli ders / etüt varsa oturum taşınmaz
        var bs = bandsOf(st2, d), done = false;
        for (bi = 0; bi < bs.length && !done; bi++) {
          var src = bs[bi];
          if (src.noLesson) continue;
          var bl = movableOf(cid, d, src.from, src.to);
          if (!bl.length) continue;
          var width = 0;
          for (p3 = src.from; p3 <= src.to; p3++) if (activeOk[cid][si(d, p3)]) width++;
          for (bj = 0; bj < bs.length && !done; bj++) {
            var dst = bs[bj];
            if (bj === bi || dst.noLesson) continue;
            var allowP = [];
            for (p3 = dst.from; p3 <= dst.to; p3++) if (lessonBand(st2, d, p3)) allowP.push(p3);
            if (!allowP.length) continue;
            if (packInto(bl, d, dst.from, dst.to, allowP, false)) {
              var take = Math.min(width || allowP.length, allowP.length), np = [];
              for (p3 = 0; p3 < take; p3++) np.push(allowP[p3]);
              for (p3 = 0; p3 < bl.length; p3++) {                 // yerleşen saatler pencerede kalsın
                for (var q4 = 0; q4 < bl[p3].len; q4++) {
                  var pp2 = sp(bl[p3].at + q4);
                  if (np.indexOf(pp2) < 0) np.push(pp2);
                }
              }
              np.sort(function (a, z) { return a - z; });
              // sınıfın o günkü müsaitliği yeni oturuma taşındı
              for (p3 = src.from; p3 <= src.to; p3++) activeOk[cid][si(d, p3)] = 0;
              for (p3 = 0; p3 < np.length; p3++) activeOk[cid][si(d, np[p3])] = 1;
              shifts.push({ classId: cid, day: d, fromLabel: src.label, toLabel: dst.label, periods: np });
              done = true;
            }
          }
        }
      }
    }

    var corder = shuffled(data.classes, rnd);
    for (i = 0; i < corder.length; i++) compactClass(corder[i].id, false);
    for (i = 0; i < corder.length; i++) compactClass(corder[i].id, true);
    if (!opts || opts.sessionShift !== false) {
      for (i = 0; i < corder.length; i++) shiftSessions(corder[i].id);
      for (i = 0; i < corder.length; i++) compactClass(corder[i].id, true);
    }

    var cards = [], missing = [];
    for (i = 0; i < blocks.length; i++) {
      b = blocks[i];
      if (b.at < 0) { missing.push(b); continue; }
      for (var q2 = 0; q2 < b.len; q2++) {
        cards.push({
          lessonId: b.lessonId, classId: b.classId, teacherId: b.teacherId, subjectId: b.subjectId,
          day: sd(b.at + q2), period: sp(b.at + q2), kind: 'lesson', locked: false,
          blockId: b.lessonId + 'b' + b.i, blockLen: b.len, blockPos: q2,
        });
      }
    }
    return { cards: cards, missing: missing, steps: step, seed: seed, shifts: shifts };
  }

  /* =========================================================
     6) Ana giriş
     ========================================================= */
  function generate(data, fixed, opts) {
    opts = opts || {};
    fixed = fixed || [];
    var t0 = Date.now();
    var maps = buildMaps(data);
    var attempts = Math.max(1, opts.attempts || data.settings.attempts || 20);
    var baseSeed = opts.seed != null ? opts.seed : ((Date.now() ^ (Math.random() * 1e9)) & 0x7fffffff);
    var best = null, tried = 0, minTries = Math.min(attempts, 6);

    for (var a = 0; a < attempts; a++) {
      var seed = (baseSeed + a * 7919) >>> 0;
      var rnd = rng(seed ^ 0x9e3779b9);
      var rc = resolveClassDays(data, maps, rnd, opts);
      var built = buildBlocks(data, maps, rc.activeOk, fixed);
      var r = solve(data, maps, rc.activeOk, built, seed, opts);
      tried++;
      var missHours = r.missing.reduce(function (s, b) { return s + b.len; }, 0);
      var optDayCount = 0, maybeUse = 0, i;
      for (var cid in rc.chosen) optDayCount += rc.chosen[cid].length;
      for (i = 0; i < r.cards.length; i++) {
        if (maps.classOk[r.cards[i].classId][si(r.cards[i].day, r.cards[i].period)] === 2) maybeUse++;
      }
      var gaps = teacherGapTotal(r.cards.concat(fixed));
      var frag = splitCount(data, r.cards.concat(fixed));
      var cgaps = classGapTotal(data, r.cards.concat(fixed));
      // Sınıfın gün içi boşluğu, eksik saatten sonraki EN AĞIR ölçüt:
      // boşluksuz bir program, biraz daha dağınık olsa bile tercih edilir.
      var score = missHours * 100000 + cgaps * 3000 + frag * 150 + optDayCount * 400 +
                  (r.shifts.length) * 120 + maybeUse * 20 + gaps * 3 + rnd() * 50;
      if (!best || score < best.score) {
        best = { score: score, cards: r.cards, missing: r.missing, missHours: missHours,
                 maybeUse: maybeUse, optDayCount: optDayCount, gaps: gaps, frag: frag,
                 cgaps: cgaps, seed: r.seed, shifts: r.shifts,
                 steps: r.steps, chosen: rc.chosen, overflow: rc.overflow, activeOk: rc.activeOk };
      }
      // boşluksuz ve eksiksiz bir program çıkana kadar denemeye devam
      if (missHours === 0 && cgaps === 0 && a + 1 >= minTries) break;
    }

    var diag = diagnose(data, maps, fixed, best);
    return {
      cards: best.cards,
      missing: best.missing.map(function (b) {
        return { lessonId: b.lessonId, classId: b.classId, teacherId: b.teacherId,
                 subjectId: b.subjectId, len: b.len, domSize: b.dom.length };
      }),
      optionalDays: best.chosen,
      /* Sınıfın geliş oturumu değiştiyse: yeni geliş saatleri (uygulama classSlots'a yazar) */
      slotShifts: (best.shifts || []).map(function (x) {
        var bits = '';
        for (var p = 1; p <= P; p++) bits += x.periods.indexOf(p) >= 0 ? '1' : '0';
        return { classId: x.classId, day: x.day, bits: bits,
                 fromLabel: x.fromLabel, toLabel: x.toLabel };
      }),
      stats: {
        placedHours: best.cards.length, missingHours: best.missHours,
        totalHours: data.curriculum.reduce(function (s, l) { return s + l.hours; }, 0),
        fixedHours: fixed.length, maybeDayHours: best.maybeUse, optionalDayCount: best.optDayCount,
        teacherGaps: best.gaps, splits: best.frag, classGaps: best.cgaps,
        attempts: tried, seed: best.seed, ms: Date.now() - t0,
      },
      diagnostics: diag,
      maps: maps,
    };
  }

  /**
   * Dağınıklık ölçüsü: aynı dersin aynı gün içindeki kopuk parça sayısı.
   * “1. ders matematik + 5. ders matematik” gibi her kopukluk 1 sayılır; 0 = her şey arka arkaya.
   */
  function splitCount(data, cards) {
    var by = {}, i, c, k;
    for (i = 0; i < cards.length; i++) {
      c = cards[i];
      if (!c.lessonId || c.kind === 'etut') continue;
      k = c.lessonId + '#' + c.day;
      (by[k] || (by[k] = [])).push(c.period);
    }
    var n = 0;
    for (k in by) {
      var a = by[k].sort(function (x, y) { return x - y; });
      for (i = 1; i < a.length; i++) if (a[i] !== a[i - 1] + 1) n++;
    }
    return n;
  }

  /** Tüm sınıfların gün içi ara boşluk toplamı (ders yerleşebilen saatler sayılır). */
  function classGapTotal(data, cards) {
    var occ = {}, i, c, k, d, p;
    for (i = 0; i < cards.length; i++) {
      c = cards[i];
      (occ[c.classId] || (occ[c.classId] = new Uint8Array(NSLOT)))[si(c.day, c.period)] = 1;
    }
    var g = 0;
    for (k in occ) {
      for (d = 1; d <= 7; d++) {
        var first = -1, last = -1;
        for (p = 1; p <= P; p++) if (occ[k][si(d, p)]) { if (first < 0) first = p; last = p; }
        if (first < 0) continue;
        for (p = first; p <= last; p++) {
          if (!occ[k][si(d, p)] && lessonBand(data.settings, d, p)) g++;
        }
      }
    }
    return g;
  }

  function teacherGapTotal(cards) {
    var occ = {}, i, c;
    for (i = 0; i < cards.length; i++) {
      c = cards[i];
      (occ[c.teacherId] ??= new Uint8Array(NSLOT))[si(c.day, c.period)] = 1;
    }
    var total = 0;
    for (var tid in occ) {
      for (var d = 1; d <= 7; d++) {
        var first = -1, last = -1, p;
        for (p = 1; p <= P; p++) if (occ[tid][si(d, p)]) { if (first < 0) first = p; last = p; }
        if (first < 0) continue;
        for (p = first; p <= last; p++) if (!occ[tid][si(d, p)]) total++;
      }
    }
    return total;
  }

  /* =========================================================
     7) Sınıf grupları (paralel şubeler) — alana göre otomatik
     ========================================================= */
  /** Sınıf adından seviye anahtarı */
  function levelOf(name) {
    var n = String(name).toUpperCase().replace(/[^0-9A-Z\/]/g, '');
    if (/^5/.test(n)) return '5. sınıf';
    if (/^6/.test(n)) return '6. sınıf';
    if (/^7/.test(n)) return '7. sınıf';
    if (/^8/.test(n)) return '8. sınıf';
    if (/^1\d\d$/.test(n)) return '9. sınıf';
    if (/^2\d\d$/.test(n)) return '10. sınıf';
    if (/^3\d\d$/.test(n)) return '11. sınıf';
    if (/^4\d\d$/.test(n)) return '12. sınıf';
    if (/^5\d\d$/.test(n)) return 'Mezun';
    return 'Diğer';
  }
  /**
   * Aynı seviyedeki sınıflar, ders KÜMELERİNİN benzerliğine göre alanlara ayrılır
   * (Jaccard ≥ 0.6). Böylece 401-402-403 bir grup, 411 (sözel) ayrı grup olur.
   */
  function detectGroups(data) {
    var st = data.settings;
    if (st.classGroups && st.classGroups.length) {
      // elle tanımlı gruplar
      return st.classGroups.map(function (g, i) {
        return finishGroup(data, g.name || ('Grup ' + (i + 1)), g.classIds || []);
      }).filter(function (g) { return g.classIds.length > 1; });
    }
    var setOf = {}, byLevel = {};
    for (var i = 0; i < data.classes.length; i++) {
      var c = data.classes[i], set = {};
      for (var j = 0; j < data.curriculum.length; j++) {
        if (data.curriculum[j].classId === c.id) set[data.curriculum[j].subjectId] = 1;
      }
      setOf[c.id] = set;
      if (!Object.keys(set).length) continue;
      (byLevel[levelOf(c.name)] ??= []).push(c);
    }
    function jac(a, b) {
      var A = Object.keys(setOf[a]), B = setOf[b], inter = 0, u = {};
      A.forEach(function (k) { u[k] = 1; if (B[k]) inter++; });
      Object.keys(B).forEach(function (k) { u[k] = 1; });
      var un = Object.keys(u).length;
      return un ? inter / un : 0;
    }
    var groups = [];
    Object.keys(byLevel).forEach(function (lv) {
      var pool = byLevel[lv].slice(), clusters = [];
      while (pool.length) {
        var seed = pool.shift(), cl = [seed];
        for (var k = pool.length - 1; k >= 0; k--) {
          if (jac(seed.id, pool[k].id) >= 0.6) { cl.push(pool[k]); pool.splice(k, 1); }
        }
        clusters.push(cl);
      }
      clusters.forEach(function (cl, idx) {
        if (cl.length < 2) return;
        var name = lv + (clusters.filter(function (x) { return x.length > 1; }).length > 1 ? ' · ' + branchName(data, cl) : '');
        groups.push(finishGroup(data, name, cl.map(function (c) { return c.id; })));
      });
    });
    return groups;
  }
  /** Gruba alan adı ver (ayırt edici derse göre) */
  function branchName(data, cl) {
    var names = {};
    for (var i = 0; i < data.subjects.length; i++) names[data.subjects[i].id] = data.subjects[i].name;
    var has = {};
    for (var j = 0; j < data.curriculum.length; j++) {
      if (cl.some(function (c) { return c.id === data.curriculum[j].classId; })) has[data.curriculum[j].subjectId] = 1;
    }
    var keys = Object.keys(has).map(function (k) { return (names[k] || '').toUpperCase(); });
    if (keys.indexOf('FİZİK') >= 0 || keys.indexOf('KİMYA') >= 0) return 'Sayısal';
    if (keys.indexOf('EDEBİYT') >= 0 || keys.indexOf('TARİH') >= 0 || keys.indexOf('COĞRAFYA') >= 0) return 'Sözel / EA';
    return cl.map(function (c) { return c.name; }).join('-');
  }
  /** Grup içi ders farklarını hesapla (çoğunluk saati referans) */
  function finishGroup(data, name, classIds) {
    var hours = {}, teachers = {}, subj = {};
    classIds.forEach(function (cid) {
      data.curriculum.forEach(function (L) {
        if (L.classId !== cid) return;
        (hours[L.subjectId] ??= {})[cid] = (hours[L.subjectId][cid] || 0) + L.hours;
        (teachers[L.subjectId] ??= {})[cid] = L.teacherId;
        subj[L.subjectId] = 1;
      });
    });
    var diffs = [];
    Object.keys(subj).forEach(function (sid) {
      var per = hours[sid] || {}, counts = {};
      classIds.forEach(function (cid) {
        var v = per[cid] || 0;
        counts[v] = (counts[v] || 0) + 1;
      });
      var vals = Object.keys(counts).map(Number);
      if (vals.length <= 1) return;
      // çoğunluk saati (eşitlikte büyük olan)
      var major = vals.sort(function (a, b) { return counts[b] - counts[a] || b - a; })[0];
      classIds.forEach(function (cid) {
        var v = per[cid] || 0;
        if (v !== major) diffs.push({ classId: cid, subjectId: sid, hours: v, expected: major,
                                      teacherId: (teachers[sid] || {})[classIds.find(function (x) { return (per[x] || 0) === major; })] });
      });
    });
    return { name: name, classIds: classIds, subjects: Object.keys(subj), hours: hours, diffs: diffs };
  }

  /* =========================================================
     8) TANILAMA + ALTERNATİF ÇÖZÜMLER
     ========================================================= */
  function diagnose(data, maps, fixed, best) {
    var st = data.settings, out = [], i, d, p, s;
    var DS = st.dayShort;
    var idx = function (arr) { var o = {}; for (var i = 0; i < arr.length; i++) o[arr[i].id] = arr[i]; return o; };
    var CL = idx(data.classes), TE = idx(data.teachers), SU = idx(data.subjects);
    var cname = function (id) { return (CL[id] || {}).name || id; };
    var tname = function (id) { return (TE[id] || {}).name || id; };
    var sname = function (id) { return (SU[id] || {}).name || id; };
    var loadC = classLoad(data), loadT = teacherLoad(data);
    var maxOpt = st.maxOptionalDays == null ? 1 : st.maxOptionalDays;

    var fixExtra = { c: {}, t: {} };
    for (i = 0; i < fixed.length; i++) {
      if (fixed[i].kind === 'etut') {
        fixExtra.c[fixed[i].classId] = (fixExtra.c[fixed[i].classId] || 0) + 1;
        fixExtra.t[fixed[i].teacherId] = (fixExtra.t[fixed[i].teacherId] || 0) + 1;
      }
    }
    var capOf = function (map) { var n = 0; for (var i = 0; i < NSLOT; i++) if (map[i]) n++; return n; };

    /** öğretmenin, sınıfın müsait olduğu ama kendisinin olmadığı slotları (öneri için) */
    function suggestSlots(tid, cid, need) {
      var co = maps.classOk[cid], to = maps.teachOk[tid], outS = [];
      if (!co || !to) return outS;
      for (var s = 0; s < NSLOT && outS.length < need; s++) {
        if (co[s] && !to[s] && lessonBand(st, sd(s), sp(s))) outS.push([sd(s), sp(s)]);
      }
      return outS;
    }
    /** aynı dersi veren, o sınıfın saatlerinde boş olan başka öğretmen */
    function altTeacher(L) {
      var co = maps.classOk[L.classId];
      var others = data.curriculum.filter(function (x) { return x.subjectId === L.subjectId && x.teacherId !== L.teacherId; })
        .map(function (x) { return x.teacherId; });
      var uniq = [], seen = {};
      others.forEach(function (t) { if (!seen[t]) { seen[t] = 1; uniq.push(t); } });
      var bestT = null, bestN = 0;
      uniq.forEach(function (tid) {
        var to = maps.teachOk[tid], n = 0;
        if (!to) return;
        for (var s = 0; s < NSLOT; s++) if (co[s] && to[s]) n++;
        var free = capOf(to) - (loadT[tid] || 0);
        if (n >= L.hours && free >= L.hours && n > bestN) { bestN = n; bestT = tid; }
      });
      return bestT;
    }
    var bandLabel = function (d, id) {
      var bs = bandsOf(st, d);
      for (var i = 0; i < bs.length; i++) if (bs[i].id === id) return bs[i].label;
      return id;
    };

    /* --- A) Sınıf kapasitesi --- */
    for (i = 0; i < data.classes.length; i++) {
      var c = data.classes[i], cap = classCapacity(data, maps, c.id);
      var need = (loadC[c.id] || 0) + (fixExtra.c[c.id] || 0);
      if (!cap.total && need) {
        out.push({
          level: 'error', code: 'class-noday', classId: c.id,
          title: c.name + ': hiç geldiği gün/saat yok ama ' + need + ' saat dersi var.',
          fix: 'Ne yapmalı: 🏫 Sınıflar sekmesinde bu sınıfa en az bir gün ve oturum işaretleyin.',
        });
        continue;
      }
      if (need > cap.total) {
        var acts = [];
        // alternatif 1: kullanılmayan "Gelebilir" gün varsa sınırı artır
        var spare = cap.optionalDays.filter(function (d) { return cap.usableDays.indexOf(d) < 0; });
        if (spare.length) {
          var extra = spare.slice(0, Math.ceil((need - cap.total) / Math.max(1, cap.optionalByDay[spare[0]])))
            .reduce(function (a, d) { return a + cap.optionalByDay[d]; }, 0);
          acts.push({
            type: 'setting', path: 'maxOptionalDays', value: maxOpt + spare.length,
            label: 'Sınıf başına en fazla “Gelebilir” gün sayısını ' + maxOpt + ' → ' + (maxOpt + spare.length) +
              ' yap (' + spare.map(function (d) { return DS[d - 1]; }).join('/') + ' günleri de kullanılabilir, +' + extra + ' saat yer)',
          });
        }
        // alternatif 2: kapalı bir güne akşam oturumu aç
        for (d = 1; d <= 7; d++) {
          if (!st.activeDays[d - 1]) continue;
          if ((data.classDays[c.id] || [])[d - 1]) continue;
          var bs = bandsOf(st, d).filter(function (x) { return !x.noLesson; });
          var bd = bs[bs.length - 1];
          acts.push({
            type: 'open-class-day', classId: c.id, day: d, band: bd.id, status: 2,
            label: DS[d - 1] + ' günü “' + bd.label + '” oturumunu “Gelebilir” olarak aç (+' + (bd.to - bd.from + 1) + ' saat yer)',
          });
          if (acts.length >= 4) break;
        }
        // alternatif 3: en çok saatli dersten kıs
        var biggest = data.curriculum.filter(function (L) { return L.classId === c.id; })
          .sort(function (a, b) { return b.hours - a.hours; })[0];
        if (biggest) {
          acts.push({
            type: 'set-hours', lessonId: biggest.id, hours: Math.max(0, biggest.hours - (need - cap.total)),
            label: sname(biggest.subjectId) + ' dersini ' + biggest.hours + ' → ' +
              Math.max(0, biggest.hours - (need - cap.total)) + ' saate düşür',
          });
        }
        out.push({
          level: 'error', code: 'class-capacity', classId: c.id,
          title: c.name + ' — kapasite aşımı: ' + need + ' saat ders / ' + cap.total + ' saat yer. Fazla: ' + (need - cap.total) + ' saat',
          detail: ['kesin günler: ' + cap.mandatory + ' saat',
                   '“Gelebilir” günlerden kullanılabilen: ' + cap.optional + ' saat (en fazla ' + maxOpt + ' gün)'],
          fix: 'Ne yapmalı: aşağıdaki alternatiflerden birini uygulayın.',
          actions: acts,
        });
      }
    }

    /* --- B) Öğretmen müsaitliği --- */
    for (i = 0; i < data.teachers.length; i++) {
      var t = data.teachers[i], tcap = capOf(maps.teachOk[t.id]);
      var tneed = (loadT[t.id] || 0) + (fixExtra.t[t.id] || 0);
      if (tneed > tcap) {
        var a2 = [], gap = tneed - tcap;
        // alternatif 1: dersini verdiği sınıfların boş saatlerine müsaitlik aç
        var ls = data.curriculum.filter(function (L) { return L.teacherId === t.id; });
        var slots = [];
        for (var k = 0; k < ls.length && slots.length < gap; k++) {
          suggestSlots(t.id, ls[k].classId, gap - slots.length).forEach(function (x) {
            if (!slots.some(function (y) { return y[0] === x[0] && y[1] === x[1]; })) slots.push(x);
          });
        }
        if (slots.length) {
          a2.push({
            type: 'teacher-avail', teacherId: t.id, slots: slots,
            label: 'Müsaitlik ekle: ' + slots.slice(0, 6).map(function (x) { return DS[x[0] - 1] + ' ' + x[1] + '. ders'; }).join(', ') +
              (slots.length > 6 ? ' … (' + slots.length + ' saat)' : ''),
          });
        }
        // alternatif 2: bir dersi başka öğretmene devret
        var moved = null;
        for (var m = 0; m < ls.length && !moved; m++) {
          var alt = altTeacher(ls[m]);
          if (alt) moved = { L: ls[m], alt: alt };
        }
        if (moved) {
          a2.push({
            type: 'reassign-teacher', lessonId: moved.L.id, teacherId: moved.alt,
            label: cname(moved.L.classId) + ' · ' + sname(moved.L.subjectId) + ' (' + moved.L.hours +
              ' saat) dersini ' + tname(moved.alt) + ' öğretmenine devret',
          });
        }
        out.push({
          level: 'error', code: 'teacher-capacity', teacherId: t.id,
          title: t.name + ': ' + tneed + ' saat ders / ' + tcap + ' saat müsait. ' + gap + ' saat daha açın.',
          fix: 'Ne yapmalı: 👩‍🏫 Öğretmenler sekmesinde müsaitlik açın ya da aşağıdaki alternatifi uygulayın.',
          actions: a2,
        });
      }
    }

    /* --- C) Ortak gün / slot yok --- */
    for (i = 0; i < data.curriculum.length; i++) {
      var L2 = data.curriculum[i];
      var co = maps.classOk[L2.classId], to = maps.teachOk[L2.teacherId];
      if (!co || !to) {
        out.push({
          level: 'error', code: 'missing-ref', lessonId: L2.id,
          title: 'Geçersiz ders satırı: sınıf veya öğretmen bulunamadı (' + L2.id + ')',
          fix: 'Ne yapmalı: 🏫 Sınıflar / 👩‍🏫 Öğretmenler sekmesinde bu satırı düzeltin veya silin.',
          actions: [{ type: 'delete-lesson', lessonId: L2.id, label: 'Bu ders satırını sil' }],
        });
        continue;
      }
      var inter = 0, cDays = {}, tDays = {};
      for (s = 0; s < NSLOT; s++) {
        if (co[s]) cDays[sd(s)] = 1;
        if (to[s]) tDays[sd(s)] = 1;
        if (co[s] && to[s]) inter++;
      }
      if (inter < L2.hours) {
        var cd = Object.keys(cDays).map(function (x) { return DS[x - 1]; }).join('/') || 'hiç gün yok';
        var td = Object.keys(tDays).map(function (x) { return DS[x - 1]; }).join('/') || 'hiç gün yok';
        var a3 = [];
        var need3 = L2.hours - inter;
        var sl = suggestSlots(L2.teacherId, L2.classId, need3);
        if (sl.length) {
          a3.push({
            type: 'teacher-avail', teacherId: L2.teacherId, slots: sl,
            label: tname(L2.teacherId) + ' için müsaitlik aç: ' +
              sl.map(function (x) { return DS[x[0] - 1] + ' ' + x[1] + '. ders'; }).join(', '),
          });
        }
        var alt2 = altTeacher(L2);
        if (alt2) {
          a3.push({
            type: 'reassign-teacher', lessonId: L2.id, teacherId: alt2,
            label: 'Dersi ' + tname(alt2) + ' öğretmenine ver (o sınıfın saatlerinde müsait)',
          });
        }
        a3.push({ type: 'set-hours', lessonId: L2.id, hours: inter,
                  label: 'Dersi ' + L2.hours + ' → ' + inter + ' saate düşür (ortak müsait saat kadar)' });
        out.push({
          level: 'error', code: inter === 0 ? 'no-intersection' : 'thin-intersection',
          lessonId: L2.id, classId: L2.classId, teacherId: L2.teacherId,
          title: inter === 0
            ? cname(L2.classId) + ' · ' + sname(L2.subjectId) + ' (' + tname(L2.teacherId) + '): sınıf ' + cd +
              ' geliyor, öğretmen yalnız ' + td + ' müsait → kesişim yok.'
            : cname(L2.classId) + ' · ' + sname(L2.subjectId) + ' (' + tname(L2.teacherId) + '): ' + L2.hours +
              ' saat isteniyor ama ortak müsait saat yalnız ' + inter + '.',
          fix: 'Ne yapmalı: aşağıdaki alternatiflerden birini uygulayın.',
          actions: a3,
        });
      }
    }

    /* --- D0) SAAT darboğazı (slot düzeyinde Hall koşulu) ---
       Gün düzeyinden daha isabetli: hangi ders saatlerine kaç saat sıkıştığını tam söyler.
       Hall ihlalinin en küçük tanığı her zaman derslerin ALAN BİRLEŞİMİ olduğu için,
       yalnızca farklı alanların birleşimlerini taramak yeterli ve ucuzdur. */
    var slotStuck = {};   // teacherId -> true (bu öğretmen için gün düzeyi tanısını bastır)
    for (i = 0; i < data.teachers.length; i++) {
      var ts = data.teachers[i];
      var lsS = data.curriculum.filter(function (x) { return x.teacherId === ts.id; });
      if (!lsS.length) continue;
      var toS = maps.teachOk[ts.id];
      // her dersin alanı (yerleşebileceği slotlar) — aynı alanlar tek anahtarda birleşir
      var domKeys = {}, domList = [];
      lsS.forEach(function (L) {
        var co = maps.classOk[L.classId];
        if (!co) return;
        var arr = [];
        for (var s = 0; s < NSLOT; s++) if (co[s] && toS[s]) arr.push(s);
        var key = arr.join(',');
        if (!domKeys[key]) { domKeys[key] = { slots: arr, hours: 0, lessons: [] }; domList.push(domKeys[key]); }
        domKeys[key].hours += L.hours;
        domKeys[key].lessons.push(L);
      });
      if (domList.length > 14) continue;                 // güvenlik sınırı
      var worstS = null;
      for (var mask2 = 1; mask2 < (1 << domList.length); mask2++) {
        var uni = {}, needS = 0, parts = [];
        for (var q4 = 0; q4 < domList.length; q4++) {
          if (!(mask2 & (1 << q4))) continue;
          parts.push(domList[q4]);
          domList[q4].slots.forEach(function (s) { uni[s] = 1; });
        }
        var uniSlots = Object.keys(uni).map(Number);
        // birleşime TAM olarak hapsolan derslerin saatleri
        domList.forEach(function (dm) {
          if (dm.slots.length && dm.slots.every(function (s) { return uni[s]; })) needS += dm.hours;
        });
        if (needS > uniSlots.length && (!worstS || needS - uniSlots.length > worstS.excess)) {
          var stuckL = [];
          domList.forEach(function (dm) {
            if (dm.slots.length && dm.slots.every(function (s) { return uni[s]; })) {
              dm.lessons.forEach(function (L) { stuckL.push(L); });
            }
          });
          worstS = { excess: needS - uniSlots.length, need: needS, cap: uniSlots.length,
                     slots: uniSlots.sort(function (a, b) { return a - b; }), stuck: stuckL };
        }
      }
      if (worstS) {
        slotStuck[ts.id] = true;
        var slotTxt = worstS.slots.map(function (s) { return DS[sd(s) - 1] + ' ' + sp(s) + '.'; }).join(', ');
        var aS = [];
        // alternatif 1: bu derslerin sınıflarının müsait olduğu, öğretmenin olmadığı slotları aç
        var want = [];
        worstS.stuck.forEach(function (L) {
          var co6 = maps.classOk[L.classId];
          if (!co6) return;
          for (var s6 = 0; s6 < NSLOT && want.length < worstS.excess + 2; s6++) {
            if (co6[s6] && !toS[s6] && lessonBand(st, sd(s6), sp(s6)) &&
                !want.some(function (x) { return x[0] === sd(s6) && x[1] === sp(s6); })) {
              want.push([sd(s6), sp(s6)]);
            }
          }
        });
        if (want.length) {
          aS.push({
            type: 'teacher-avail', teacherId: ts.id, slots: want.slice(0, Math.max(worstS.excess, 1) + 2),
            label: ts.name + ' için müsaitlik aç: ' + want.slice(0, 4).map(function (x) {
              return DS[x[0] - 1] + ' ' + x[1] + '. ders';
            }).join(', ') + ' (en az ' + worstS.excess + ' saat gerekli)',
          });
        }
        // alternatif 2: sıkışan derslerden birini başka öğretmene devret
        var cands2 = worstS.stuck.slice().sort(function (a, b) { return a.hours - b.hours; });
        for (var z2 = 0; z2 < cands2.length; z2++) {
          var altS = altTeacher(cands2[z2]);
          if (altS) {
            aS.push({
              type: 'reassign-teacher', lessonId: cands2[z2].id, teacherId: altS,
              label: cname(cands2[z2].classId) + ' · ' + sname(cands2[z2].subjectId) + ' (' +
                cands2[z2].hours + ' saat) dersini ' + tname(altS) + ' öğretmenine devret',
            });
            break;
          }
        }
        // alternatif 3: sıkışan derslerin sınıfına gün aç
        var cSet = {};
        worstS.stuck.forEach(function (L) { cSet[L.classId] = 1; });
        Object.keys(cSet).forEach(function (cid2) {
          if (aS.length >= 4) return;
          for (var d2 = 1; d2 <= 7; d2++) {
            if (!st.activeDays[d2 - 1] || (data.classDays[cid2] || [])[d2 - 1]) continue;
            var okDay = false;
            for (var p4 = 1; p4 <= P; p4++) if (toS[si(d2, p4)]) { okDay = true; break; }
            if (!okDay) continue;
            var bs2 = bandsOf(st, d2).filter(function (x) { return !x.noLesson; });
            var bd2 = bs2[bs2.length - 1];
            aS.push({
              type: 'open-class-day', classId: cid2, day: d2, band: bd2.id, status: 2,
              label: cname(cid2) + ' için ' + DS[d2 - 1] + ' “' + bd2.label +
                '” oturumunu aç (' + ts.name + ' o gün kurumda)',
            });
            break;
          }
        });
        // alternatif 4: en küçük dersi kısalt
        var small = cands2[0];
        if (small) {
          aS.push({
            type: 'set-hours', lessonId: small.id, hours: Math.max(0, small.hours - worstS.excess),
            label: cname(small.classId) + ' · ' + sname(small.subjectId) + ' dersini ' + small.hours +
              ' → ' + Math.max(0, small.hours - worstS.excess) + ' saate düşür',
          });
        }
        out.push({
          level: 'error', code: 'slot-bottleneck', teacherId: ts.id,
          title: ts.name + ': ' + slotTxt + ' ders saatlerine ' + worstS.need +
                 ' saat sıkışıyor, yalnızca ' + worstS.cap + ' saat yer var. Fazla: ' + worstS.excess + ' saat',
          detail: worstS.stuck.map(function (L) {
            return cname(L.classId) + ' · ' + sname(L.subjectId) + ' (' + L.hours +
                   ' saat) — yalnızca bu saatlere konulabiliyor';
          }).concat(['Bu bir yapısal kısıt: yukarıdaki dersler başka hiçbir saate yerleşemiyor, ' +
                     'dolayısıyla program bu veriyle matematiksel olarak tamamlanamaz.']),
          fix: 'Ne yapmalı: aşağıdaki alternatiflerden birini uygulayın — biri olmadan program eksik kalır.',
          actions: aS,
        });
      }
    }

    /* --- D) Gün darboğazı (Hall koşulu, gün düzeyi) --- */
    for (i = 0; i < data.teachers.length; i++) {
      var tt = data.teachers[i];
      if (slotStuck[tt.id]) continue;   // saat düzeyinde daha isabetli tanı verildi
      var lsOf = data.curriculum.filter(function (x) { return x.teacherId === tt.id; });
      if (!lsOf.length) continue;
      var to2 = maps.teachOk[tt.id];
      var lessonDays = lsOf.map(function (L) {
        var co2 = maps.classOk[L.classId], set = 0;
        for (var s = 0; s < NSLOT; s++) if (co2 && co2[s] && to2[s]) set |= 1 << (sd(s) - 1);
        return { L: L, set: set };
      });
      var capDay = [];
      for (d = 1; d <= 7; d++) { var n2 = 0; for (p = 1; p <= P; p++) if (to2[si(d, p)]) n2++; capDay[d] = n2; }
      var worst = null;
      for (var mask = 1; mask < 128; mask++) {
        var capm = 0, needm = 0, dl = [], stuck = [];
        for (d = 1; d <= 7; d++) if (mask & (1 << (d - 1))) { capm += capDay[d]; dl.push(DS[d - 1]); }
        for (var q3 = 0; q3 < lessonDays.length; q3++) {
          if (lessonDays[q3].set && (lessonDays[q3].set & ~mask) === 0) {
            needm += lessonDays[q3].L.hours;
            stuck.push(lessonDays[q3].L);
          }
        }
        if (needm > capm && (!worst || needm - capm > worst.excess)) {
          worst = { excess: needm - capm, days: dl, need: needm, cap: capm, stuck: stuck };
        }
      }
      if (worst) {
        var a4 = [];
        // alternatif: darboğaz dışındaki bir günde müsaitlik aç
        var outside = [];
        for (d = 1; d <= 7 && outside.length < 1; d++) {
          if (!st.activeDays[d - 1] || worst.days.indexOf(DS[d - 1]) >= 0) continue;
          var anyClass = worst.stuck.some(function (L) {
            var co3 = maps.classOk[L.classId];
            for (var p2 = 1; p2 <= P; p2++) if (co3 && co3[si(d, p2)]) return true;
            return false;
          });
          if (anyClass) outside.push(d);
        }
        outside.forEach(function (dd) {
          var sl2 = [];
          worst.stuck.forEach(function (L) {
            var co4 = maps.classOk[L.classId];
            for (var p3 = 1; p3 <= P && sl2.length < worst.excess; p3++) {
              if (co4 && co4[si(dd, p3)] && !to2[si(dd, p3)] &&
                  !sl2.some(function (x) { return x[0] === dd && x[1] === p3; })) sl2.push([dd, p3]);
            }
          });
          if (sl2.length) {
            a4.push({
              type: 'teacher-avail', teacherId: tt.id, slots: sl2,
              label: DS[dd - 1] + ' günü müsaitlik aç: ' +
                sl2.map(function (x) { return x[1] + '. ders'; }).join(', ') + ' (+' + sl2.length + ' saat)',
            });
          }
        });
        var big = worst.stuck.slice().sort(function (a, b) { return b.hours - a.hours; })[0];
        if (big) {
          var altB = altTeacher(big);
          if (altB) a4.push({
            type: 'reassign-teacher', lessonId: big.id, teacherId: altB,
            label: cname(big.classId) + ' · ' + sname(big.subjectId) + ' (' + big.hours + ' saat) dersini ' +
              tname(altB) + ' öğretmenine devret',
          });
        }
        out.push({
          level: 'error', code: 'day-bottleneck', teacherId: tt.id,
          title: tt.name + ': ' + worst.days.join(' + ') + ' günlerine ' + worst.need +
                 ' saat sıkışıyor, yalnızca ' + worst.cap + ' saat yer var.',
          detail: worst.stuck.map(function (L) {
            return cname(L.classId) + ' · ' + sname(L.subjectId) + ' (' + L.hours + ' saat) — başka güne konulamıyor';
          }),
          fix: 'Ne yapmalı: aşağıdaki alternatiflerden birini uygulayın.',
          actions: a4,
        });
      }
    }

    /* --- E) Yerleşemeyen bloklar --- */
    if (best && best.missing && best.missing.length) {
      var occC = {}, occT = {};
      for (i = 0; i < best.cards.length; i++) {
        var cc = best.cards[i];
        (occC[cc.classId] ??= new Int8Array(NSLOT))[si(cc.day, cc.period)] = 1;
        (occT[cc.teacherId] ??= new Int8Array(NSLOT))[si(cc.day, cc.period)] = 1;
      }
      for (i = 0; i < fixed.length; i++) {
        var fx = fixed[i];
        (occC[fx.classId] ??= new Int8Array(NSLOT))[si(fx.day, fx.period)] = 1;
        (occT[fx.teacherId] ??= new Int8Array(NSLOT))[si(fx.day, fx.period)] = 1;
      }
      for (var mi = 0; mi < best.missing.length; mi++) {
        var mb = best.missing[mi];
        var reason = { 'sınıfın müsait olmadığı saat': 0, 'öğretmenin müsait olmadığı saat': 0,
                       'öğretmen başka sınıfta': 0, 'sınıfın başka dersi var': 0, 'blok oturuma sığmıyor': 0 };
        var co5 = best.activeOk ? best.activeOk[mb.classId] : maps.classOk[mb.classId];
        var to5 = maps.teachOk[mb.teacherId];
        for (d = 1; d <= 7; d++) {
          for (p = 1; p + mb.len - 1 <= P; p++) {
            var bnd = lessonBand(st, d, p);
            if (!bnd || p + mb.len - 1 > bnd.to) { reason['blok oturuma sığmıyor']++; continue; }
            var hit = null;
            for (var qq = 0; qq < mb.len; qq++) {
              var sx2 = si(d, p + qq);
              if (!co5[sx2]) { hit = 'sınıfın müsait olmadığı saat'; break; }
              if (!to5[sx2]) { hit = 'öğretmenin müsait olmadığı saat'; break; }
              if (occT[mb.teacherId] && occT[mb.teacherId][sx2]) { hit = 'öğretmen başka sınıfta'; break; }
              if (occC[mb.classId] && occC[mb.classId][sx2]) { hit = 'sınıfın başka dersi var'; break; }
            }
            if (hit) reason[hit]++;
          }
        }
        var lesson = data.curriculum.filter(function (x) { return x.id === mb.lessonId; })[0];
        var a5 = [];
        a5.push({ type: 'regenerate', label: 'Programı yeniden oluştur (farklı dizilim dene)' });
        var sl3 = suggestSlots(mb.teacherId, mb.classId, mb.len);
        if (sl3.length) a5.push({
          type: 'teacher-avail', teacherId: mb.teacherId, slots: sl3,
          label: tname(mb.teacherId) + ' için müsaitlik aç: ' +
            sl3.map(function (x) { return DS[x[0] - 1] + ' ' + x[1] + '. ders'; }).join(', '),
        });
        if (lesson) {
          var alt3 = altTeacher(lesson);
          if (alt3) a5.push({ type: 'reassign-teacher', lessonId: lesson.id, teacherId: alt3,
                              label: 'Dersi ' + tname(alt3) + ' öğretmenine ver' });
          a5.push({ type: 'setting', path: 'preferredBlock', value: 1,
                    label: 'Tercih edilen blok uzunluğunu 1 saate indir (daha esnek yerleşim)' });
        }
        var capX = classCapacity(data, maps, mb.classId);
        if (capX.optionalDays.length > capX.usableDays.length) {
          a5.push({ type: 'setting', path: 'maxOptionalDays', value: maxOpt + 1,
                    label: 'Sınıf başına “Gelebilir” gün sınırını ' + maxOpt + ' → ' + (maxOpt + 1) + ' yap' });
        }
        var topR = Object.keys(reason).sort(function (a, b2) { return reason[b2] - reason[a]; })[0];
        out.push({
          level: 'error', code: 'unplaced-block', lessonId: mb.lessonId, classId: mb.classId, teacherId: mb.teacherId,
          title: cname(mb.classId) + ' · ' + sname(mb.subjectId) + ' (' + tname(mb.teacherId) + '): ' + mb.len +
                 ' saatlik blok yerleşemedi.',
          detail: Object.keys(reason).filter(function (k) { return reason[k]; })
            .sort(function (a, b3) { return reason[b3] - reason[a]; })
            .map(function (k) { return k + ': ' + reason[k] + ' konum'; })
            .concat(['en sık engel: ' + topR]),
          fix: 'Ne yapmalı: aşağıdaki alternatiflerden birini uygulayın.',
          actions: a5,
        });
      }
    }

    /* --- F) Sınıf grubu ders farkları --- */
    var groups = detectGroups(data);
    groups.forEach(function (g) {
      if (!g.diffs.length) return;
      g.diffs.forEach(function (df) {
        var others = g.classIds.filter(function (x) { return x !== df.classId; });
        out.push({
          level: 'warn', code: 'group-diff', classId: df.classId, groupName: g.name,
          title: g.name + ' grubunda ders farkı — ' + cname(df.classId) + ' · ' + sname(df.subjectId) + ': ' +
                 df.hours + ' saat, grubun geri kalanı ' + df.expected + ' saat.',
          detail: ['grup: ' + g.classIds.map(cname).join(', ')],
          fix: 'Ne yapmalı: paralel şubeler aynı dersleri almalı. Aşağıdaki düğme farkı kapatır.',
          actions: [{
            type: 'equalize', classId: df.classId, subjectId: df.subjectId, hours: df.expected,
            teacherId: df.teacherId || null,
            label: cname(df.classId) + ' · ' + sname(df.subjectId) + ' dersini ' + df.hours + ' → ' + df.expected + ' saate getir',
          }, {
            type: 'equalize-group', groupName: g.name,
            label: g.name + ' grubundaki TÜM farkları eşitle (' + g.diffs.length + ' fark)',
          }],
        });
      });
    });

    /* --- G) Uyarılar: tam doluluk / seçilen Gelebilir günler --- */
    for (i = 0; i < data.classes.length; i++) {
      var c6 = data.classes[i], cap6 = classCapacity(data, maps, c6.id), need6 = loadC[c6.id] || 0;
      if (need6 && cap6.total && need6 === cap6.total) {
        out.push({
          level: 'warn', code: 'class-full', classId: c6.id,
          title: c6.name + ': ' + need6 + ' saat ders / ' + cap6.total + ' saat yer — sıfır esneklik (tam doluluk).',
          fix: 'Ne yapmalı: sorun yok ama yer kalmadı; ders eklemek isterseniz önce 🏫 Sınıflar\'dan gün/oturum açın.',
        });
      }
    }
    if (best && best.overflow && best.overflow.length) {
      best.overflow.forEach(function (o) {
        out.push({
          level: 'warn', code: 'optional-overflow', classId: o.classId,
          title: cname(o.classId) + ': haftalık yükü kesin günlerine sığmadığı için ' +
                 'izin verilenden fazla “Gelebilir” gün kullanıldı.',
          fix: 'Ne yapmalı: ⚙️ Kurum Ayarları\'ndan sınırı artırın ya da 🏫 Sınıflar\'dan kesin bir gün daha açın.',
          actions: [{ type: 'setting', path: 'maxOptionalDays', value: maxOpt + 1,
                      label: 'Sınırı ' + maxOpt + ' → ' + (maxOpt + 1) + ' yap' }],
        });
      });
    }

    var rank = { error: 0, warn: 1, info: 2 };
    out.sort(function (a, b4) { return rank[a.level] - rank[b4.level]; });
    return out;
  }

  /* =========================================================
     9) Öğretmen boşluk analizi
     ========================================================= */
  function teacherGaps(data, maps, cards) {
    var res = {}, i, d, p;
    var occ = {};
    for (i = 0; i < cards.length; i++) {
      var c = cards[i];
      (occ[c.teacherId] ??= {})[si(c.day, c.period)] = c;
    }
    for (i = 0; i < data.teachers.length; i++) {
      var t = data.teachers[i], to = maps.teachOk[t.id], days = {};
      var totInner = 0, totEdge = 0, totBusy = 0;
      for (d = 1; d <= 7; d++) {
        var row = [], first = -1, last = -1;
        for (p = 1; p <= P; p++) if (occ[t.id] && occ[t.id][si(d, p)]) { if (first < 0) first = p; last = p; }
        for (p = 1; p <= P; p++) {
          var s2 = si(d, p), card = occ[t.id] ? occ[t.id][s2] : null, kind;
          if (card) kind = 'busy';
          else if (!to[s2]) kind = 'off';
          else if (first >= 0 && p > first && p < last) kind = 'inner';
          else kind = 'edge';
          if (kind === 'busy') totBusy++; else if (kind === 'inner') totInner++; else if (kind === 'edge') totEdge++;
          row.push({ period: p, kind: kind, card: card || null, time: timeLabel(data.settings, d, p) });
        }
        days[d] = { row: row, first: first, last: last,
                    inner: row.filter(function (x) { return x.kind === 'inner'; }).length,
                    edge: row.filter(function (x) { return x.kind === 'edge'; }).length,
                    busy: row.filter(function (x) { return x.kind === 'busy'; }).length };
      }
      res[t.id] = { days: days, inner: totInner, edge: totEdge, busy: totBusy, free: totInner + totEdge };
    }
    return res;
  }

  /** Her slotta kaç öğretmen boş? (toplu müsaitlik matrisi altlığı) */
  function freeCountBySlot(data, maps, cards) {
    var busy = {};
    for (var i = 0; i < cards.length; i++) (busy[cards[i].teacherId] ??= new Uint8Array(NSLOT))[si(cards[i].day, cards[i].period)] = 1;
    var count = new Uint8Array(NSLOT), whoAll = [];
    for (var s = 0; s < NSLOT; s++) {
      var n = 0, present = 0;
      for (var j = 0; j < data.teachers.length; j++) {
        var tid = data.teachers[j].id;
        if (!maps.teachOk[tid][s]) continue;
        present++;
        if (!(busy[tid] && busy[tid][s])) n++;
      }
      count[s] = Math.min(255, n);
      if (present && n === present) whoAll.push(s);
    }
    return { count: count, allFreeSlots: whoAll };
  }

  /* =========================================================
     10) Etüt
     ========================================================= */
  function etutWindow(st, d) {
    var w = st.etutWindow || { weekday: { from: 10, to: 12 }, weekend: { from: 1, to: 12 } };
    return isWeekend(d) ? w.weekend : w.weekday;
  }
  function inEtutWindow(st, d, p) {
    var w = etutWindow(st, d);
    return p >= w.from && p <= w.to;
  }
  /**
   * Kural: öğretmen kurumda + öğretmenin dersi yok + öğrencinin sınıfının dersi yok
   * + saat etüt penceresi içinde (hafta içi 16.00 ve sonrası).
   */
  function etutSlots(data, maps, cards, teacherId, classId) {
    var st = data.settings;
    var occT = new Uint8Array(NSLOT), occC = new Uint8Array(NSLOT), i;
    for (i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.teacherId === teacherId) occT[si(c.day, c.period)] = 1;
      if (classId && c.classId === classId) occC[si(c.day, c.period)] = 1;
    }
    var to = maps.teachOk[teacherId], co = classId ? maps.classOk[classId] : null, out = [];
    if (!to) return out;
    var gaps = teacherGaps(data, maps, cards)[teacherId];
    for (var d = 1; d <= 7; d++) {
      if (!st.activeDays[d - 1]) continue;
      for (var p = 1; p <= P; p++) {
        var s = si(d, p);
        if (!inEtutWindow(st, d, p) || !to[s] || occT[s] || occC[s]) continue;
        out.push({
          day: d, period: p, time: timeLabel(st, d, p),
          classInSession: co ? (co[s] | 0) : 0,
          gapKind: gaps.days[d].row[p - 1].kind,
        });
      }
    }
    return out;
  }
  function etutCapacity(data, maps, cards, teacherId) {
    return etutSlots(data, maps, cards, teacherId, null);
  }
  /** Öğretmenin ders verdiği sınıflar (etüt panelinde öğrenci seçimi için) */
  function teacherClasses(data, teacherId) {
    var seen = {}, out = [];
    data.curriculum.forEach(function (L) {
      if (L.teacherId !== teacherId || seen[L.classId]) return;
      seen[L.classId] = 1;
      var subs = data.curriculum.filter(function (x) { return x.teacherId === teacherId && x.classId === L.classId; })
        .map(function (x) { return x.subjectId; });
      out.push({ classId: L.classId, subjectIds: subs });
    });
    return out;
  }

  /* ---------- doğrulama ---------- */
  function validate(data, maps, cards) {
    var errs = [], seenC = {}, seenT = {}, i;
    for (i = 0; i < cards.length; i++) {
      var c = cards[i], s = si(c.day, c.period);
      var kc = c.classId + ':' + s, kt = c.teacherId + ':' + s;
      if (seenC[kc]) errs.push('Sınıf çakışması: ' + c.classId + ' gün ' + c.day + ' saat ' + c.period);
      if (seenT[kt]) errs.push('Öğretmen çakışması: ' + c.teacherId + ' gün ' + c.day + ' saat ' + c.period);
      seenC[kc] = 1; seenT[kt] = 1;
      if (!maps.classOk[c.classId] || !maps.classOk[c.classId][s]) errs.push('Sınıf müsait değil: ' + c.classId + ' g' + c.day + 'p' + c.period);
      if (!maps.teachOk[c.teacherId] || !maps.teachOk[c.teacherId][s]) errs.push('Öğretmen müsait değil: ' + c.teacherId + ' g' + c.day + 'p' + c.period);
      if (!lessonBand(data.settings, c.day, c.period)) errs.push('Ders yerleşmeyen band: g' + c.day + 'p' + c.period);
    }
    return errs;
  }

  return {
    P: P, NSLOT: NSLOT, si: si, sd: sd, sp: sp, rng: rng,
    isWeekend: isWeekend, bandsOf: bandsOf, bandOf: bandOf, lessonBand: lessonBand, timeLabel: timeLabel,
    unpackDay: unpackDay, packDay: packDay, splitBlocks: splitBlocks,
    buildMaps: buildMaps, classLoad: classLoad, teacherLoad: teacherLoad,
    resolveClassDays: resolveClassDays, classCapacity: classCapacity,
    generate: generate, diagnose: diagnose, detectGroups: detectGroups, levelOf: levelOf,
    teacherGaps: teacherGaps, freeCountBySlot: freeCountBySlot,
    etutSlots: etutSlots, etutCapacity: etutCapacity, teacherClasses: teacherClasses,
    etutWindow: etutWindow, inEtutWindow: inEtutWindow, validate: validate,
    splitCount: splitCount, classGapTotal: classGapTotal,
  };
})();
/* ================= ENGINE END ================= */
