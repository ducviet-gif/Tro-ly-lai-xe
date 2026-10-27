/* Trợ lý Lái xe — giao diện chạy trong WebView, gọi phần Android qua window.Android */
(function () {
  'use strict';

  // ---------- Cầu nối: Android thật, hoặc giả lập khi mở trên trình duyệt máy tính ----------
  var A = window.Android || makeBrowserShim();

  function makeBrowserShim() {
    var store = {};
    try { store = window.localStorage; } catch (e) {}
    return {
      isTtsReady: function () { return !!window.speechSynthesis; },
      speak: function (text, id, flush) {
        if (!window.speechSynthesis) { setTimeout(function () { App.onSpeakDone(id); }, 300); return; }
        if (flush) speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text); u.lang = 'vi-VN';
        u.onend = u.onerror = function () { App.onSpeakDone(id); };
        speechSynthesis.speak(u);
      },
      stopSpeak: function () { if (window.speechSynthesis) speechSynthesis.cancel(); },
      setSpeechRate: function () {},
      listen: function () {
        var R = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!R) { var t = prompt('Nhập câu lệnh (giả lập giọng nói):'); App.onVoice(t || null); return; }
        var r = new R(); r.lang = 'vi-VN';
        r.onresult = function (e) { App.onVoice(e.results[0][0].transcript); };
        r.onerror = function () { App.onVoice(null); };
        r.start();
      },
      httpGet: function (url, id) {
        fetch(url).then(function (r) { return r.text().then(function (t) { App.onHttp(id, r.status, t); }); })
          .catch(function (e) { App.onHttp(id, 0, 'ERROR: ' + e.message); });
      },
      httpPost: function (url, headers, body, id) {
        fetch(url, { method: 'POST', headers: JSON.parse(headers || '{}'), body: body })
          .then(function (r) { return r.text().then(function (t) { App.onHttp(id, r.status, t); }); })
          .catch(function (e) { App.onHttp(id, 0, 'ERROR: ' + e.message); });
      },
      getPref: function (k) { try { return store.getItem('p_' + k) || ''; } catch (e) { return ''; } },
      setPref: function (k, v) { try { store.setItem('p_' + k, v); } catch (e) {} },
      getLocation: function (id) {
        if (!navigator.geolocation) { App.onLocation(id, null, null); return; }
        navigator.geolocation.getCurrentPosition(function (p) { App.onLocation(id, p.coords.latitude, p.coords.longitude); },
          function () { App.onLocation(id, null, null); }, { timeout: 10000 });
      },
      navigateTo: function (d) { window.open('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(d)); },
      navigateLatLng: function (a, b) { window.open('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + a + ',' + b); },
      searchNearby: function (q) { window.open('https://www.google.com/maps/search/' + encodeURIComponent(q)); },
      dial: function (n) { location.href = 'tel:' + n; },
      playMusic: function (q) { window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(q)); },
      openUrl: function (u) { window.open(u); },
      toastMsg: function (m) { console.log(m); }
    };
  }

  // ---------- Tiện ích chung ----------
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function pref(k, d) { var v = A.getPref(k); return v === '' || v == null ? d : v; }
  function setPref(k, v) { A.setPref(k, String(v)); }
  function prefJSON(k, d) { try { return JSON.parse(pref(k, '')) || d; } catch (e) { return d; } }
  // Bỏ dấu tiếng Việt nhưng giữ nguyên độ dài chuỗi (để cắt lấy phần gốc có dấu)
  function nd(s) {
    return Array.from(String(s).toLowerCase()).map(function (ch) {
      if (ch === 'đ') return 'd';
      return ch.normalize('NFD').charAt(0);
    }).join('');
  }
  function stripHtml(h) {
    var d = new DOMParser().parseFromString('<div>' + (h || '') + '</div>', 'text/html');
    return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // HTTP qua phần Android (không bị chặn CORS)
  var httpSeq = 0, httpWait = {};
  function httpGet(url) {
    return new Promise(function (ok, fail) {
      var id = 'h' + (++httpSeq);
      httpWait[id] = { ok: ok, fail: fail };
      A.httpGet(url, id);
    });
  }
  function httpPost(url, headers, body) {
    return new Promise(function (ok, fail) {
      var id = 'h' + (++httpSeq);
      httpWait[id] = { ok: ok, fail: fail };
      A.httpPost(url, JSON.stringify(headers), body, id);
    });
  }
  var locSeq = 0, locWait = {};
  function getLocation() {
    return new Promise(function (ok) {
      var id = 'l' + (++locSeq);
      locWait[id] = ok;
      A.getLocation(id);
    });
  }

  // ---------- Đọc to (hàng đợi câu) ----------
  var speakSeq = 0, speakJob = null;
  function splitSpeech(text) {
    var parts = String(text).replace(/\s+/g, ' ').match(/[^.!?…;]+[.!?…;]*\s*/g) || [String(text)];
    var out = [], buf = '';
    parts.forEach(function (p) {
      if ((buf + p).length > 350 && buf) { out.push(buf.trim()); buf = ''; }
      buf += p;
    });
    if (buf.trim()) out.push(buf.trim());
    return out;
  }
  // speak(văn bản hoặc mảng, khi xong) — mỗi lần gọi thay thế lần đọc trước
  function speak(texts, done) {
    stopSpeak(true);
    var list = [];
    (Array.isArray(texts) ? texts : [texts]).forEach(function (t) { if (t) list = list.concat(splitSpeech(t)); });
    var job = { list: list, i: 0, done: done, id: ++speakSeq };
    speakJob = job;
    next();
    function next() {
      if (speakJob !== job) return;
      if (job.i >= job.list.length) { speakJob = null; if (job.done) job.done(); return; }
      var uid = 's' + job.id + '_' + job.i;
      job.waitFor = uid;
      A.speak(job.list[job.i++], uid, job.i === 1);
    }
    job.next = next;
  }
  function stopSpeak(silent) {
    speakJob = null;
    if (!silent) A.stopSpeak();
  }

  // ---------- Đồng hồ, ngày, âm lịch ----------
  var THU = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    var d = new Date();
    $('#clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    var l = lunar(d);
    $('#date').innerHTML = esc(THU[d.getDay()] + ', ' + d.getDate() + '/' + (d.getMonth() + 1)) +
      '<br>' + esc('Âm lịch ' + l[0] + '/' + l[1] + (l[3] ? ' nhuận' : ''));
    tripTick();
  }
  function timeSentence() {
    var d = new Date(), l = lunar(d);
    return 'Bây giờ là ' + d.getHours() + ' giờ ' + d.getMinutes() + ' phút, ' + THU[d.getDay()].toLowerCase() +
      ', ngày ' + d.getDate() + ' tháng ' + (d.getMonth() + 1) + ' năm ' + d.getFullYear() +
      '. Âm lịch là ngày ' + l[0] + ' tháng ' + l[1] + (l[3] ? ' nhuận' : '') + ' năm ' + canChi(l[2]) + '.';
  }
  function canChi(y) {
    var CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
    var CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
    return CAN[(y + 6) % 10] + ' ' + CHI[(y + 8) % 12];
  }
  // Thuật toán âm lịch Việt Nam (Hồ Ngọc Đức), múi giờ +7
  function lunar(date) {
    var TZ = 7, PI = Math.PI, INT = Math.floor;
    function jd(dd, mm, yy) {
      var a = INT((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
      var j = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
      if (j < 2299161) j = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
      return j;
    }
    function newMoon(k) {
      var T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
      var Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
      Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
      var M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
      var Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
      var F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
      var C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
      C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
      C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
      C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
      C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
      C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
      C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
      var deltat = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
        : -0.000278 + 0.000265 * T + 0.000262 * T2;
      return INT(Jd1 + C1 - deltat + 0.5 + TZ / 24);
    }
    function sunLong(jdn) {
      var T = (jdn - 2451545.5 - TZ / 24) / 36525, T2 = T * T, dr = PI / 180;
      var M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
      var L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
      var DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
      DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
      var L = (L0 + DL) * dr;
      L = L - PI * 2 * INT(L / (PI * 2));
      return INT(L / PI * 6);
    }
    function month11(yy) {
      var k = INT((jd(31, 12, yy) - 2415021) / 29.530588853);
      var nm = newMoon(k);
      if (sunLong(nm) >= 9) nm = newMoon(k - 1);
      return nm;
    }
    function leapOffset(a11) {
      var k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5), last, i = 1;
      var arc = sunLong(newMoon(k + i));
      do { last = arc; i++; arc = sunLong(newMoon(k + i)); } while (arc !== last && i < 14);
      return i - 1;
    }
    var dd = date.getDate(), mm = date.getMonth() + 1, yy = date.getFullYear();
    var dn = jd(dd, mm, yy), k = INT((dn - 2415021.076998695) / 29.530588853);
    var ms = newMoon(k + 1);
    if (ms > dn) ms = newMoon(k);
    var a11 = month11(yy), b11 = a11, ly;
    if (a11 >= ms) { ly = yy; a11 = month11(yy - 1); } else { ly = yy + 1; b11 = month11(yy + 1); }
    var ld = dn - ms + 1, diff = INT((ms - a11) / 29), leap = 0, lm = diff + 11;
    if (b11 - a11 > 365) {
      var lo = leapOffset(a11);
      if (diff >= lo) { lm = diff + 10; if (diff === lo) leap = 1; }
    }
    if (lm > 12) lm -= 12;
    if (lm >= 11 && diff < 4) ly -= 1;
    return [ld, lm, ly, leap];
  }

  // ---------- Chuyển màn hình ----------
  var current = 'news';
  function go(name) {
    current = name;
    $$('.view').forEach(function (v) { v.classList.toggle('on', v.id === 'v-' + name); });
    $$('.tab').forEach(function (t) { t.classList.toggle('on', t.dataset.go === name); });
    if (name === 'nav') renderNav();
    if (name === 'set') loadSettings();
  }
  $$('[data-go]').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.go); }); });

  // ---------- TIN TỨC ----------
  var CATS = [
    { id: 'moi', name: 'Mới nhất', vne: 'tin-moi-nhat', tt: 'tin-moi-nhat' },
    { id: 'nong', name: 'Tin nóng', vne: 'tin-noi-bat', tt: 'tin-moi-nhat' },
    { id: 'trongnuoc', name: 'Trong nước', vne: 'thoi-su', tt: 'thoi-su' },
    { id: 'thegioi', name: 'Thế giới', vne: 'the-gioi', tt: 'the-gioi' },
    { id: 'giaoduc', name: 'Giáo dục', vne: 'giao-duc', tt: 'giao-duc' },
    { id: 'kinhdoanh', name: 'Kinh doanh', vne: 'kinh-doanh', tt: 'kinh-doanh' },
    { id: 'thethao', name: 'Thể thao', vne: 'the-thao', tt: 'the-thao' },
    { id: 'suckhoe', name: 'Sức khỏe', vne: 'suc-khoe', tt: 'suc-khoe' },
    { id: 'phapluat', name: 'Pháp luật', vne: 'phap-luat', tt: 'phap-luat' },
    { id: 'congnghe', name: 'Công nghệ', vne: 'so-hoa', tt: 'nhip-song-so' },
    { id: 'xe', name: 'Xe', vne: 'oto-xe-may', tt: 'xe' },
    { id: 'giaitri', name: 'Giải trí', vne: 'giai-tri', tt: 'giai-tri' }
  ];
  var news = { cat: 'moi', items: [], idx: -1, playing: false, cache: {}, token: 0 };

  function feedUrl(cat, source) {
    return source === 'tuoitre' ? 'https://tuoitre.vn/rss/' + cat.tt + '.rss'
      : 'https://vnexpress.net/rss/' + cat.vne + '.rss';
  }
  function parseRss(xml) {
    var doc = new DOMParser().parseFromString(xml, 'text/xml');
    return Array.prototype.slice.call(doc.querySelectorAll('item')).map(function (it) {
      var g = function (t) { var n = it.getElementsByTagName(t)[0]; return n ? n.textContent : ''; };
      var desc = g('description');
      var img = (desc.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
      if (!img) { var enc = it.getElementsByTagName('enclosure')[0]; if (enc) img = enc.getAttribute('url') || ''; }
      var d = new Date(g('pubDate'));
      return { title: stripHtml(g('title')), summary: stripHtml(desc), link: g('link').trim(), img: img, date: isNaN(d) ? null : d };
    }).filter(function (x) { return x.title; });
  }
  function loadCat(catId, force) {
    var cat = CATS.filter(function (c) { return c.id === catId; })[0] || CATS[0];
    news.cat = cat.id;
    renderCats();
    var key = cat.id + '|' + pref('source', 'vnexpress');
    var c = news.cache[key];
    if (!force && c && Date.now() - c.t < 10 * 60 * 1000) { news.items = c.items; news.idx = -1; renderNews(); return Promise.resolve(c.items); }
    $('#newsList').innerHTML = '<li class="empty">Đang tải tin ' + esc(cat.name.toLowerCase()) + '…</li>';
    var src = pref('source', 'vnexpress');
    return httpGet(feedUrl(cat, src)).then(function (r) {
      var items = r.status === 200 ? parseRss(r.body) : [];
      if (!items.length) {
        var other = src === 'tuoitre' ? 'vnexpress' : 'tuoitre';
        return httpGet(feedUrl(cat, other)).then(function (r2) { return r2.status === 200 ? parseRss(r2.body) : []; });
      }
      return items;
    }).then(function (items) {
      items = items.slice(0, 30);
      news.cache[key] = { t: Date.now(), items: items };
      if (news.cat === cat.id) { news.items = items; news.idx = -1; renderNews(); }
      return items;
    }).catch(function () {
      $('#newsList').innerHTML = '<li class="empty">Không tải được tin. Kiểm tra kết nối mạng rồi bấm nút tải lại.</li>';
      return [];
    });
  }
  // Nạp sẵn một mục vào bộ nhớ đệm (để trợ lý AI có ngữ cảnh) mà không đổi màn hình
  function prefetch(catId) {
    var cat = CATS.filter(function (c) { return c.id === catId; })[0];
    var src = pref('source', 'vnexpress');
    return httpGet(feedUrl(cat, src)).then(function (r) {
      var items = r.status === 200 ? parseRss(r.body).slice(0, 30) : [];
      if (items.length) news.cache[cat.id + '|' + src] = { t: Date.now(), items: items };
    }).catch(function () {});
  }
  function renderCats() {
    $('#cats').innerHTML = CATS.map(function (c) {
      return '<button class="chip' + (c.id === news.cat ? ' on' : '') + '" data-cat="' + c.id + '">' + esc(c.name) + '</button>';
    }).join('');
  }
  function ago(d) {
    if (!d) return '';
    var m = Math.round((Date.now() - d.getTime()) / 60000);
    if (m < 1) return 'vừa xong';
    if (m < 60) return m + ' phút trước';
    if (m < 1440) return Math.round(m / 60) + ' giờ trước';
    return d.getDate() + '/' + (d.getMonth() + 1);
  }
  function renderNews() {
    if (!news.items.length) { $('#newsList').innerHTML = '<li class="empty">Chưa có tin trong mục này. Bấm nút tải lại.</li>'; return; }
    $('#newsList').innerHTML = news.items.map(function (n, i) {
      return '<li data-i="' + i + '"' + (i === news.idx ? ' class="reading"' : '') + '><div>' +
        '<div class="t">' + esc(n.title) + '</div>' +
        '<div class="s">' + esc(n.summary) + '</div>' +
        '<div class="m">' + esc(ago(n.date)) + '</div>' +
        '<div class="acts"><button data-read="' + i + '">Nghe tin này</button><button data-full="' + i + '">Nghe cả bài</button></div>' +
        '</div>' + (n.img ? '<img loading="lazy" src="' + esc(n.img) + '" alt="">' : '<span></span>') + '</li>';
    }).join('');
  }
  function setPlayUI() {
    $('#pPlay').innerHTML = news.playing
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg><span>Dừng</span>'
      : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg><span>Đọc</span>';
    $$('#newsList li[data-i]').forEach(function (li) { li.classList.toggle('reading', +li.dataset.i === news.idx); });
  }
  function readItem(i, continuous) {
    if (i < 0 || i >= news.items.length) {
      news.playing = false; setPlayUI();
      if (i >= news.items.length) speak('Đã hết tin trong mục này.');
      return;
    }
    news.idx = i; news.playing = true; setPlayUI();
    var li = $('#newsList li[data-i="' + i + '"]'); if (li) li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    var n = news.items[i];
    var parts = ['Tin ' + (i + 1) + '. ' + n.title + '.'];
    if (!$('#titlesOnly').checked && n.summary) parts.push(n.summary);
    speak(parts, function () {
      var tk = news.token;
      if (continuous && news.playing && news.idx === i) setTimeout(function () {
        if (tk === news.token && news.playing && news.idx === i) readItem(i + 1, true);
      }, 500);
      else { news.playing = false; setPlayUI(); }
    });
  }
  function readFull(i) {
    var n = news.items[i]; if (!n) return;
    news.idx = i; news.playing = true; setPlayUI();
    speak('Đang mở bài: ' + n.title);
    httpGet(n.link).then(function (r) {
      var doc = new DOMParser().parseFromString(r.body, 'text/html');
      var sels = ['.fck_detail p.Normal', '.fck_detail p', '.detail-content p', '.detail-cmain p', 'article p'];
      var paras = [];
      for (var s = 0; s < sels.length && !paras.length; s++) {
        paras = Array.prototype.slice.call(doc.querySelectorAll(sels[s]))
          .map(function (p) { return p.textContent.replace(/\s+/g, ' ').trim(); })
          .filter(function (t) { return t.length > 30; });
      }
      if (!paras.length) paras = [n.summary || 'Không đọc được nội dung bài này.'];
      speak([n.title + '.'].concat(paras), function () { news.playing = false; setPlayUI(); });
    }).catch(function () { speak('Không tải được bài viết.'); news.playing = false; setPlayUI(); });
  }
  function stopNews() { news.token++; news.playing = false; stopSpeak(); setPlayUI(); }

  $('#cats').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cat]'); if (!b) return;
    stopNews(); loadCat(b.dataset.cat);
  });
  $('#newsList').addEventListener('click', function (e) {
    var r = e.target.closest('[data-read]'), f = e.target.closest('[data-full]');
    if (r) readItem(+r.dataset.read, true);
    else if (f) readFull(+f.dataset.full);
  });
  $('#pPlay').addEventListener('click', function () {
    if (news.playing) stopNews(); else readItem(Math.max(0, news.idx), true);
  });
  $('#pNext').addEventListener('click', function () { readItem(news.idx + 1, true); });
  $('#pPrev').addEventListener('click', function () { readItem(Math.max(0, news.idx - 1), true); });
  $('#pReload').addEventListener('click', function () { stopNews(); loadCat(news.cat, true); });
  $('#titlesOnly').addEventListener('change', function () { setPref('titlesOnly', this.checked ? '1' : ''); });

  // ---------- CHỈ ĐƯỜNG ----------
  var NEAR = [
    ['Cây xăng', 'cây xăng'], ['Trạm sạc xe điện', 'trạm sạc xe điện'], ['Bãi đỗ xe', 'bãi đỗ xe ô tô'],
    ['Rửa xe', 'rửa xe ô tô'], ['Sửa xe, gara', 'gara sửa chữa ô tô'], ['Cứu hộ lốp', 'vá lốp ô tô'],
    ['ATM', 'ATM'], ['Quán ăn', 'quán ăn'], ['Cà phê', 'quán cà phê'],
    ['Trạm dừng nghỉ', 'trạm dừng nghỉ'], ['Bệnh viện', 'bệnh viện'], ['Nhà thuốc', 'nhà thuốc']
  ];
  function navigate(dest) {
    dest = (dest || '').trim();
    if (!dest) { speak('Bạn chưa nói điểm đến.'); return; }
    var recent = prefJSON('recent', []).filter(function (x) { return x !== dest; });
    recent.unshift(dest); setPref('recent', JSON.stringify(recent.slice(0, 8)));
    speak('Đang mở chỉ đường đến ' + dest, function () { A.navigateTo(dest); });
  }
  function nearby(q, label) { speak('Đang tìm ' + (label || q) + ' gần bạn', function () { A.searchNearby(q); }); }
  function renderNav() {
    var home = pref('home', ''), work = pref('work', '');
    $('#placeTiles').innerHTML =
      '<button class="tile" data-place="home">Về nhà<small>' + esc(home || 'Đặt địa chỉ trong Cài đặt') + '</small></button>' +
      '<button class="tile" data-place="work">Đến cơ quan<small>' + esc(work || 'Đặt địa chỉ trong Cài đặt') + '</small></button>';
    $('#nearTiles').innerHTML = NEAR.map(function (n, i) { return '<button class="tile" data-near="' + i + '">' + esc(n[0]) + '</button>'; }).join('');
    var rec = prefJSON('recent', []);
    $('#recentList').innerHTML = rec.length ? rec.map(function (r) { return '<li><button data-dest="' + esc(r) + '">' + esc(r) + '</button></li>'; }).join('')
      : '<li class="note">Các điểm bạn đã đi sẽ hiện ở đây.</li>';
    var p = prefJSON('parking', null);
    $('#parkingNote').textContent = p ? 'Đã lưu chỗ đỗ xe lúc ' + new Date(p.t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ngày ' + new Date(p.t).toLocaleDateString('vi-VN') : 'Chưa lưu chỗ đỗ xe.';
  }
  function goPlace(which) {
    var a = pref(which, '');
    if (!a) { speak('Bạn chưa đặt địa chỉ ' + (which === 'home' ? 'nhà' : 'cơ quan') + '. Hãy vào Cài đặt để thêm.'); go('set'); return; }
    navigate(a);
  }
  function saveParking() {
    speak('Đang lưu vị trí xe');
    getLocation().then(function (p) {
      if (!p) { speak('Không lấy được vị trí. Hãy bật định vị và cho phép ứng dụng dùng vị trí.'); return; }
      setPref('parking', JSON.stringify({ lat: p.lat, lng: p.lng, t: Date.now() }));
      renderNav(); speak('Đã lưu vị trí đỗ xe.');
    });
  }
  function goParking() {
    var p = prefJSON('parking', null);
    if (!p) { speak('Bạn chưa lưu chỗ đỗ xe.'); return; }
    speak('Đang dẫn đường về chỗ đỗ xe', function () { A.navigateLatLng(p.lat, p.lng); });
  }
  $('#goBtn').addEventListener('click', function () { navigate($('#dest').value); });
  $('#dest').addEventListener('keydown', function (e) { if (e.key === 'Enter') navigate(this.value); });
  $('#v-nav').addEventListener('click', function (e) {
    var t = e.target.closest('[data-place],[data-near],[data-dest]'); if (!t) return;
    if (t.dataset.place) goPlace(t.dataset.place);
    else if (t.dataset.near) { var n = NEAR[+t.dataset.near]; nearby(n[1], n[0].toLowerCase()); }
    else if (t.dataset.dest) navigate(t.dataset.dest);
  });
  $('#saveParking').addEventListener('click', saveParking);
  $('#goParking').addEventListener('click', goParking);

  // ---------- THỜI TIẾT ----------
  var WMO = {
    0: 'Trời quang', 1: 'Ít mây', 2: 'Có mây', 3: 'Nhiều mây', 45: 'Sương mù', 48: 'Sương mù đóng băng',
    51: 'Mưa phùn nhẹ', 53: 'Mưa phùn', 55: 'Mưa phùn dày', 56: 'Mưa phùn lạnh', 57: 'Mưa phùn lạnh',
    61: 'Mưa nhỏ', 63: 'Mưa vừa', 65: 'Mưa to', 66: 'Mưa lạnh', 67: 'Mưa lạnh to',
    71: 'Tuyết nhẹ', 73: 'Tuyết', 75: 'Tuyết dày', 77: 'Mưa tuyết', 80: 'Mưa rào nhẹ', 81: 'Mưa rào', 82: 'Mưa rào rất to',
    85: 'Mưa tuyết', 86: 'Mưa tuyết', 95: 'Dông', 96: 'Dông kèm mưa đá', 99: 'Dông kèm mưa đá lớn'
  };
  var wx = null;
  function geocode(name) {
    return httpGet('https://geocoding-api.open-meteo.com/v1/search?count=1&language=vi&countryCode=VN&name=' + encodeURIComponent(name))
      .then(function (r) {
        var j = JSON.parse(r.body); var g = j.results && j.results[0];
        if (g) return { lat: g.latitude, lng: g.longitude, name: g.name };
        return httpGet('https://geocoding-api.open-meteo.com/v1/search?count=1&language=vi&name=' + encodeURIComponent(name)).then(function (r2) {
          var j2 = JSON.parse(r2.body); var g2 = j2.results && j2.results[0];
          return g2 ? { lat: g2.latitude, lng: g2.longitude, name: g2.name } : null;
        });
      }).catch(function () { return null; });
  }
  function placeName(lat, lng) {
    return httpGet('https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&accept-language=vi&lat=' + lat + '&lon=' + lng)
      .then(function (r) {
        var a = JSON.parse(r.body).address || {};
        return a.city || a.town || a.county || a.state || a.village || '';
      }).catch(function () { return ''; });
  }
  function fetchWeather(place) {
    var where = place ? geocode(place) : getLocation().then(function (p) {
      if (p) return placeName(p.lat, p.lng).then(function (n) { return { lat: p.lat, lng: p.lng, name: n || 'vị trí của bạn' }; });
      return geocode(pref('city', 'Hà Nội'));
    });
    return where.then(function (loc) {
      if (!loc) throw new Error('noloc');
      var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lng +
        '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
        '&hourly=precipitation_probability&forecast_days=3&timezone=auto';
      return httpGet(url).then(function (r) {
        var j = JSON.parse(r.body);
        var w = { name: loc.name, cur: j.current, daily: j.daily, hourly: j.hourly, t: Date.now() };
        if (!place) { wx = w; renderWeather(); }
        return w;
      });
    });
  }
  function rainSoon(w) {
    if (!w.hourly) return null;
    var now = Date.now(), best = null;
    for (var i = 0; i < w.hourly.time.length; i++) {
      var t = new Date(w.hourly.time[i]).getTime();
      if (t >= now - 3600000 && t <= now + 3 * 3600000) {
        var p = w.hourly.precipitation_probability[i];
        if (best === null || p > best) best = p;
      }
    }
    return best;
  }
  function renderWeather() {
    if (!wx) return;
    var c = wx.cur;
    $('#wxMini').innerHTML = '<b>' + Math.round(c.temperature_2m) + '°</b><span>' + esc(WMO[c.weather_code] || '') + '</span>';
    $('#wxTemp').textContent = Math.round(c.temperature_2m) + '°';
    $('#wxDesc').textContent = (WMO[c.weather_code] || '') + ' · ' + wx.name;
    var rs = rainSoon(wx);
    $('#wxMore').textContent = 'Cảm giác như ' + Math.round(c.apparent_temperature) + '°, độ ẩm ' + c.relative_humidity_2m +
      '%, gió ' + Math.round(c.wind_speed_10m) + ' km/h' + (rs != null ? ', khả năng mưa 3 giờ tới ' + rs + '%' : '');
    var names = ['Hôm nay', 'Ngày mai', 'Ngày kia'];
    $('#wxDays').innerHTML = wx.daily.time.map(function (t, i) {
      return '<div><b>' + names[i] + '</b>' + Math.round(wx.daily.temperature_2m_min[i]) + '° – ' + Math.round(wx.daily.temperature_2m_max[i]) +
        '°<br>' + esc(WMO[wx.daily.weather_code[i]] || '') + '<br>Mưa ' + (wx.daily.precipitation_probability_max[i] || 0) + '%</div>';
    }).join('');
  }
  function weatherSentence(w) {
    var c = w.cur, d = w.daily, rs = rainSoon(w);
    var s = 'Thời tiết ' + w.name + ': ' + (WMO[c.weather_code] || '').toLowerCase() + ', ' + Math.round(c.temperature_2m) +
      ' độ, độ ẩm ' + c.relative_humidity_2m + ' phần trăm. ';
    s += 'Hôm nay từ ' + Math.round(d.temperature_2m_min[0]) + ' đến ' + Math.round(d.temperature_2m_max[0]) + ' độ, khả năng mưa ' + (d.precipitation_probability_max[0] || 0) + ' phần trăm. ';
    if (rs != null && rs >= 60) s += 'Lưu ý: có thể mưa trong ba giờ tới, bạn nên giảm tốc độ và bật đèn. ';
    s += 'Ngày mai ' + (WMO[d.weather_code[1]] || '').toLowerCase() + ', từ ' + Math.round(d.temperature_2m_min[1]) + ' đến ' + Math.round(d.temperature_2m_max[1]) + ' độ.';
    return s;
  }
  function speakWeather(place) {
    speak(place ? 'Đang xem thời tiết ' + place : 'Đang xem thời tiết');
    var p = (!place && wx && Date.now() - wx.t < 15 * 60000) ? Promise.resolve(wx) : fetchWeather(place);
    p.then(function (w) { speak(weatherSentence(w)); })
      .catch(function () { speak('Không lấy được thông tin thời tiết' + (place ? ' cho ' + place : '') + '.'); });
  }
  $('#wxSpeak').addEventListener('click', function () { speakWeather(); });
  $('#wxRefresh').addEventListener('click', function () { $('#wxDesc').textContent = 'Đang cập nhật…'; fetchWeather().catch(function () { $('#wxDesc').textContent = 'Không lấy được thời tiết'; }); });

  // ---------- NHẮC NGHỈ ----------
  var trip = prefJSON('trip', null);
  function tripTick() {
    var el = $('#tripMini');
    if (!trip) { el.classList.remove('on'); return; }
    var mins = Math.floor((Date.now() - trip.start) / 60000);
    el.textContent = Math.floor(mins / 60) + ':' + pad(mins % 60);
    el.classList.add('on');
    var every = +pref('rest', '120');
    if (mins >= trip.nextAt) {
      trip.nextAt = mins + every; setPref('trip', JSON.stringify(trip));
      speak('Bạn đã lái xe liên tục ' + (Math.floor(mins / 60) ? Math.floor(mins / 60) + ' giờ ' : '') + (mins % 60 ? (mins % 60) + ' phút' : '') +
        '. Hãy tìm chỗ an toàn dừng nghỉ khoảng 15 phút, uống nước và vận động cho tỉnh táo.');
    }
  }
  function renderTrip() {
    $('#tripBtn').textContent = trip ? 'Kết thúc chuyến đi' : 'Bắt đầu chuyến đi';
    $('#tripBtn').className = trip ? 'btn stop' : 'btn sign';
    tripTick();
  }
  function startTrip() {
    trip = { start: Date.now(), nextAt: +pref('rest', '120') };
    setPref('trip', JSON.stringify(trip)); renderTrip();
    speak('Bắt đầu chuyến đi. Tôi sẽ nhắc bạn nghỉ sau mỗi ' + Math.round(+pref('rest', '120') / 60 * 10) / 10 + ' giờ. Chúc thượng lộ bình an.');
  }
  function endTrip() {
    if (!trip) return;
    var mins = Math.floor((Date.now() - trip.start) / 60000);
    trip = null; setPref('trip', ''); renderTrip();
    speak('Kết thúc chuyến đi. Bạn đã lái ' + Math.floor(mins / 60) + ' giờ ' + (mins % 60) + ' phút.');
  }
  $('#tripBtn').addEventListener('click', function () { trip ? endTrip() : startTrip(); });

  // ---------- TIỆN ÍCH KHÁC ----------
  $$('[data-dial]').forEach(function (b) { b.addEventListener('click', function () { A.dial(b.dataset.dial); }); });
  $('#callFamily').addEventListener('click', function () {
    var n = pref('family', ''); if (!n) { speak('Bạn chưa đặt số người thân trong Cài đặt.'); go('set'); return; }
    A.dial(n);
  });
  $('#musicBtn').addEventListener('click', function () { A.playMusic('nhạc'); });
  $('#fineBtn').addEventListener('click', function () { A.openUrl('https://www.csgt.vn/tra-cuu-phuong-tien-vi-pham.html'); });
  $('#fuelBtn').addEventListener('click', function () { go('ai'); askAI('Giá xăng RON 95 và E5 RON 92, dầu diesel hôm nay ở Việt Nam là bao nhiêu? Lần điều chỉnh gần nhất là khi nào?'); });
  $('#timeBtn').addEventListener('click', function () { speak(timeSentence()); });

  // ---------- TRỢ LÝ AI ----------
  var chat = [];
  var DEFAULT_MODEL = { gemini: 'gemini-flash-latest', claude: 'claude-sonnet-5-5' };
  function addMsg(role, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + role; d.textContent = text;
    $('#chatLog').appendChild(d);
    d.scrollIntoView({ block: 'end' });
    return d;
  }
  function headlinesContext() {
    var c = news.cache['moi|' + pref('source', 'vnexpress')] || news.cache['nong|' + pref('source', 'vnexpress')];
    if (!c) return '';
    return 'Các tiêu đề tin mới nhất ứng dụng vừa tải:\n' + c.items.slice(0, 12).map(function (n) { return '- ' + n.title; }).join('\n');
  }
  function systemPrompt() {
    var s = 'Bạn là trợ lý giọng nói trong ô tô, nói tiếng Việt. Người dùng đang lái xe và nghe câu trả lời qua loa, ' +
      'nên hãy trả lời ngắn gọn (thường 2 đến 5 câu), rõ ràng, không dùng markdown, không gạch đầu dòng, không ký hiệu, không đường link. ' +
      'Viết số theo cách đọc tự nhiên. Với câu hỏi về tin tức, giá cả, sự kiện, thời tiết hay bất cứ điều gì có thể đã thay đổi, hãy tìm kiếm trên web để có thông tin mới nhất. ' +
      'Không khuyến khích người dùng thao tác điện thoại khi đang lái.\n' +
      'Thời điểm hiện tại: ' + timeSentence() + '\n';
    if (wx) s += 'Thời tiết hiện tại ở ' + wx.name + ': ' + weatherSentence(wx) + '\n';
    var h = headlinesContext(); if (h) s += h + '\n';
    return s;
  }
  function callGemini(key, model, sys, msgs, useSearch) {
    var body = {
      system_instruction: { parts: [{ text: sys }] },
      contents: msgs.map(function (m) { return { role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }; }),
      generationConfig: { temperature: 0.6, maxOutputTokens: 800 }
    };
    if (useSearch) body.tools = [{ google_search: {} }];
    return httpPost('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      { 'Content-Type': 'application/json', 'x-goog-api-key': key }, JSON.stringify(body)).then(function (r) {
        var j; try { j = JSON.parse(r.body); } catch (e) { throw new Error(r.body.slice(0, 200)); }
        if (r.status !== 200) {
          if (useSearch && r.status === 400) return callGemini(key, model, sys, msgs, false);
          throw new Error((j.error && j.error.message) || ('Lỗi ' + r.status));
        }
        var parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
        return parts.map(function (p) { return p.text || ''; }).join('').trim();
      });
  }
  function callClaude(key, model, sys, msgs, useSearch) {
    var body = {
      model: model, max_tokens: 1024, system: sys,
      messages: msgs.map(function (m) { return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text }; })
    };
    if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
    return httpPost('https://api.anthropic.com/v1/messages',
      { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, JSON.stringify(body)).then(function (r) {
        var j; try { j = JSON.parse(r.body); } catch (e) { throw new Error(r.body.slice(0, 200)); }
        if (r.status !== 200) {
          if (useSearch && r.status === 400) return callClaude(key, model, sys, msgs, false);
          throw new Error((j.error && j.error.message) || ('Lỗi ' + r.status));
        }
        return (j.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('').trim();
      });
  }
  function cleanForSpeech(t) {
    return t.replace(/\*\*|__|`|#+\s/g, '').replace(/^\s*[-*•]\s+/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '');
  }
  var aiBusy = false;
  function askAI(q) {
    q = (q || '').trim(); if (!q || aiBusy) return;
    var provider = pref('provider', 'gemini'), key = pref('key_' + provider, '');
    addMsg('me', q);
    if (!key) {
      var m = 'Bạn chưa nhập khóa API cho trợ lý AI. Hãy vào Cài đặt, ở mục Khóa API.';
      addMsg('sys', m); speak(m); return;
    }
    aiBusy = true;
    if (news.playing) stopNews();
    var wait = addMsg('ai', 'Đang tìm câu trả lời…');
    chat.push({ role: 'user', text: q });
    var model = pref('model_' + provider, '') || DEFAULT_MODEL[provider];
    var call = provider === 'claude' ? callClaude : callGemini;
    var ensureContext = wx ? Promise.resolve() : Promise.race([
      fetchWeather().catch(function () {}),
      new Promise(function (r) { setTimeout(r, 4000); })
    ]);
    ensureContext.then(function () { return call(key, model, systemPrompt(), chat.slice(-12), true); })
      .then(function (ans) {
        ans = cleanForSpeech(ans || 'Xin lỗi, tôi chưa có câu trả lời.');
        wait.textContent = ans;
        chat.push({ role: 'model', text: ans });
        if ($('#autoRead').checked) speak(ans, function () { if ($('#convo').checked && current === 'ai') listen(); });
      })
      .catch(function (e) {
        chat.pop();
        wait.className = 'msg sys';
        wait.textContent = 'Không gọi được trợ lý AI: ' + e.message;
        speak('Không gọi được trợ lý AI. Kiểm tra mạng hoặc khóa API.');
      })
      .then(function () { aiBusy = false; });
  }
  var SUGG = ['Tin nổi bật sáng nay là gì?', 'Chiều nay có mưa không?', 'Giá vàng hôm nay', 'Đường nào hay tắc giờ cao điểm ở Hà Nội?', 'Kể một câu chuyện cười ngắn'];
  $('#aiSuggest').innerHTML = SUGG.map(function (s) { return '<button>' + esc(s) + '</button>'; }).join('');
  $('#aiSuggest').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) askAI(b.textContent); });
  $('#chatSend').addEventListener('click', function () { var v = $('#chatIn').value; $('#chatIn').value = ''; askAI(v); });
  $('#chatIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') { var v = this.value; this.value = ''; askAI(v); } });
  ['autoRead', 'convo'].forEach(function (id) {
    var el = $('#' + id), v = pref(id, '');
    if (v) el.checked = v === '1';
    el.addEventListener('change', function () { setPref(id, el.checked ? '1' : '0'); });
  });
  addMsg('sys', 'Hỏi bất cứ điều gì: tin tức, thời tiết, giá cả, kiến thức… Bấm micro to ở giữa để nói.');

  // ---------- CÀI ĐẶT ----------
  function keyHelp() {
    var p = $('#sProvider').value;
    $('#keyHelp').innerHTML = p === 'gemini'
      ? 'Lấy khóa miễn phí tại aistudio.google.com/apikey (đăng nhập tài khoản Google, bấm "Create API key").'
      : 'Lấy khóa tại console.anthropic.com, mục API Keys. Dịch vụ này tính phí theo lượng dùng.';
    $('#sModel').placeholder = DEFAULT_MODEL[p];
    $('#sKey').value = pref('key_' + p, '');
    $('#sModel').value = pref('model_' + p, '');
  }
  function loadSettings() {
    $('#sProvider').value = pref('provider', 'gemini');
    keyHelp();
    $('#sHome').value = pref('home', ''); $('#sWork').value = pref('work', '');
    $('#sFamily').value = pref('family', ''); $('#sCity').value = pref('city', '');
    $('#sRate').value = pref('rate', '1'); $('#sRest').value = pref('rest', '120');
    $('#sSource').value = pref('source', 'vnexpress');
  }
  $('#sProvider').addEventListener('change', keyHelp);
  $('#saveSet').addEventListener('click', function () {
    var p = $('#sProvider').value;
    setPref('provider', p);
    setPref('key_' + p, $('#sKey').value.trim());
    setPref('model_' + p, $('#sModel').value.trim());
    setPref('home', $('#sHome').value.trim()); setPref('work', $('#sWork').value.trim());
    setPref('family', $('#sFamily').value.trim()); setPref('city', $('#sCity').value.trim());
    setPref('rate', $('#sRate').value); setPref('rest', $('#sRest').value);
    var srcChanged = pref('source', 'vnexpress') !== $('#sSource').value;
    setPref('source', $('#sSource').value);
    A.setSpeechRate(parseFloat($('#sRate').value));
    renderFamily();
    if (srcChanged) loadCat(news.cat, true);
    speak('Đã lưu cài đặt.');
    A.toastMsg('Đã lưu cài đặt');
  });
  function renderFamily() { var n = pref('family', ''); $('#familyNum').textContent = n || 'Chưa đặt số'; }

  // ---------- LỆNH GIỌNG NÓI ----------
  var micBusy = false;
  function listen() {
    if (micBusy) return;
    micBusy = true; $('#mic').classList.add('busy');
    stopSpeak();
    A.listen('Bạn cần gì?');
  }
  function showHeard(t) {
    var h = $('#heard'); h.textContent = '“' + t + '”'; h.classList.add('on');
    clearTimeout(showHeard.t); showHeard.t = setTimeout(function () { h.classList.remove('on'); }, 3500);
  }
  function after(text, re) {
    // Lấy phần câu gốc (có dấu) nằm sau cụm khớp re trong bản không dấu
    var m = nd(text).match(re); if (!m) return '';
    return text.slice(m.index + m[0].length).replace(/^[\s,.:]+|[\s?.!]+$/g, '');
  }
  var CAT_WORDS = [
    [/the gioi|quoc te/, 'thegioi'], [/trong nuoc|thoi su|xa hoi/, 'trongnuoc'], [/giao duc|hoc duong|thi cu/, 'giaoduc'],
    [/nong|noi bat|quan trong|hot/, 'nong'], [/kinh doanh|kinh te|tai chinh|chung khoan/, 'kinhdoanh'], [/the thao|bong da/, 'thethao'],
    [/suc khoe|y te/, 'suckhoe'], [/phap luat|an ninh/, 'phapluat'], [/cong nghe|so hoa/, 'congnghe'], [/xe|giao thong/, 'xe'],
    [/giai tri|van hoa/, 'giaitri'], [/moi|moi nhat/, 'moi']
  ];
  var NEAR_WORDS = [
    [/cay xang|tram xang|do xang|bom xang/, 'cây xăng'], [/tram sac|sac xe|sac dien/, 'trạm sạc xe điện'],
    [/bai do|bai gui|cho do|do xe/, 'bãi đỗ xe ô tô'], [/rua xe/, 'rửa xe ô tô'], [/sua xe|gara|garage/, 'gara sửa chữa ô tô'],
    [/va lop|lop xe|thung lop/, 'vá lốp ô tô'], [/\batm\b|rut tien/, 'ATM'], [/nha hang|quan an|an trua|an toi|an sang|an com/, 'quán ăn'],
    [/ca phe|cafe|cafe/, 'quán cà phê'], [/benh vien/, 'bệnh viện'], [/nha thuoc|hieu thuoc/, 'nhà thuốc'],
    [/khach san|nha nghi/, 'khách sạn'], [/tram dung nghi|dung nghi/, 'trạm dừng nghỉ'], [/nha ve sinh|toilet/, 'nhà vệ sinh công cộng']
  ];
  function handleCommand(text) {
    var t = nd(text).trim(), m, i;
    // Lệnh mới thì ngắt việc đọc tin đang chạy (các lệnh tin tức sẽ tự bật lại)
    news.token++; news.playing = false; setPlayUI();
    // Dừng / điều khiển đọc
    if (/^(dung|tam dung|ngung|stop|im lang|im di|thoi doc|thoi di|thoi khong doc)\b/.test(t) || /^(thoi|im)$/.test(t)) { stopNews(); return; }
    if (/^(tiep|tin tiep|tin sau|tiep theo|bo qua|qua tin)/.test(t)) { readItem(news.idx + 1, true); return; }
    if (/^(doc lai|tin truoc|quay lai tin)/.test(t)) { readItem(Math.max(0, news.idx - (t.indexOf('truoc') >= 0 ? 1 : 0)), true); return; }
    if (/doc (ca|toan|het) bai|doc chi tiet/.test(t)) { readFull(Math.max(0, news.idx)); return; }
    // Giờ, ngày
    if (/may gio|bay gio la|gio roi|hom nay (la )?(ngay|thu)|ngay bao nhieu|am lich/.test(t)) { speak(timeSentence()); return; }
    // Nhà, cơ quan, chỗ đỗ xe
    if (/^(ve nha|di ve nha|chi duong ve nha|dan duong ve nha)/.test(t)) { goPlace('home'); return; }
    if (/(den|toi|ve) (co quan|cong ty|noi lam viec|van phong)/.test(t)) { goPlace('work'); return; }
    if (/luu (cho|vi tri|noi)? ?(do|dau) xe|nho cho do/.test(t)) { saveParking(); return; }
    if (/(xe (cua )?toi|cho do xe|xe) (o|dau)|quay lai (cho do|xe)|tim xe/.test(t)) { goParking(); return; }
    // Tìm quanh đây
    if (/(tim|gan day|gan nhat|quanh day|o dau|dau co|chi duong den|dan duong den)/.test(t) || t.split(' ').length <= 4) {
      for (i = 0; i < NEAR_WORDS.length; i++) if (NEAR_WORDS[i][0].test(t)) { go('nav'); nearby(NEAR_WORDS[i][1]); return; }
    }
    // Chỉ đường
    var dest = after(text, /\b(chi duong|dan duong|duong di|duong den|duong toi|dua toi|cho toi|di|tim duong)\s+(den|toi|ra|vao|sang|ve)?\s*/);
    if (/^(chi duong|dan duong|duong den|duong toi|dua toi|cho toi den|cho toi toi|di den|di toi|tim duong|toi muon di|minh muon di)/.test(t) && dest) {
      go('nav'); $('#dest').value = dest; navigate(dest); return;
    }
    // Thời tiết
    if (/thoi tiet|nhiet do|co mua|mua khong|troi nang|nong khong|lanh khong/.test(t)) {
      if (/ngay mai|tuan|chieu|toi nay|sang mai/.test(t) && pref('key_' + pref('provider', 'gemini'), '')) { go('ai'); askAI(text); return; }
      var place = after(text, /(thoi tiet|nhiet do)\s+(o|tai|cua)?\s*/);
      var cut = nd(place).search(/(hom nay|bay gio|the nao|ra sao|nhu nao|nhu the nao|co mua|khong)/);
      if (cut >= 0) place = place.slice(0, cut);
      place = place.replace(/[\s,?]+$/, '').trim();
      if (place.length < 2) place = '';
      speakWeather(place); return;
    }
    // Tin tức
    if (/^(doc|nghe|mo|bat|cho toi nghe|cho nghe|xem)?\s*(ban )?(tin|thoi su|bao)/.test(t) || /^tin\b/.test(t)) {
      var cat = 'moi';
      for (i = 0; i < CAT_WORDS.length; i++) if (CAT_WORDS[i][0].test(t.replace(/^.*?(tin|bao)\s*/, ''))) { cat = CAT_WORDS[i][1]; break; }
      go('news'); stopNews();
      var name = CATS.filter(function (c) { return c.id === cat; })[0].name;
      speak('Đọc tin ' + name.toLowerCase());
      var tk = news.token;
      loadCat(cat).then(function () { setTimeout(function () { if (tk === news.token) readItem(0, true); }, 1200); });
      return;
    }
    // Nhạc
    if ((m = t.match(/^(mo|phat|bat|nghe|cho nghe)\s+(nhac|bai hat|bai)\s*/))) {
      var song = text.slice(m[0].length).trim();
      A.playMusic(song || 'nhạc'); return;
    }
    // Gọi điện
    if (/^goi\b/.test(t)) {
      if (/cuu thuong|cap cuu|115/.test(t)) { A.dial('115'); return; }
      if (/cong an|canh sat|113/.test(t)) { A.dial('113'); return; }
      if (/cuu hoa|chua chay|cuu nan|114/.test(t)) { A.dial('114'); return; }
      if (/nguoi than|ve nha|gia dinh|vo|chong/.test(t) && pref('family', '')) { A.dial(pref('family', '')); return; }
      var num = t.replace(/[^0-9]/g, '');
      if (num.length >= 3) { A.dial(num); return; }
    }
    // Chuyến đi
    if (/bat dau (chuyen|hanh trinh|lai)/.test(t)) { startTrip(); return; }
    if (/ket thuc (chuyen|hanh trinh)/.test(t)) { endTrip(); return; }
    // Còn lại: hỏi trợ lý AI
    go('ai'); askAI(text);
  }

  $('#mic').addEventListener('click', function () {
    if (micBusy) return;
    if (speakJob || news.playing) { stopNews(); }
    listen();
  });

  // ---------- Lệnh từ phía Android gọi vào ----------
  window.App = {
    onHttp: function (id, status, body) {
      var w = httpWait[id]; if (!w) return; delete httpWait[id];
      if (status === 0) w.fail(new Error(body)); else w.ok({ status: status, body: body });
    },
    onLocation: function (id, lat, lng) {
      var w = locWait[id]; if (!w) return; delete locWait[id];
      w(lat == null ? null : { lat: lat, lng: lng });
    },
    onSpeakDone: function (uid) {
      if (speakJob && speakJob.waitFor === uid) speakJob.next();
    },
    onVoice: function (text) {
      micBusy = false; $('#mic').classList.remove('busy');
      if (!text) return;
      showHeard(text);
      handleCommand(text);
    },
    onTtsReady: function (ok) {
      $('#ttsNote').textContent = ok ? '' : 'Máy chưa có giọng đọc tiếng Việt. Vào Cài đặt điện thoại › Hệ thống › Ngôn ngữ › Chuyển văn bản thành giọng nói, chọn Google và tải giọng Tiếng Việt.';
      if (!ok) A.toastMsg('Chưa có giọng đọc tiếng Việt — xem mục Cài đặt');
      A.setSpeechRate(parseFloat(pref('rate', '1')));
    },
    onPermission: function () { fetchWeather().catch(function () {}); },
    onBack: function () {
      if (current !== 'news') { go('news'); return true; }
      if (speakJob || news.playing) { stopNews(); return true; }
      return false;
    },
    // dùng khi thử nghiệm
    _cmd: handleCommand, _lunar: lunar, _nd: nd
  };

  // ---------- Khởi động ----------
  $('#titlesOnly').checked = pref('titlesOnly', '') === '1';
  renderCats(); renderFamily(); renderTrip(); tick();
  setInterval(tick, 15000);
  loadCat('moi').then(function () { prefetch('nong'); });
  fetchWeather().catch(function () { $('#wxMini').innerHTML = '<b>--°</b><span>Chưa có thời tiết</span>'; });
  setInterval(function () { fetchWeather().catch(function () {}); }, 20 * 60000);
})();
