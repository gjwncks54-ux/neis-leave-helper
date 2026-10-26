/* NEIS Leave Request Helper (English) v1.3  — based on 근무상황 신청 도우미 v2.1
 * 복무 > 개인근무상황관리 > 신청 → fill → 승인요청 → approval line → 상신
 * Default: stops at the "상신하겠습니까?" confirm box. "Submit directly" clicks 확인 too (asks first).
 * Settings are saved in this browser only when "Remember on this PC" is checked.
 */
(function () {
  'use strict';
  var PANEL_ID = 'neis-gm-helper-en', STORE = 'neisLeaveHelperEn.v1';

  /* Approver choices come from the bookmark (window.NEIS_LEAVE_CFG), so no names live in this public file.
   * e.g. { reviewers:[{name:'홍길동',role:'Teacher',on:true}], finals:[{name:'김교장',role:'Principal',on:true}] } */
  var CFG0 = window.NEIS_LEAVE_CFG || {};
  function normList(l) { return (l || []).map(function (u) { return { name: String(u.name || '').trim(), role: u.role || '', on: !!u.on }; }).filter(function (u) { return u.name; }); }
  var REVIEWERS = normList(CFG0.reviewers), FINALS = normList(CFG0.finals);

  var old = document.getElementById(PANEL_ID);
  if (old) { old.style.display = 'block'; return; }
  if (!window.cpr || !cpr.core) { alert('Please run this on the NEIS (4th gen) page.'); return; }

  var TYPES = [
    ['W01', 'W0104', 'Annual leave / Early leave (조퇴)'],
    ['W01', 'W0101', 'Annual leave / Full day (연가)'],
    ['W01', 'W0102', 'Annual leave / Half day (반일연가)'],
    ['W01', 'W0105', 'Annual leave / Going out (외출)'],
    ['W01', 'W0103', 'Annual leave / Late arrival (지각)'],
    ['W02', 'W0205', 'Sick leave / Early leave (병조퇴)'],
    ['W02', 'W0201', 'Sick leave / Full day (병가)'],
    ['W02', 'W0203', 'Sick leave / Half day (반일병가)'],
    ['W02', 'W0206', 'Sick leave / Going out (병외출)'],
    ['W02', 'W0204', 'Sick leave / Late arrival (병지각)']
  ];
  var AV_RSN = [
    ['01', 'No.1: Birthday of own/spouse\'s parents or grandparents'],
    ['02', 'No.2: Memorial day of spouse or own/spouse\'s parents/grandparents'],
    ['03', 'No.3: Caring for a sick or injured family member'],
    ['04', 'No.4: Continued recovery after using all sick leave'],
    ['05', 'No.5: KNOU class attendance / graduate school exam'],
    ['06', 'No.6: Funeral of a sibling of own/spouse\'s parents'],
    ['07', 'No.7: Funeral of a sibling\'s spouse (own/spouse\'s side)'],
    ['08', 'No.8: Child\'s military enlistment day'],
    ['09', 'No.9: Other reason approved by the principal']
  ];
  var KIND_CODE = { '결재': '2', '검토': '7' };
  var WORK_START = '08:30', WORK_END = '16:30';

  function loadCfg() { try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch (e) { return null; } }
  function saveCfg(c) { localStorage.setItem(STORE, JSON.stringify(c)); }
  function clearCfg() { localStorage.removeItem(STORE); }
  var saved = loadCfg();

  /* ---------- NEIS helpers ---------- */
  function apps() { return cpr.core.Platform.INSTANCE.getAllRunningAppInstances(); }
  function app(part) { return apps().filter(function (a) { return a.id.indexOf(part) >= 0; })[0]; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function readAlert() {
    var els = document.querySelectorAll('.cl-dialog.modal-msg');
    for (var i = 0; i < els.length; i++) {
      var t = els[i].innerText.replace(/\s+/g, ' ').trim();
      if (/^알림/.test(t)) return t.replace(/^알림\s*/, '').replace(/\s*확인$/, '');
    }
    return null;
  }
  function dismissAlert() {
    var a = apps().filter(function (x) { return x.id.indexOf('app/cmn/alert') === 0; })[0];
    if (!a) return false;
    var b = a.getContainer().getAllRecursiveChildren().filter(function (c) { return c.type === 'button'; })[0];
    if (b) { b.click(); return true; }
    return false;
  }
  function confirmShown(text) {
    var els = document.querySelectorAll('.cl-dialog.modal-msg');
    for (var i = 0; i < els.length; i++) if (els[i].innerText.indexOf(text) >= 0) return true;
    return false;
  }
  async function waitFor(fn, ms, label) {
    var end = Date.now() + (ms || 10000), last = Date.now();
    while (Date.now() < end) {
      if (userCancelled) throw new Error('You clicked Cancel on the NEIS question: ' + userCancelled);
      var nowT = Date.now(); if (nowT - last > 3000) end += nowT - last; last = nowT;
      var am = readAlert();
      if (am) throw new Error('NEIS message (Korean): ' + am);
      try { var v = fn(); if (v) return v; } catch (e) { }
      await sleep(200);
    }
    throw new Error('Timed out waiting for: ' + (label || 'screen'));
  }
  /* NEIS sometimes asks with a native browser confirm(). While the helper runs:
   * - the known "excess annual leave" notice is auto-confirmed (natives' leave does not reset yearly)
   * - any other question is shown with an English note; Cancel stops the helper */
  var nativeConfirm = window.confirm, hookOn = false, userCancelled = '';
  function hookConfirm(logFn) {
    if (hookOn) return; hookOn = true; userCancelled = '';
    window.confirm = function (msg) {
      var m = String(msg || '');
      if (/금년도연가/.test(m) && /초과일수/.test(m) && /신청하시겠습니까/.test(m)) {
        var have = (m.match(/신청할 수 있는 금년도연가는\s*([^\n.]+?)입니다/) || [])[1] || '';
        var req = (m.match(/금년도연가 합산은\s*([^\n.]+?)입니다/) || [])[1] || '';
        logFn('   NEIS notice auto-confirmed: annual leave left ' + have + ', requested ' + req + ' → counted as excess leave (초과일수).');
        return true;
      }
      logFn('   NEIS question (Korean): ' + m.replace(/\s+/g, ' '));
      var ok = nativeConfirm.call(window, '[Leave Helper] NEIS is asking a question (Korean below).\nOK = continue, Cancel = stop.\n\n' + m);
      if (!ok) userCancelled = m.replace(/\s+/g, ' ');
      return ok;
    };
  }
  function unhookConfirm() { if (hookOn) { window.confirm = nativeConfirm; hookOn = false; } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(v) { return v.replace(/-/g, ''); }

  /* ---------- UI ---------- */
  var P_ = '#' + PANEL_ID;
  var css = P_ + '{position:fixed;top:70px;right:24px;z-index:2147483000;width:360px;max-height:calc(100vh - 90px);overflow:auto;resize:both;min-width:300px;min-height:120px;background:#fff;border:1px solid #2b5fd9;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);font:13px/1.5 "Segoe UI","Malgun Gothic",sans-serif;color:#222}' +
    P_ + ' .hd{position:sticky;top:0;background:#2b5fd9;color:#fff;padding:8px 12px;cursor:move;display:flex;justify-content:space-between;align-items:center;font-weight:bold}' +
    P_ + ' .hd button{background:none;border:0;color:#fff;font-size:16px;cursor:pointer;margin-left:6px;line-height:1}' +
    P_ + '.folded{resize:none;height:auto!important;min-height:0!important;overflow:hidden}' + P_ + '.folded .bd{display:none}' +
    P_ + ' .bd{padding:8px 12px 12px}' +
    P_ + ' .sec{border:1px solid #dde3ef;border-radius:6px;padding:6px 10px 10px;margin-top:8px}' +
    P_ + ' .sec h4{margin:0 0 2px;font-size:13px;color:#2b5fd9;display:flex;justify-content:space-between;align-items:center}' +
    P_ + ' .sec h4 a{font-size:12px;font-weight:normal;cursor:pointer;color:#2b5fd9;text-decoration:underline}' +
    P_ + ' label.t{display:block;margin:6px 0 2px;font-weight:bold;font-size:12px;color:#444}' +
    P_ + ' select,' + P_ + ' input[type=text],' + P_ + ' input[type=date],' + P_ + ' input[type=time],' + P_ + ' input[type=tel]{width:100%;box-sizing:border-box;padding:4px 6px;border:1px solid #bbb;border-radius:4px;font-size:13px}' +
    P_ + ' .row{display:flex;gap:6px;align-items:center}' + P_ + ' .row>input,' + P_ + ' .row>select{flex:1}' +
    P_ + ' .inl{font-weight:normal;margin-right:10px;font-size:12px;cursor:pointer}' +
    P_ + ' .chk{display:block;font-weight:normal;font-size:13px;cursor:pointer;margin:1px 0 1px 4px}' +
    P_ + ' .chk small{color:#777}' +
    P_ + ' .sum{font-size:12px;color:#333;background:#f5f7fb;border-radius:4px;padding:4px 6px}' +
    P_ + ' .go{margin-top:6px;width:100%;padding:8px;background:#2b5fd9;color:#fff;border:0;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer}' +
    P_ + ' .go:disabled{background:#999}' +
    P_ + ' .sm{padding:2px 8px;font-size:12px;border:1px solid #bbb;background:#fff;border-radius:4px;cursor:pointer}' +
    P_ + ' .hint{font-size:11px;color:#777;font-weight:normal}' +
    P_ + ' .log{margin-top:8px;max-height:200px;overflow:auto;background:#f5f7fb;border-radius:4px;padding:6px;font-size:12px;white-space:pre-wrap}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function chkList(group, list) {
    return list.map(function (u, i) {
      return '<label class="chk"><input type="checkbox" data-g="' + group + '" data-i="' + i + '"' + (u.on ? ' checked' : '') + '> ' + u.name + ' <small>· ' + u.role + '</small></label>';
    }).join('');
  }
  var now = new Date(), today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  var p = document.createElement('div'); p.id = PANEL_ID;
  p.innerHTML =
    '<div class="hd"><span>NEIS Leave Request Helper</span><span><button data-k="fold" title="Fold">–</button><button data-k="x" title="Close">×</button></span></div>' +
    '<div class="bd">' +
    '<div class="sec"><h4>My settings <a data-k="edit" style="display:none">Edit</a></h4>' +
    '<div data-k="sum" class="sum" style="display:none"></div>' +
    '<div data-k="cfg">' +
    '<label class="t">Phone number</label><input type="tel" data-k="phone" placeholder="01012345678">' +
    '<label class="t">Approval line</label>' +
    '<label class="inl"><input type="radio" name="gmen-mode" value="direct" checked> Choose approvers</label>' +
    '<label class="inl"><input type="radio" name="gmen-mode" value="personal"> My saved NEIS line</label>' +
    '<div data-k="directbox">' +
    (REVIEWERS.length || FINALS.length ? '' : '<div class="hint">No approvers are set in this bookmark. Use "My saved NEIS line" or ask for a bookmark with your school\'s approvers.</div>') +
    '<label class="t">Review (검토) <span class="hint">check all that apply</span></label>' + chkList('rev', REVIEWERS) +
    '<label class="t">Final approval (결재) <span class="hint">choose one</span></label>' + chkList('fin', FINALS) +
    '</div>' +
    '<div data-k="personalbox" style="display:none"><label class="t">Saved line number <span class="hint">(order in NEIS "개인 결재선 지정")</span></label><select data-k="lineNo"><option value="">Select</option>' +
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<option value="' + n + '">No. ' + n + '</option>'; }).join('') + '</select></div>' +
    '<label class="t">Keep private</label>' +
    '<label class="inl"><input type="checkbox" data-k="hp" checked> Dates</label>' +
    '<label class="inl"><input type="checkbox" data-k="hr" checked> Reason</label>' +
    '<div class="row" style="margin-top:8px;justify-content:space-between">' +
    '<label class="inl"><input type="checkbox" data-k="remember"> Remember on this PC</label>' +
    '<button class="sm" data-k="forget">Forget</button></div>' +
    '</div></div>' +
    '<div class="sec"><h4>This request</h4>' +
    '<label class="t">Leave type</label><select data-k="type">' + TYPES.map(function (x, i) { return '<option value="' + i + '">' + x[2] + '</option>'; }).join('') + '</select>' +
    '<label class="t">Date</label><div class="row"><input type="date" data-k="d1" value="' + today + '"><span>~</span><input type="date" data-k="d2" value="' + today + '"></div>' +
    '<label class="t">Time <span class="hint">(5-minute steps)</span></label><div class="row"><input type="time" step="300" data-k="t1" value="13:00"><span>~</span><input type="time" step="300" data-k="t2" value="' + WORK_END + '"></div>' +
    '<div data-k="avbox" style="display:none"><label class="t">Annual leave reason</label><select data-k="av">' + AV_RSN.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('') + '</select></div>' +
    '<div data-k="rsnbox"><label class="t">Reason</label><input type="text" data-k="rsn" placeholder="e.g. Hospital visit"></div>' +
    '</div>' +
    '<div class="row" style="margin-top:10px">' +
    '<label class="inl"><input type="radio" name="gmen-fin" value="stop" checked> Stop at confirm box</label>' +
    '<label class="inl" style="color:#c0392b"><input type="radio" name="gmen-fin" value="submit"> Submit directly</label></div>' +
    '<button class="go">Start</button>' +
    '<div class="log" style="display:none"></div>' +
    '<button class="sm" data-k="copy" style="margin-top:6px;display:none">Copy log</button>' +
    '</div>';
  document.body.appendChild(p);

  function q(k) { return p.querySelector('[data-k="' + k + '"]'); }
  function boxes(g) { return Array.prototype.slice.call(p.querySelectorAll('input[data-g="' + g + '"]')); }
  function mode() { return p.querySelector('input[name="gmen-mode"]:checked').value; }
  function setMode(m) { p.querySelector('input[name="gmen-mode"][value="' + m + '"]').checked = true; refreshMode(); }
  function finMode() { return p.querySelector('input[name="gmen-fin"]:checked').value; }
  var logEl = p.querySelector('.log'), goBtn = p.querySelector('.go');
  function log(m) { logEl.style.display = 'block'; q('copy').style.display = 'inline-block'; logEl.textContent += m + '\n'; logEl.scrollTop = 1e6; }
  q('copy').onclick = function () {
    var t = '[NEIS Leave Helper EN v1.2] ' + new Date().toLocaleString() + '\n' + logEl.textContent.replace(/01\d{8,9}/g, '010********');
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { q('copy').textContent = 'Copied!'; setTimeout(function () { q('copy').textContent = 'Copy log'; }, 1500); },
      function () { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); q('copy').textContent = 'Copied!'; });
  };

  var UI_KEY = STORE + '.ui', ui = {};
  try { ui = JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { ui = {}; }
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { } }
  function setFold(f, quiet) {
    if (f) { if (p.style.height) ui.h = p.getBoundingClientRect().height; p.classList.add('folded'); p.style.height = ''; }
    else { p.classList.remove('folded'); if (ui.h) p.style.height = Math.min(ui.h, innerHeight - 20) + 'px'; }
    q('fold').textContent = f ? '\u25A2' : '\u2013'; q('fold').title = f ? 'Expand' : 'Fold';
    ui.folded = f; if (!quiet) saveUi();
  }
  q('x').onclick = function () { p.style.display = 'none'; };
  q('fold').onclick = function () { setFold(!p.classList.contains('folded')); };
  (function drag() {
    var hd = p.querySelector('.hd'), sx, sy, ox, oy;
    hd.onmousedown = function (e) {
      if (e.target.tagName === 'BUTTON') return; sx = e.clientX; sy = e.clientY; var r = p.getBoundingClientRect(); ox = r.left; oy = r.top;
      document.onmousemove = function (ev) {
        p.style.left = Math.max(0, Math.min(ox + ev.clientX - sx, innerWidth - 80)) + 'px';
        p.style.top = Math.max(0, Math.min(oy + ev.clientY - sy, innerHeight - 30)) + 'px'; p.style.right = 'auto';
      };
      document.onmouseup = function () { document.onmousemove = null; document.onmouseup = null; var r2 = p.getBoundingClientRect(); ui.left = r2.left; ui.top = r2.top; saveUi(); };
    };
  })();
  (function restoreUi() {
    if (ui.w) p.style.width = Math.max(300, Math.min(ui.w, innerWidth - 20)) + 'px';
    if (ui.h && !ui.folded) p.style.height = Math.max(120, Math.min(ui.h, innerHeight - 20)) + 'px';
    if (ui.left != null) { p.style.left = Math.max(0, Math.min(ui.left, innerWidth - 120)) + 'px'; p.style.top = Math.max(0, Math.min(ui.top, innerHeight - 40)) + 'px'; p.style.right = 'auto'; }
    setFold(!!ui.folded, true);
    if (window.ResizeObserver) {
      var tm = null;
      new ResizeObserver(function () {
        if (p.classList.contains('folded') || p.style.display === 'none') return;
        var r = p.getBoundingClientRect(), ch = false;
        if (p.style.width && Math.round(r.width) !== Math.round(ui.w || 0)) { ui.w = r.width; ch = true; }
        if (p.style.height && Math.round(r.height) !== Math.round(ui.h || 0)) { ui.h = r.height; ch = true; }
        if (ch) { clearTimeout(tm); tm = setTimeout(saveUi, 300); }
      }).observe(p);
    }
  })();

  /* Final approval: only one. A person chosen as final is removed from Review. */
  boxes('fin').forEach(function (b) {
    b.onchange = function () {
      if (!b.checked) return;
      boxes('fin').forEach(function (o) { if (o !== b) o.checked = false; });
      var uid = FINALS[b.dataset.i].name;
      boxes('rev').forEach(function (r) { if (REVIEWERS[r.dataset.i].name === uid) r.checked = false; });
    };
  });
  boxes('rev').forEach(function (b) {
    b.onchange = function () {
      if (!b.checked) return;
      var uid = REVIEWERS[b.dataset.i].name;
      boxes('fin').forEach(function (f) { if (f.checked && FINALS[f.dataset.i].name === uid) f.checked = false; });
    };
  });

  function refreshMode() {
    var m = mode();
    q('directbox').style.display = m === 'direct' ? 'block' : 'none';
    q('personalbox').style.display = m === 'personal' ? 'block' : 'none';
  }
  Array.prototype.forEach.call(p.querySelectorAll('input[name="gmen-mode"]'), function (r) { r.onchange = refreshMode; });
  function refreshFin() {
    var sub = finMode() === 'submit';
    goBtn.textContent = sub ? 'Start (submit directly)' : 'Start (stop at confirm box)';
    goBtn.style.background = sub ? '#c0392b' : '';
  }
  Array.prototype.forEach.call(p.querySelectorAll('input[name="gmen-fin"]'), function (r) { r.onchange = refreshFin; });
  function refreshType() {
    var ty = TYPES[q('type').value], isAv = ty[1] === 'W0101' || ty[1] === 'W0102';
    q('avbox').style.display = isAv ? 'block' : 'none'; q('rsnbox').style.display = isAv ? 'none' : 'block';
    if (ty[1] === 'W0101') { q('t1').value = WORK_START; q('t2').value = WORK_END; }
  }
  q('type').onchange = refreshType;
  q('d1').onchange = function () { if (q('d2').value < q('d1').value) q('d2').value = q('d1').value; };

  function picked() {
    var want = [];
    boxes('rev').forEach(function (b) { if (b.checked) { var u = REVIEWERS[b.dataset.i]; want.push({ kind: '검토', name: u.name }); } });
    boxes('fin').forEach(function (b) { if (b.checked) { var u = FINALS[b.dataset.i]; want.push({ kind: '결재', name: u.name }); } });
    return want;
  }
  function currentCfg() {
    return { phone: q('phone').value.replace(/\D/g, ''), mode: mode(), lineNo: q('lineNo').value,
      rev: boxes('rev').map(function (b) { return b.checked; }), fin: boxes('fin').map(function (b) { return b.checked; }),
      hidePeriod: q('hp').checked, hideReason: q('hr').checked };
  }
  function lineSummary(c) {
    if (c.mode === 'personal') return 'My saved NEIS line ' + (c.lineNo ? 'No. ' + c.lineNo : '(not selected)');
    return picked().map(function (w) { return (w.kind === '검토' ? 'Review ' : 'Final ') + w.name; }).join(' → ');
  }
  function showSummary(c) {
    var ph = c.phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
    q('sum').innerHTML = 'Phone ' + ph + '<br>Approval: ' + lineSummary(c) + '<br>Private: ' + ([c.hidePeriod ? 'Dates' : '', c.hideReason ? 'Reason' : ''].filter(Boolean).join(', ') || 'none');
    q('sum').style.display = 'block'; q('cfg').style.display = 'none'; q('edit').style.display = 'inline';
  }
  q('edit').onclick = function () { q('cfg').style.display = 'block'; q('sum').style.display = 'none'; q('edit').style.display = 'none'; };
  q('forget').onclick = function () {
    clearCfg();
    q('phone').value = ''; q('lineNo').value = ''; q('hp').checked = true; q('hr').checked = true; q('remember').checked = false;
    boxes('rev').forEach(function (b) { b.checked = REVIEWERS[b.dataset.i].on; });
    boxes('fin').forEach(function (b) { b.checked = FINALS[b.dataset.i].on; });
    setMode('direct'); q('edit').onclick(); log('Saved settings were removed from this PC.');
  };
  if (saved) {
    q('phone').value = saved.phone || ''; q('lineNo').value = saved.lineNo || '';
    q('hp').checked = saved.hidePeriod !== false; q('hr').checked = saved.hideReason !== false;
    if (saved.rev) boxes('rev').forEach(function (b, i) { if (typeof saved.rev[i] === 'boolean') b.checked = saved.rev[i]; });
    if (saved.fin) boxes('fin').forEach(function (b, i) { if (typeof saved.fin[i] === 'boolean') b.checked = saved.fin[i]; });
    q('remember').checked = true; setMode(saved.mode || 'direct'); showSummary(currentCfg());
  }
  function persist() { if (q('remember').checked) saveCfg(currentCfg()); else clearCfg(); }

  /* ---------- Run ---------- */
  goBtn.onclick = function () {
    goBtn.disabled = true; logEl.textContent = '';
    hookConfirm(log);
    run().then(function () { unhookConfirm(); goBtn.disabled = false; }, function (e) { unhookConfirm(); log('Stopped: ' + e.message); goBtn.disabled = false; });
  };

  async function openScreen() {
    if (app('srv_mymmm00_m00')) return;
    log('Opening 개인근무상황관리...');
    function findMenu(prefix) {
      return Array.prototype.filter.call(document.querySelectorAll('a.cl-sidenavigation-item'), function (e) { return e.textContent.trim().indexOf(prefix) === 0; })[0];
    }
    var link = findMenu('개인근무상황관리');
    if (!link || !link.offsetParent) { var bm = findMenu('복무'); if (bm) { bm.click(); await sleep(800); } link = findMenu('개인근무상황관리'); }
    if (!link) throw new Error('Menu not found. Please open 복무 > 개인근무상황관리 and try again.');
    link.click();
    await waitFor(function () { var a = app('srv_mymmm00_m00'); return a && a.lookup('btnAply'); }, 15000, '개인근무상황관리 screen');
    await sleep(1500);
  }
  async function selectCombo(c, value) {
    if (c.value === value) {
      var other = c.getItems().filter(function (x) { return x.value !== value; })[0];
      if (other) { c.selectItemByValue(other.value); await sleep(400); }
    }
    c.selectItemByValue(value); await sleep(600);
    if (c.value !== value) throw new Error('Could not select: ' + value);
  }

  async function assignDirect(A, want) {
    log('4/6 Setting approvers...');
    var S = null;
    for (var t = 1; t <= 3 && !app('wam_woapm07_p04'); t++) {
      A.lookup('btnSelectSancr').click();
      await waitFor(function () { return app('wam_woapm07_p04'); }, 6000, '').catch(function (e) { if (/NEIS/.test(e.message)) throw e; });
    }
    S = await waitFor(function () { var a = app('wam_woapm07_p04'); return a && a.lookup('dsMain') && a.lookup('dsMain').getRowCount() > 0 && a; }, 25000, 'approver window');
    await sleep(300);
    var grid = S.lookup('grdUserListFrom'), users = S.lookup('dsMain'), radio = S.lookup('rdbCn'), addBtn = S.lookup('btn1');
    for (var i = 0; i < want.length; i++) {
      var w = want[i];
      S.lookup('userNm').putValue(w.name); users.clear(); S.lookup('btnSearch').click();
      await waitFor(function () { return users.getRowCount() > 0; }, 4000, '').catch(function () { });
      var all = [];
      for (var r = 0; r < users.getRowCount(); r++) if (users.getValue(r, 'userNm') === w.name) all.push(r);
      if (!all.length) throw new Error('"' + w.name + '" was not found in the NEIS staff list.');
      var act = all.filter(function (r) { return users.getValue(r, 'hffcStsNm') === '재직' && users.getValue(r, 'jbpsNm'); });
      var cands = act.length ? act : all;
      if (cands.length !== 1) throw new Error('There are ' + cands.length + ' staff members named "' + w.name + '". Please use "My saved NEIS line" instead.');
      var pick = cands[0];
      radio.putValue(KIND_CODE[w.kind]);
      grid.getCheckRowIndices().forEach(function (k) { grid.setCheckRowIndex(k, false); });
      grid.setCheckRowIndex(pick, true);
      addBtn.click();
      await sleep(400);
    }
    var line = S.lookup('dsParam'), got = [];
    for (var k = 1; k < line.getRowCount(); k++) got.push(line.getValue(k, 'atrzScNm') + ' ' + line.getValue(k, 'userNm'));
    var wantS = want.map(function (x) { return x.kind + ' ' + x.name; });
    if (got.join('|') !== wantS.join('|')) throw new Error('Approval line does not match: ' + got.join(' → '));
    log('5/6 Saving approval line...');
    S.lookup('btn4').click();
    await waitFor(function () { return !app('wam_woapm07_p04'); }, 20000, 'saving approval line');
    await sleep(500);
  }

  async function assignPersonal(A, no) {
    log('4/6 Loading saved line No. ' + no + '...');
    for (var t = 1; t <= 3 && !app('wam_woapm07_p02'); t++) {
      A.lookup('btnSelectMySancr').click();
      await waitFor(function () { return app('wam_woapm07_p02'); }, 6000, '').catch(function (e) { if (/NEIS/.test(e.message)) throw e; });
    }
    var M = await waitFor(function () { var a = app('wam_woapm07_p02'); return a && a.lookup('dsInvlSnclnList') && a; }, 20000, 'saved line window');
    var list = M.lookup('dsInvlSnclnList');
    await waitFor(function () { return list.getRowCount() > 0; }, 5000, '').catch(function () { });
    var n = list.getRowCount(), names = [];
    for (var r = 0; r < n; r++) names.push('No.' + (r + 1) + ' ' + list.getValue(r, 'snclnNm'));
    if (!n) { M.lookup('btnCancel').click(); throw new Error('You have no saved approval lines in NEIS.'); }
    if (no > n) { M.lookup('btnCancel').click(); throw new Error('Line No. ' + no + ' does not exist. Available: ' + names.join(', ')); }
    var idx = no - 1, mem = M.lookup('dsMain');
    M.lookup('grd3').selectRows([idx]); mem.clear(); M.lookup('btnSearch').click();
    await waitFor(function () { return mem.getRowCount() > 0; }, 5000, '').catch(function () { });
    var members = [];
    for (var j = 0; j < mem.getRowCount(); j++) members.push(mem.getValue(j, 'atrzScNm') + ' ' + mem.getValue(j, 'sancrUserNm'));
    if (!members.length) { M.lookup('btnCancel').click(); throw new Error('Line No. ' + no + ' "' + list.getValue(idx, 'snclnNm') + '" is empty. Available: ' + names.join(', ')); }
    log('   No. ' + no + ' "' + list.getValue(idx, 'snclnNm') + '": ' + members.join(' → '));
    log('5/6 Applying line...');
    M.lookup('btn4').click();
    await waitFor(function () { return !app('wam_woapm07_p02'); }, 20000, 'applying saved line');
    await sleep(500);
  }

  async function run() {
    var cfg = currentCfg(), want = picked();
    var ty = TYPES[q('type').value], isAv = ty[1] === 'W0101' || ty[1] === 'W0102';
    var d1 = q('d1').value, d2 = q('d2').value, t1 = q('t1').value, t2 = q('t2').value, rsn = q('rsn').value.trim(), av = q('av').value;
    var lineNo = +cfg.lineNo, autoSubmit = finMode() === 'submit';
    if (!/^0\d{8,10}$/.test(cfg.phone)) throw new Error('Please check your phone number (digits only, e.g. 01012345678).');
    if (cfg.mode === 'direct') {
      var finals = want.filter(function (w) { return w.kind === '결재'; });
      if (finals.length !== 1) throw new Error('Please choose exactly one final approver.');
    } else if (!lineNo) throw new Error('Please choose a saved line number in My settings.');
    if (!d1 || !d2 || !t1 || !t2) throw new Error('Please enter the date and time.');
    if (!isAv && !rsn) throw new Error('Please enter a reason.');
    var h1 = t1.slice(0, 2), m1 = t1.slice(3, 5), h2 = t2.slice(0, 2), m2 = t2.slice(3, 5);
    if (+m1 % 5 || +m2 % 5) throw new Error('Minutes must be in 5-minute steps.');
    if (readAlert()) throw new Error('A NEIS message box is open. Please close it first.');
    if (app('srv_mymmm00_p00')) throw new Error('The 근무상황신청 window is already open. Close it and try again.');
    if (autoSubmit) {
      var sumTxt = ty[2] + '\n' + d1 + (d2 !== d1 ? ' ~ ' + d2 : '') + ' ' + t1 + ' ~ ' + t2 + '\nReason: ' + (isAv ? q('av').selectedOptions[0].text : rsn) + '\nApproval: ' + lineSummary(cfg);
      if (!nativeConfirm.call(window, 'This will SUBMIT without stopping at the confirm box.\n\n' + sumTxt + '\n\nContinue?')) throw new Error('Cancelled.');
    }
    persist();
    if (q('remember').checked) showSummary(cfg);

    await openScreen();
    log('1/6 Opening request window...');
    var P = null;
    for (var tries = 1; tries <= 3 && !P; tries++) {
      app('srv_mymmm00_m00').lookup('btnAply').click();
      try {
        P = await waitFor(function () { var a = app('srv_mymmm00_p00'); return a && a.lookup('cmbWorkSittnSclfCd') && a.lookup('cmbWorkSittnSclfCd').getItems().length && a; }, 15000, 'request window');
      } catch (e) {
        // Screen not fully loaded yet (NEIS shows e.g. GA-SRV-0070). Close the message and retry.
        if (tries === 3 || !readAlert()) throw e;
        dismissAlert(); await sleep(2000);
      }
    }
    await sleep(500);

    log('2/6 Filling in: ' + ty[2]);
    await selectCombo(P.lookup('cmbWorkSittnLclfCd'), ty[0]);
    await selectCombo(P.lookup('cmbWorkSittnSclfCd'), ty[1]);
    P.lookup('dtiWorkYmdFrom').putValue(ymd(d1)); P.lookup('dtiWorkYmdTo').putValue(ymd(d2));
    P.lookup('cmbBgngH').putValue(h1); P.lookup('cmbBgngM').putValue(m1);
    P.lookup('cmbEndH').putValue(h2); P.lookup('cmbEndM').putValue(m2);
    P.lookup('mse1').putValue(cfg.phone);
    if (isAv) P.lookup('cmbAvRsnCd').selectItemByValue(av); else P.lookup('ipbWorkSittnRsnCn').putValue(rsn);
    P.lookup('cbxPrdYn').putValue(cfg.hidePeriod ? 'Y' : 'N');
    P.lookup('cbxWorkSittnRsnCnYn').putValue(cfg.hideReason ? 'Y' : 'N');
    await sleep(1200);
    var D = P.lookup('dsMain'), g = function (c) { return D.getValue(0, c); }, bad = [];
    if (g('workSittnSclfCd') !== ty[1]) bad.push('leave type');
    if (g('bgngYmd') !== ymd(d1) || g('endYmd') !== ymd(d2)) bad.push('date');
    if (g('bgngH') !== h1 || g('bgngM') !== m1 || g('endH') !== h2 || g('endM') !== m2) bad.push('time');
    if (isAv ? g('avRsnCd') !== av : g('workSittnRsnCn') !== rsn) bad.push('reason');
    if (bad.length) throw new Error('Input check failed: ' + bad.join(', '));
    log('   Requested time: ' + g('workSittnDdTtl') + ' day(s) ' + g('workSittnHrTtl') + ' h ' + g('workSittnMTtl') + ' min');

    log('3/6 승인요청 (request approval)...');
    P.lookup('btnAprvDmnd').click();
    var A = null, lastAlert = '', endA = Date.now() + 20000, alerts = 0;
    var lastA = Date.now();
    while (Date.now() < endA) {
      if (userCancelled) throw new Error('You clicked Cancel on the NEIS question: ' + userCancelled);
      var nA = Date.now(); if (nA - lastA > 3000) endA += nA - lastA; lastA = nA;
      var aa = app('wam_woapm07_p00');
      if (aa && aa.lookup('btnSelectSancr')) { A = aa; break; }
      var am = readAlert();
      if (am) {
        if (++alerts > 3) break;
        lastAlert = am; log('   NEIS notice (Korean): ' + am); dismissAlert(); await sleep(1500);
        if (!app('wam_woapm07_p00') && !readAlert()) { await sleep(2000); if (!app('wam_woapm07_p00')) break; }
        continue;
      }
      await sleep(200);
    }
    if (!A) throw new Error(lastAlert ? 'NEIS blocked the request. See the message above (ask a Korean colleague if needed).' : 'Timed out waiting for the 기안문서상신 window.');
    await sleep(1500);

    if (cfg.mode === 'direct') await assignDirect(A, want); else await assignPersonal(A, lineNo);

    var sc = app('wam_woapm07_p00').lookup('dsSancr'), line = [], hasApr = false;
    for (var k = 1; k < sc.getRowCount(); k++) { var kn = sc.getValue(k, 'atrzScNm'); if (kn === '결재') hasApr = true; line.push((kn === '결재' ? 'Final ' : kn === '검토' ? 'Review ' : kn + ' ') + sc.getValue(k, 'userNm')); }
    if (!line.length || !hasApr) throw new Error('The approval line has no final approver. Please check it.');
    log('   Approval line: ' + line.join(' → '));

    log('6/6 Clicking 상신 (submit)...');
    for (var t2 = 1; t2 <= 3 && !confirmShown('상신하'); t2++) {
      app('wam_woapm07_p00').lookup('btnDrft').click();
      await waitFor(function () { return confirmShown('상신하'); }, 7000, '').catch(function (e) { if (/NEIS/.test(e.message)) throw e; });
    }
    await waitFor(function () { return confirmShown('상신하'); }, 15000, 'submit confirm box');
    if (!autoSubmit) {
      log('\nDone! Stopped at the "상신하겠습니까?" confirm box.\nCheck the details and click [확인] (OK) yourself.\n(If you click 취소 (Cancel), a draft (임시저장) stays in the list. Please delete it.)');
      return;
    }
    log('   Submit directly: clicking 확인');
    var cf = app('app/cmn/confirm');
    if (!cf || !cf.lookup('btnConfirm')) throw new Error('Could not find the OK button. Please click 확인 yourself.');
    cf.lookup('btnConfirm').click();
    var endS = Date.now() + 20000, resMsg = '';
    while (Date.now() < endS) {
      var rm = readAlert();
      if (rm) { resMsg = rm; dismissAlert(); await sleep(800); continue; }
      if (!app('wam_woapm07_p00') && !app('app/cmn/')) break;
      await sleep(300);
    }
    if (resMsg) log('   NEIS message (Korean): ' + resMsg);
    if (app('wam_woapm07_p00')) throw new Error('The submit window is still open. Please check the screen.');
    log('\nSubmitted! Check the approval status in the 개인근무상황관리 list.');
    var m0 = app('srv_mymmm00_m00'); if (m0 && m0.lookup('btnSearch')) m0.lookup('btnSearch').click();
  }

  refreshType(); refreshMode(); refreshFin();
})();
