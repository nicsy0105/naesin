/*
 * 내신 클리닉 — '평가 채우기' 버튼 (v1.1.0)
 * 맥가이7 [클리닉수업관리 → 출석입력] 화면에서 즐겨찾기 버튼으로 불러 씁니다.
 *
 * 하는 일: 학생마다 '평가' 칸에 있는 틀의 빈 점수만 채움
 *   "- 총 / 30문항"   → "- 총 25 / 30문항"
 *   "- 품사 :  / 30"  → "- 품사 : 25 / 30"   (문항 탭의 '단원' 이름과 같은 줄만)
 *   (v1.1.0) 학부모 비밀번호를 만든 학생은 맨 끝에 '■ 성적 리포트' 링크 줄을 한 번만 붙임
 * 하지 않는 일: 이미 숫자가 있는 줄, 앱에 없는 줄(자습서·평가문제집 등)은 건드리지 않음.
 *              [저장]·[문자보내기]는 누르지 않음. 선생님이 확인하고 직접 누름.
 * 학생 정보는 이 파일에 없습니다. 선생님 비밀번호로 서버에서 그날 점수만 받아 옵니다.
 */
(function () {
  'use strict';
  var VERSION = '1.1.0';
  var TOKEN_KEY = 'naesin.fill.token';
  var PANEL_ID = 'naesin-fill-panel';

  var old = document.getElementById(PANEL_ID);
  if (old) old.remove();

  var API = (window.APP_CONFIG || {}).API_URL || '';
  // 이 파일이 있는 주소(GitHub Pages)에서 학부모 리포트 주소를 만듦
  var REPORT_URL = (function () {
    var me = document.currentScript;
    if (!me || !/fill\.js/.test(me.src || '')) {
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i--) if (/\/fill\.js(\?|$)/.test(all[i].src || '')) { me = all[i]; break; }
    }
    return me && me.src ? me.src.replace(/fill\.js(\?.*)?$/, 'parent.html') : '';
  })();
  var LINK_HEAD = '■ 성적 리포트 (학부모 비밀번호로 보기)';

  /* ── 작은 창 ── */
  var panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('style', [
    'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647', 'width:380px', 'max-height:80vh', 'overflow:auto',
    'background:#fff', 'color:#1d1d1f', 'border:2px solid #1d1d1f', 'border-radius:14px', 'box-shadow:0 10px 30px rgba(0,0,0,.25)',
    'font:14px/1.55 "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif', 'padding:16px 18px'
  ].join(';'));
  document.body.appendChild(panel);

  function h(tag, style, text) {
    var n = document.createElement(tag);
    if (style) n.setAttribute('style', style);
    if (text != null) n.textContent = text;
    return n;
  }
  function header() {
    var top = h('div', 'display:flex;align-items:center;gap:8px;margin-bottom:10px');
    top.appendChild(h('b', 'font-size:16px', '평가 채우기'));
    top.appendChild(h('span', 'color:#6b6b70;font-size:12px', '내신 클리닉 v' + VERSION));
    var x = h('button', 'margin-left:auto;border:0;background:none;font-size:20px;cursor:pointer;color:#6b6b70', '×');
    x.type = 'button';
    x.onclick = function () { panel.remove(); };
    top.appendChild(x);
    return top;
  }
  function show() {
    panel.innerHTML = '';
    panel.appendChild(header());
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) panel.appendChild(arguments[i]);
  }
  function msg(text, color) { return h('div', 'margin:6px 0;white-space:pre-line;' + (color ? 'color:' + color + ';font-weight:600' : ''), text); }
  function btn(text, onclick, ghost) {
    var b = h('button', 'margin-top:10px;height:38px;padding:0 14px;border-radius:9px;border:1.5px solid #1d1d1f;cursor:pointer;font-weight:700;font-size:14px;' +
      (ghost ? 'background:#fff;color:#1d1d1f' : 'background:#1d1d1f;color:#fff'), text);
    b.type = 'button';
    b.onclick = onclick;
    return b;
  }
  function section(title, items, color) {
    if (!items.length) return null;
    var box = h('div', 'margin-top:12px');
    box.appendChild(h('div', 'font-weight:700;color:' + (color || '#1d1d1f'), title + ' (' + items.length + '명)'));
    var ul = h('ul', 'margin:4px 0 0;padding-left:18px');
    items.forEach(function (t) { ul.appendChild(h('li', '', t)); });
    box.appendChild(ul);
    return box;
  }

  /* ── 서버 ── */
  function api(action, data) {
    var body = JSON.stringify(Object.assign({ action: action }, data || {}));
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
      .then(function (r) { return r.json(); }, function () { throw { message: '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.' }; })
      .then(function (out) {
        if (!out.ok) throw { message: out.error === '알 수 없는 요청이에요.' ? '서버가 아직 예전 버전이에요. Code.gs를 v1.3.0 이상으로 배포해 주세요.' : out.error, code: out.code };
        return out;
      });
  }
  function getToken() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  /* ── 사이트 확인 ── */
  function site() {
    var $ = window.jQuery;
    var ds = window.dsLST1;
    var dateEl = document.getElementById('txt_yyyymmdd');
    if (!$ || !ds || !document.getElementById('tb_list1') || !dateEl) return null;
    return { $: $, ds: ds, date: dateEl.value };
  }

  /* ── 평가 글 채우기 ── */
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function fillMemo(memo, r) {
    var filled = [], skipped = [];
    var out = memo.replace(/-[ \t]*총[ \t]*(\d*)[ \t]*\/[ \t]*(\d+)[ \t]*문항/, function (m, cur, den) {
      if (cur) { skipped.push('총: 이미 숫자가 있음'); return m; }
      if (Number(den) !== r.count) { skipped.push('총: 틀은 ' + den + '문항, 앱 기록은 ' + r.count + '문항이라 비워 둠'); return m; }
      filled.push('총 ' + r.correct + '/' + den);
      return '- 총 ' + r.correct + ' / ' + den + '문항';
    });
    (r.units || []).forEach(function (u) {
      var re = new RegExp('-[ \\t]*' + reEsc(u.unit) + '[ \\t]*:[ \\t]*(\\d*)[ \\t]*\\/[ \\t]*(\\d+)');
      out = out.replace(re, function (m, cur, den) {
        if (cur) { skipped.push(u.unit + ': 이미 숫자가 있음'); return m; }
        if (Number(den) !== u.total) { skipped.push(u.unit + ': 틀은 ' + den + '문항, 앱 기록은 ' + u.total + '문항이라 비워 둠'); return m; }
        filled.push(u.unit + ' ' + u.correct + '/' + den);
        return '- ' + u.unit + ' : ' + u.correct + ' / ' + den;
      });
    });
    return { memo: out, changed: out !== memo, filled: filled, skipped: skipped };
  }

  // 리포트 링크 줄: 이미 있으면(주소나 제목이 있으면) 다시 넣지 않음
  function addLink(memo) {
    if (!REPORT_URL || memo.indexOf('parent.html') >= 0 || memo.indexOf('■ 성적 리포트') >= 0) return null;
    return memo.replace(/[\r\n]+$/, '') + '\n\n' + LINK_HEAD + '\n' + REPORT_URL;
  }

  function run(token) {
    var s = site();
    show(msg('점수를 받아 오는 중…'));
    api('teacherEval', { token: token, date: s.date }).then(function (res) {
      var byKey = {};
      res.students.forEach(function (r) { byKey[norm(r.name) + '|' + norm(r.school)] = r; });
      var used = {};
      var done = [], partial = [], none = [], noTemplate = [], noParent = [];
      var oldServer = res.students.length && res.students[0].parent === undefined;
      for (var i = 1; i <= s.ds.length; i++) {
        var row = s.ds[i];
        if (!row || row.status === 'D') continue;
        var key = norm(row.M_NAME) + '|' + norm(row.M_SCHOOL);
        var r = byKey[key];
        var who = row.M_NAME + ' (' + row.M_SCHOOL + ')';
        if (!r) { none.push(who); continue; }
        used[key] = true;
        var memo = String(row.CC_MEMO == null ? '' : row.CC_MEMO);
        var f = fillMemo(memo, r);
        if (!f.filled.length && !f.skipped.length) { noTemplate.push(who + ' — 평가 칸에 "- 총 / ' + r.count + '문항" 같은 틀이 없음'); continue; }
        var linked = false;
        if (r.parent === true) {
          var withLink = addLink(f.memo);
          if (withLink) { f.memo = withLink; f.changed = true; linked = true; }
        } else if (r.parent === false) noParent.push(who);
        if (f.changed) {
          s.$('#tb_list1').SetNameValue(i, 'CC_MEMO', f.memo);
          // 사이트에서 직접 평가를 고쳤을 때와 똑같이 처리 (담당 선생님 칸이 비어 있으면 채움)
          if (typeof window.tb_list1_exit === 'function') window.tb_list1_exit(i, 8, 'CC_MEMO', f.memo);
          // [저장]이 이 줄을 저장하도록 '바뀜' 표시
          if (!s.ds[i].status) {
            try { s.$('#tb_list1').setRowStatus(i, 'U'); } catch (e) {}
            if (!s.ds[i].status) s.ds[i].status = 'U';
          }
          done.push(who + ' — ' + f.filled.concat(linked ? ['리포트 링크'] : []).join(', '));
        }
        if (f.skipped.length) partial.push(who + ' — ' + f.skipped.join(', '));
      }
      var notOnSite = res.students.filter(function (r) { return !used[norm(r.name) + '|' + norm(r.school)]; })
        .map(function (r) { return r.name + ' (' + r.school + ') — 앱에 제출은 있지만 이 출석 목록에 없음'; });
      show(
        msg(res.date + ' 앱 제출 ' + res.students.length + '명 기준'),
        done.length ? msg('평가 칸을 채웠어요. 내용을 확인하신 뒤 [저장]을 눌러 주세요.\n(저장 전에는 사이트에 반영되지 않아요)', '#2b7a3d') : msg('새로 채운 학생이 없어요.', '#8a5300'),
        section('채움', done, '#2b7a3d'),
        section('일부만 채움 / 건너뜀', partial, '#8a5300'),
        section('평가 칸에 틀이 없음', noTemplate, '#8a5300'),
        section('학부모 비밀번호 없음 (링크 줄 안 넣음)', noParent, '#6b6b70'),
        oldServer ? msg('서버가 예전 버전이라 리포트 링크 줄은 넣지 않았어요.', '#8a5300') : null,
        section('앱 제출 기록 없음', none, '#6b6b70'),
        section('출석 목록에 없음', notOnSite, '#6b6b70'),
        btn('닫기', function () { panel.remove(); }, true)
      );
    }).catch(function (e) {
      if (e && e.code === 'AUTH') { setToken(''); return login('로그인이 끝났어요. 다시 입력해 주세요.'); }
      show(msg(e && e.message ? e.message : '문제가 생겼어요.', '#c8243c'), btn('닫기', function () { panel.remove(); }, true));
    });
  }

  function login(note) {
    var pw = h('input', 'width:100%;box-sizing:border-box;height:40px;border:1.5px solid #ccc;border-radius:9px;padding:0 10px;font-size:15px;margin-top:6px');
    pw.type = 'password';
    pw.placeholder = '내신 클리닉 선생님 비밀번호';
    var err = msg(note || '', '#c8243c');
    var go = btn('점수 채우기', submit);
    function submit() {
      if (!pw.value) return;
      go.disabled = true;
      api('teacherLogin', { password: pw.value }).then(function (r) { setToken(r.token); run(r.token); })
        .catch(function (e) { go.disabled = false; err.textContent = e.message; pw.value = ''; pw.focus(); });
    }
    pw.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });
    show(msg('출석입력 날짜(' + site().date + ')에 앱에서 제출한 점수로 평가 칸의 빈 점수를 채워요. 저장·발송은 하지 않아요.'), pw, err, go);
    pw.focus();
  }

  /* ── 시작 ── */
  if (!/^https?:/.test(API)) {
    show(msg('서버 주소(config.js)를 불러오지 못했어요.', '#c8243c'));
    return;
  }
  if (!site()) {
    show(msg('맥가이7 [클리닉수업관리 → 출석입력] 화면에서 날짜를 고르고 [검색]한 다음 눌러 주세요.', '#c8243c'));
    return;
  }
  if (window.CUR_TAB_ID && window.CUR_TAB_ID !== 'infotab_1') {
    show(msg('[출석입력] 탭을 연 상태에서 눌러 주세요.', '#c8243c'));
    return;
  }
  var t = getToken();
  if (t) run(t); else login();
})();
