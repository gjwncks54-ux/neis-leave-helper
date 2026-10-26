/* 나이스 근무상황 신청 도우미 v2.2
 * 복무 > 개인근무상황관리 > 신청 → 입력 → 승인요청 → 결재선 지정 → 상신
 * 기본: "상신하겠습니까?" 확인창에서 멈춤. '바로 상신'을 고르면 확인까지 누름(매번 선택).
 * 설정(연락처, 결재선, 비공개)은 '이 PC에 기억하기'를 켰을 때만 이 브라우저에 저장.
 */
(function () {
  'use strict';
  var PANEL_ID = 'neis-gm-helper', STORE = 'neisGmHelper.v2';
  var old = document.getElementById(PANEL_ID);
  if (old) { old.style.display = 'block'; return; }
  if (!window.cpr || !cpr.core) { alert('나이스(4세대) 화면에서 실행해 주세요.'); return; }

  var TYPES = [
    ['W01', 'W0104', '연가 / 조퇴'], ['W01', 'W0101', '연가 / 연가'], ['W01', 'W0102', '연가 / 반일연가'],
    ['W01', 'W0105', '연가 / 외출'], ['W01', 'W0103', '연가 / 지각'],
    ['W02', 'W0205', '병가 / 병조퇴'], ['W02', 'W0201', '병가 / 병가'], ['W02', 'W0203', '병가 / 반일병가'],
    ['W02', 'W0206', '병가 / 병외출'], ['W02', 'W0204', '병가 / 병지각']
  ];
  var AV_RSN = [
    ['01', '1호: 본인·배우자 직계존속 생일'], ['02', '2호: 배우자, 본인·배우자 직계존속 기일'],
    ['03', '3호: 가족 질병·부상 간호 또는 위로'], ['04', '4호: 병가 소진 후 계속 요양'],
    ['05', '5호: 방송대 출석수업, 대학원 시험'], ['06', '6호: 본인·배우자 부모의 형제자매 장례'],
    ['07', '7호: 본인·배우자 형제자매의 배우자 장례'], ['08', '8호: 자녀 입영일'], ['09', '9호: 기타 학교장 인정']
  ];
  var KIND_CODE = { '결재': '2', '검토': '7' };
  var WORK_START = '08:30', WORK_END = '16:30';

  /* ---------- 저장 ---------- */
  function loadCfg() { try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch (e) { return null; } }
  function saveCfg(c) { localStorage.setItem(STORE, JSON.stringify(c)); }
  function clearCfg() { localStorage.removeItem(STORE); }
  var saved = loadCfg();
  var ids = (saved && saved.ids) || {};   // 이름 → 사용자ID (동명이인 해결 결과)

  /* ---------- 나이스 helpers ---------- */
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
    var end = Date.now() + (ms || 10000);
    while (Date.now() < end) {
      var am = readAlert();
      if (am) throw new Error('나이스 알림: ' + am);
      try { var v = fn(); if (v) return v; } catch (e) { }
      await sleep(200);
    }
    throw new Error((label || '화면') + ' 대기 시간 초과');
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(v) { return v.replace(/-/g, ''); }
  function splitNames(s) { return s.split(/[,，、\s]+/).map(function (x) { return x.trim(); }).filter(Boolean); }

  /* ---------- UI ---------- */
  var P_ = '#' + PANEL_ID;
  var css = P_ + '{position:fixed;top:70px;right:24px;z-index:2147483000;width:350px;max-height:calc(100vh - 90px);overflow:auto;resize:both;min-width:300px;min-height:120px;background:#fff;border:1px solid #2b5fd9;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);font:13px/1.5 "Malgun Gothic",sans-serif;color:#222}' +
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
    P_ + ' .sum{font-size:12px;color:#333;background:#f5f7fb;border-radius:4px;padding:4px 6px}' +
    P_ + ' .go{margin-top:10px;width:100%;padding:8px;background:#2b5fd9;color:#fff;border:0;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer}' +
    P_ + ' .go:disabled{background:#999}' +
    P_ + ' .sm{padding:2px 8px;font-size:12px;border:1px solid #bbb;background:#fff;border-radius:4px;cursor:pointer}' +
    P_ + ' .hint{font-size:11px;color:#777}' +
    P_ + ' .log{margin-top:8px;max-height:200px;overflow:auto;background:#f5f7fb;border-radius:4px;padding:6px;font-size:12px;white-space:pre-wrap}' +
    P_ + ' .choose{margin-top:8px;border:2px solid #f0a020;border-radius:6px;padding:8px;background:#fff8e8}' +
    P_ + ' .choose button{display:block;width:100%;margin-top:4px;text-align:left;padding:5px 8px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;font-size:12px}' +
    P_ + ' .choose button:hover{background:#eef3ff}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var now = new Date(), today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  var p = document.createElement('div'); p.id = PANEL_ID;
  p.innerHTML =
    '<div class="hd"><span>근무상황 신청 도우미</span><span><button data-k="fold" title="접기">–</button><button data-k="x" title="닫기">×</button></span></div>' +
    '<div class="bd">' +
    /* 내 설정 */
    '<div class="sec"><h4>내 설정 <a data-k="edit" style="display:none">수정</a></h4>' +
    '<div data-k="sum" class="sum" style="display:none"></div>' +
    '<div data-k="cfg">' +
    '<label class="t">연락처</label><input type="tel" data-k="phone" placeholder="01012345678">' +
    '<label class="t">결재선 방식</label>' +
    '<label class="inl"><input type="radio" name="gm-mode" value="direct" checked> 직접 입력</label>' +
    '<label class="inl"><input type="radio" name="gm-mode" value="personal"> 나이스 개인결재선</label>' +
    '<div data-k="directbox">' +
    '<label class="t">검토 <span class="hint">(여러 명이면 쉼표로, 순서대로)</span></label><input type="text" data-k="rev" placeholder="예: 홍길동, 김철수">' +
    '<label class="t">결재 <span class="hint">(1명)</span></label><input type="text" data-k="apr" placeholder="예: 이교장">' +
    '</div>' +
    '<div data-k="personalbox" style="display:none"><label class="t">개인결재선 번호 <span class="hint">(나이스 개인 결재선 목록의 순번)</span></label><select data-k="lineNo"><option value="">선택</option>' +
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<option value="' + n + '">' + n + '번</option>'; }).join('') + '</select></div>' +
    '<label class="t">비공개</label>' +
    '<label class="inl"><input type="checkbox" data-k="hp" checked> 기간</label>' +
    '<label class="inl"><input type="checkbox" data-k="hr" checked> 사유</label>' +
    '<div class="row" style="margin-top:8px;justify-content:space-between">' +
    '<label class="inl"><input type="checkbox" data-k="remember"> 이 PC에 기억하기</label>' +
    '<button class="sm" data-k="forget">기억 지우기</button></div>' +
    '</div></div>' +
    /* 이번 신청 */
    '<div class="sec"><h4>이번 신청</h4>' +
    '<label class="t">근무상황</label><select data-k="type">' + TYPES.map(function (x, i) { return '<option value="' + i + '">' + x[2] + '</option>'; }).join('') + '</select>' +
    '<label class="t">날짜</label><div class="row"><input type="date" data-k="d1" value="' + today + '"><span>~</span><input type="date" data-k="d2" value="' + today + '"></div>' +
    '<label class="t">시간 <span class="hint">(5분 단위)</span></label><div class="row"><input type="time" step="300" data-k="t1" value="13:00"><span>~</span><input type="time" step="300" data-k="t2" value="' + WORK_END + '"></div>' +
    '<div data-k="avbox" style="display:none"><label class="t">연가사유</label><select data-k="av">' + AV_RSN.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('') + '</select></div>' +
    '<div data-k="rsnbox"><label class="t">사유</label><input type="text" data-k="rsn" placeholder="예: 병원진료"></div>' +
    '</div>' +
    '<div class="row" style="margin-top:10px">' +
    '<label class="inl"><input type="radio" name="gm-fin" value="stop" checked> 확인창에서 멈춤</label>' +
    '<label class="inl" style="color:#c0392b"><input type="radio" name="gm-fin" value="submit"> 바로 상신</label></div>' +
    '<button class="go">시작 (확인창에서 멈춤)</button>' +
    '<div data-k="choose" class="choose" style="display:none"></div>' +
    '<div class="log" style="display:none"></div>' +
    '</div>';
  document.body.appendChild(p);

  function q(k) { return p.querySelector('[data-k="' + k + '"]'); }
  function mode() { return p.querySelector('input[name="gm-mode"]:checked').value; }
  function setMode(m) { p.querySelector('input[name="gm-mode"][value="' + m + '"]').checked = true; refreshMode(); }
  var logEl = p.querySelector('.log'), goBtn = p.querySelector('.go');
  function log(m) { logEl.style.display = 'block'; logEl.textContent += m + '\n'; logEl.scrollTop = 1e6; }

  var UI_KEY = STORE + '.ui', ui = {};
  try { ui = JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { ui = {}; }
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { } }
  function setFold(f, quiet) {
    if (f) { if (p.style.height) ui.h = p.getBoundingClientRect().height; p.classList.add('folded'); p.style.height = ''; }
    else { p.classList.remove('folded'); if (ui.h) p.style.height = Math.min(ui.h, innerHeight - 20) + 'px'; }
    q('fold').textContent = f ? '\u25A2' : '\u2013'; q('fold').title = f ? '펼치기' : '접기';
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

  function refreshMode() {
    var m = mode();
    q('directbox').style.display = m === 'direct' ? 'block' : 'none';
    q('personalbox').style.display = m === 'personal' ? 'block' : 'none';
  }
  Array.prototype.forEach.call(p.querySelectorAll('input[name="gm-mode"]'), function (r) { r.onchange = refreshMode; });
  function finMode() { return p.querySelector('input[name="gm-fin"]:checked').value; }
  function refreshFin() {
    var sub = finMode() === 'submit';
    goBtn.textContent = sub ? '시작 (바로 상신까지)' : '시작 (확인창에서 멈춤)';
    goBtn.style.background = sub ? '#c0392b' : '';
  }
  Array.prototype.forEach.call(p.querySelectorAll('input[name="gm-fin"]'), function (r) { r.onchange = refreshFin; });
  function refreshType() {
    var ty = TYPES[q('type').value], isAv = ty[1] === 'W0101' || ty[1] === 'W0102';
    q('avbox').style.display = isAv ? 'block' : 'none'; q('rsnbox').style.display = isAv ? 'none' : 'block';
    if (ty[1] === 'W0101') { q('t1').value = WORK_START; q('t2').value = WORK_END; }
  }
  q('type').onchange = refreshType;
  q('d1').onchange = function () { if (q('d2').value < q('d1').value) q('d2').value = q('d1').value; };

  function currentCfg() {
    return { phone: q('phone').value.replace(/\D/g, ''), mode: mode(), rev: q('rev').value.trim(), apr: q('apr').value.trim(), lineNo: q('lineNo').value,
      hidePeriod: q('hp').checked, hideReason: q('hr').checked, ids: ids };
  }
  function lineSummary(c) {
    if (c.mode === 'personal') return '나이스 개인결재선 ' + (c.lineNo ? c.lineNo + '번' : '(번호 미선택)');
    var a = splitNames(c.rev).map(function (n) { return '검토 ' + n; }); if (c.apr) a.push('결재 ' + c.apr);
    return a.join(' → ');
  }
  function showSummary(c) {
    var ph = c.phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
    q('sum').innerHTML = '연락처 ' + ph + '<br>결재선: ' + lineSummary(c) + '<br>비공개: ' + ([c.hidePeriod ? '기간' : '', c.hideReason ? '사유' : ''].filter(Boolean).join(', ') || '없음');
    q('sum').style.display = 'block'; q('cfg').style.display = 'none'; q('edit').style.display = 'inline';
  }
  q('edit').onclick = function () { q('cfg').style.display = 'block'; q('sum').style.display = 'none'; q('edit').style.display = 'none'; };
  q('forget').onclick = function () {
    clearCfg(); ids = {};
    q('phone').value = ''; q('rev').value = ''; q('apr').value = ''; q('lineNo').value = ''; q('hp').checked = true; q('hr').checked = true;
    q('remember').checked = false; setMode('direct');
    q('edit').onclick(); log('이 PC에 기억된 설정을 지웠어요.');
  };
  if (saved) {
    q('phone').value = saved.phone || ''; q('rev').value = saved.rev || ''; q('apr').value = saved.apr || ''; q('lineNo').value = saved.lineNo || '';
    q('hp').checked = saved.hidePeriod !== false; q('hr').checked = saved.hideReason !== false;
    q('remember').checked = true; setMode(saved.mode || 'direct'); showSummary(currentCfg());
  }
  function persist() {
    var c = currentCfg();
    if (q('remember').checked) saveCfg(c); else clearCfg();
  }

  /* 동명이인 등 선택이 필요할 때 */
  function choose(title, options) {
    var box = q('choose');
    return new Promise(function (resolve, reject) {
      box.innerHTML = '<b>' + title + '</b>';
      options.forEach(function (o) {
        var b = document.createElement('button'); b.textContent = o.label;
        b.onclick = function () { box.style.display = 'none'; resolve(o.value); }; box.appendChild(b);
      });
      var c = document.createElement('button'); c.textContent = '중단'; c.style.textAlign = 'center';
      c.onclick = function () { box.style.display = 'none'; reject(new Error('사용자가 중단했어요.')); }; box.appendChild(c);
      box.style.display = 'block'; box.scrollIntoView({ block: 'nearest' });
    });
  }

  /* ---------- 실행 ---------- */
  goBtn.onclick = function () {
    goBtn.disabled = true; logEl.textContent = ''; q('choose').style.display = 'none';
    run().then(function () { goBtn.disabled = false; }, function (e) { log('중단: ' + e.message); goBtn.disabled = false; });
  };

  async function openScreen() {
    if (app('srv_mymmm00_m00')) return;
    log('개인근무상황관리 화면 여는 중...');
    function findMenu(prefix) {
      return Array.prototype.filter.call(document.querySelectorAll('a.cl-sidenavigation-item'), function (e) { return e.textContent.trim().indexOf(prefix) === 0; })[0];
    }
    var link = findMenu('개인근무상황관리');
    if (!link || !link.offsetParent) { var bm = findMenu('복무'); if (bm) { bm.click(); await sleep(800); } link = findMenu('개인근무상황관리'); }
    if (!link) throw new Error('메뉴를 못 찾았어요. 복무 > 개인근무상황관리 화면을 열고 다시 시작해 주세요.');
    link.click();
    await waitFor(function () { var a = app('srv_mymmm00_m00'); return a && a.lookup('btnAply'); }, 15000, '개인근무상황관리 화면');
    await sleep(1500);
  }
  async function selectCombo(c, value) {
    if (c.value === value) {
      var other = c.getItems().filter(function (x) { return x.value !== value; })[0];
      if (other) { c.selectItemByValue(other.value); await sleep(400); }
    }
    c.selectItemByValue(value); await sleep(600);
    if (c.value !== value) throw new Error('선택 실패: ' + value);
  }

  async function assignDirect(A, cfg) {
    var want = splitNames(cfg.rev).map(function (n) { return { kind: '검토', name: n }; });
    want.push({ kind: '결재', name: cfg.apr });
    log('4/6 결재자 지정...');
    for (var t = 1; t <= 3 && !app('wam_woapm07_p04'); t++) {
      A.lookup('btnSelectSancr').click();
      await waitFor(function () { return app('wam_woapm07_p04'); }, 6000, '').catch(function (e) { if (/나이스 알림/.test(e.message)) throw e; });
    }
    var S = await waitFor(function () { var a = app('wam_woapm07_p04'); return a && a.lookup('dsMain') && a.lookup('dsMain').getRowCount() > 0 && a; }, 25000, '결재자지정 창');
    await sleep(300);
    var grid = S.lookup('grdUserListFrom'), users = S.lookup('dsMain'), radio = S.lookup('rdbCn'), addBtn = S.lookup('btn1');
    for (var i = 0; i < want.length; i++) {
      var w = want[i];
      S.lookup('userNm').putValue(w.name); users.clear(); S.lookup('btnSearch').click();
      await waitFor(function () { return users.getRowCount() > 0; }, 4000, '').catch(function () { });
      var all = [];
      for (var r = 0; r < users.getRowCount(); r++) if (users.getValue(r, 'userNm') === w.name) all.push(r);
      if (!all.length) throw new Error('결재자 목록에서 "' + w.name + '"을(를) 찾을 수 없어요. 이름을 확인해 주세요.');
      var pick = -1;
      if (ids[w.name]) all.forEach(function (r) { if (users.getValue(r, 'userId') === ids[w.name]) pick = r; });
      if (pick < 0) {
        var act = all.filter(function (r) { return users.getValue(r, 'hffcStsNm') === '재직' && users.getValue(r, 'jbpsNm'); });
        var cands = act.length ? act : all;
        if (cands.length === 1) pick = cands[0];
        else {
          log('   "' + w.name + '" 동명이인 ' + cands.length + '명. 아래에서 골라 주세요.');
          var uid = await choose(w.kind + ' "' + w.name + '" 선생님을 골라 주세요', cands.map(function (r) {
            return { value: users.getValue(r, 'userId'), label: users.getValue(r, 'userNm') + ' · ' + (users.getValue(r, 'jbpsNm') || '직위 없음') + ' · ' + (users.getValue(r, 'hffcStsNm') || '-') + ' · ID ' + users.getValue(r, 'userId') };
          }));
          cands.forEach(function (r) { if (users.getValue(r, 'userId') === uid) pick = r; });
        }
        ids[w.name] = users.getValue(pick, 'userId');
      }
      radio.putValue(KIND_CODE[w.kind]);
      grid.getCheckRowIndices().forEach(function (k) { grid.setCheckRowIndex(k, false); });
      grid.setCheckRowIndex(pick, true);
      addBtn.click();
      await sleep(400);
    }
    var line = S.lookup('dsParam'), got = [];
    for (var k = 1; k < line.getRowCount(); k++) got.push(line.getValue(k, 'atrzScNm') + ' ' + line.getValue(k, 'userNm'));
    var wantS = want.map(function (x) { return x.kind + ' ' + x.name; });
    if (got.join('|') !== wantS.join('|')) throw new Error('결재선이 예상과 달라요: ' + got.join(' → '));
    log('5/6 결재선 저장...');
    S.lookup('btn4').click();
    await waitFor(function () { return !app('wam_woapm07_p04'); }, 20000, '결재선 저장');
    await sleep(500);
  }

  async function assignPersonal(A, no) {
    log('4/6 개인결재선 ' + no + '번 불러오는 중...');
    for (var t = 1; t <= 3 && !app('wam_woapm07_p02'); t++) {
      A.lookup('btnSelectMySancr').click();
      await waitFor(function () { return app('wam_woapm07_p02'); }, 6000, '').catch(function (e) { if (/나이스 알림/.test(e.message)) throw e; });
    }
    var M = await waitFor(function () { var a = app('wam_woapm07_p02'); return a && a.lookup('dsInvlSnclnList') && a; }, 20000, '개인결재선 창');
    var list = M.lookup('dsInvlSnclnList');
    await waitFor(function () { return list.getRowCount() > 0; }, 5000, '').catch(function () { });
    var n = list.getRowCount(), names = [];
    for (var r = 0; r < n; r++) names.push((r + 1) + '번 ' + list.getValue(r, 'snclnNm'));
    if (!n) { M.lookup('btnCancel').click(); throw new Error('나이스에 저장된 개인결재선이 없어요.'); }
    if (no > n) { M.lookup('btnCancel').click(); throw new Error(no + '번 결재선이 없어요. 있는 결재선: ' + names.join(', ')); }
    var idx = no - 1, mem = M.lookup('dsMain');
    M.lookup('grd3').selectRows([idx]); mem.clear(); M.lookup('btnSearch').click();
    await waitFor(function () { return mem.getRowCount() > 0; }, 5000, '').catch(function () { });
    var members = [];
    for (var j = 0; j < mem.getRowCount(); j++) members.push(mem.getValue(j, 'atrzScNm') + ' ' + mem.getValue(j, 'sancrUserNm'));
    if (!members.length) { M.lookup('btnCancel').click(); throw new Error(no + '번 "' + list.getValue(idx, 'snclnNm') + '" 결재선이 비어 있어요. 있는 결재선: ' + names.join(', ')); }
    log('   ' + no + '번 "' + list.getValue(idx, 'snclnNm') + '": ' + members.join(' → '));
    log('5/6 결재선 지정...');
    M.lookup('btn4').click();
    await waitFor(function () { return !app('wam_woapm07_p02'); }, 20000, '개인결재선 지정');
    await sleep(500);
  }

  async function run() {
    var cfg = currentCfg();
    var ty = TYPES[q('type').value], isAv = ty[1] === 'W0101' || ty[1] === 'W0102';
    var d1 = q('d1').value, d2 = q('d2').value, t1 = q('t1').value, t2 = q('t2').value, rsn = q('rsn').value.trim(), av = q('av').value;
    var lineNo = +cfg.lineNo, autoSubmit = finMode() === 'submit';
    /* 입력 확인 */
    if (!/^0\d{8,10}$/.test(cfg.phone)) throw new Error('연락처를 확인해 주세요. (숫자만, 예: 01012345678)');
    if (cfg.mode === 'direct') {
      if (!cfg.apr || splitNames(cfg.apr).length !== 1) throw new Error('결재자는 1명만 입력해 주세요.');
    } else if (!lineNo) throw new Error('내 설정에서 개인결재선 번호를 골라 주세요.');
    if (!d1 || !d2 || !t1 || !t2) throw new Error('날짜와 시간을 입력해 주세요.');
    if (!isAv && !rsn) throw new Error('사유를 입력해 주세요.');
    var h1 = t1.slice(0, 2), m1 = t1.slice(3, 5), h2 = t2.slice(0, 2), m2 = t2.slice(3, 5);
    if (+m1 % 5 || +m2 % 5) throw new Error('분은 5분 단위만 가능해요.');
    if (readAlert()) throw new Error('나이스 알림창이 떠 있어요. 먼저 닫아 주세요.');
    if (app('srv_mymmm00_p00')) throw new Error('근무상황신청 창이 이미 열려 있어요. 닫고 다시 시작해 주세요.');
    if (autoSubmit) {
      var sumTxt = ty[2] + '\n' + d1 + (d2 !== d1 ? ' ~ ' + d2 : '') + ' ' + t1 + ' ~ ' + t2 + '\n사유: ' + (isAv ? q('av').selectedOptions[0].text : rsn) + '\n결재선: ' + lineSummary(cfg);
      if (!window.confirm('확인창 없이 바로 상신합니다.\n\n' + sumTxt + '\n\n진행할까요?')) throw new Error('취소했어요.');
    }
    persist();
    if (q('remember').checked) showSummary(cfg);

    await openScreen();
    log('1/6 신청 창 여는 중...');
    var P = null;
    for (var tries = 1; tries <= 3 && !P; tries++) {
      app('srv_mymmm00_m00').lookup('btnAply').click();
      try {
        P = await waitFor(function () { var a = app('srv_mymmm00_p00'); return a && a.lookup('cmbWorkSittnSclfCd') && a.lookup('cmbWorkSittnSclfCd').getItems().length && a; }, 15000, '신청 창');
      } catch (e) {
        if (tries === 3 || !readAlert()) throw e;
        dismissAlert(); await sleep(2000);
      }
    }
    await sleep(500);

    log('2/6 입력 중: ' + ty[2]);
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
    if (g('workSittnSclfCd') !== ty[1]) bad.push('근무상황');
    if (g('bgngYmd') !== ymd(d1) || g('endYmd') !== ymd(d2)) bad.push('날짜');
    if (g('bgngH') !== h1 || g('bgngM') !== m1 || g('endH') !== h2 || g('endM') !== m2) bad.push('시간');
    if (isAv ? g('avRsnCd') !== av : g('workSittnRsnCn') !== rsn) bad.push('사유');
    if (bad.length) throw new Error('입력 확인 실패: ' + bad.join(', '));
    log('   신청시간 ' + g('workSittnDdTtl') + '일 ' + g('workSittnHrTtl') + '시간 ' + g('workSittnMTtl') + '분');

    log('3/6 승인요청...');
    P.lookup('btnAprvDmnd').click();
    var A = null, lastAlert = '', endA = Date.now() + 20000, alerts = 0;
    while (Date.now() < endA) {
      var aa = app('wam_woapm07_p00');
      if (aa && aa.lookup('btnSelectSancr')) { A = aa; break; }
      var am = readAlert();
      if (am) {
        if (++alerts > 3) break;
        lastAlert = am; log('   알림: ' + am); dismissAlert(); await sleep(1500);
        if (!app('wam_woapm07_p00') && !readAlert()) { await sleep(2000); if (!app('wam_woapm07_p00')) break; }
        continue;
      }
      await sleep(200);
    }
    if (!A) throw new Error(lastAlert ? '승인요청이 막혔어요. 위 알림 내용을 확인해 주세요.' : '기안문서상신 창 대기 시간 초과');
    await sleep(1500);

    if (cfg.mode === 'direct') await assignDirect(A, cfg); else await assignPersonal(A, lineNo);
    if (q('remember').checked) { cfg.ids = ids; saveCfg(cfg); }

    var sc = app('wam_woapm07_p00').lookup('dsSancr'), line = [], hasApr = false;
    for (var k = 1; k < sc.getRowCount(); k++) { var kn = sc.getValue(k, 'atrzScNm'); if (kn === '결재') hasApr = true; line.push(kn + ' ' + sc.getValue(k, 'userNm')); }
    if (!line.length || !hasApr) throw new Error('결재선에 결재자가 없어요. 결재선을 확인해 주세요.');
    log('   결재선: ' + line.join(' → '));

    log('6/6 상신 버튼...');
    for (var t2 = 1; t2 <= 3 && !confirmShown('상신하'); t2++) {
      app('wam_woapm07_p00').lookup('btnDrft').click();
      await waitFor(function () { return confirmShown('상신하'); }, 7000, '').catch(function (e) { if (/나이스 알림/.test(e.message)) throw e; });
    }
    await waitFor(function () { return confirmShown('상신하'); }, 15000, '상신 확인창');
    if (!autoSubmit) {
      log('\n완료! "상신하겠습니까?" 확인창에서 멈췄어요.\n내용 확인 후 [확인]을 직접 눌러 주세요.\n(취소하면 임시저장 건이 남아요. 목록에서 삭제하세요.)');
      return;
    }
    log('   바로 상신: 확인 누름');
    var cf = app('app/cmn/confirm');
    if (!cf || !cf.lookup('btnConfirm')) throw new Error('확인창 버튼을 못 찾았어요. 확인을 직접 눌러 주세요.');
    cf.lookup('btnConfirm').click();
    var endS = Date.now() + 20000, resMsg = '';
    while (Date.now() < endS) {
      var rm = readAlert();
      if (rm) { resMsg = rm; dismissAlert(); await sleep(800); continue; }
      if (!app('wam_woapm07_p00') && !app('app/cmn/')) break;
      await sleep(300);
    }
    if (resMsg) log('   나이스 알림: ' + resMsg);
    if (app('wam_woapm07_p00')) throw new Error('상신 창이 아직 열려 있어요. 화면을 확인해 주세요.');
    log('\n상신 완료! 개인근무상황관리 목록에서 결재상태를 확인해 주세요.');
    var m0 = app('srv_mymmm00_m00'); if (m0 && m0.lookup('btnSearch')) m0.lookup('btnSearch').click();
  }

  refreshType(); refreshMode(); refreshFin();
})();
