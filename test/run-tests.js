// 자동 테스트: node test/run-tests.js
// 전부 통과해야 배포합니다.
const assert = require('assert');
const { loadGas, seedFake } = require('./gas-mock');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const fresh = (opts) => { const g = loadGas(opts); seedFake(g); return g; };
const ok = (res, msg) => { assert.strictEqual(res.ok, true, `${msg || ''} → ${res.error || JSON.stringify(res)}`); return res; };
const fail = (res, code) => { assert.strictEqual(res.ok, false, '실패해야 하는데 성공함'); if (code) assert.strictEqual(res.code, code, `코드 ${res.code}: ${res.error}`); return res; };

function studentReady(g, school, name, pw = 'abcd') {
  const r = ok(g.call('studentLogin', { school, name, password: '0000' }), '초기 로그인');
  ok(g.call('changePassword', { token: r.token, currentPassword: '0000', newPassword: pw }), '비번 변경');
  return r.token;
}
function teacherReady(g, pw = 'teach123') {
  g.ctx.setTeacherPassword_(pw);
  return ok(g.call('teacherLogin', { password: pw })).token;
}

/* ── 시트 준비 ── */

test('시트 탭 만들기: 6개 탭과 칸 이름이 생긴다', () => {
  const g = loadGas();
  g.ctx.setupSheets_();
  const names = g.ss.getSheets().map((s) => s.getName());
  assert.deepStrictEqual(names, ['학생', '세트', '문항', '제출', '숙제검사', '설정']);
  assert.deepStrictEqual(g.sheet('문항').data[0], ['세트ID', '번호', '정답', '배점', '단원', '세부항목', '메모']);
});

test('시트 탭 만들기를 두 번 해도 칸이 중복되지 않고, 선생님이 추가한 칸은 남는다', () => {
  const g = loadGas();
  g.ctx.setupSheets_();
  g.sheet('학생').setCell(1, 11, '연락처메모');
  g.ctx.setupSheets_();
  const h = g.sheet('학생').data[0];
  assert.strictEqual(h.filter((x) => x === '이름').length, 1);
  assert.ok(h.includes('연락처메모'));
  assert.strictEqual(g.sheet('설정').objects().length, 4);
});

test('탭이 없으면 알아듣기 쉬운 오류', () => {
  const g = loadGas();
  fail(g.call('schools'), 'SETUP');
});

/* ── 채점 ── */

test('정답 칸 읽기: "2,4" / 24 / "②④" / " 3 " 모두 같은 뜻', () => {
  const g = loadGas();
  const p = (v) => Array.from(g.ctx.parseChoices_(v));
  assert.deepStrictEqual(p('2,4'), [2, 4]);
  assert.deepStrictEqual(p(24), [2, 4]);
  assert.deepStrictEqual(p('②④'), [2, 4]);
  assert.deepStrictEqual(p('4, 2'), [2, 4]);
  assert.deepStrictEqual(p(' 3 '), [3]);
  assert.deepStrictEqual(p(''), []);
});

test('채점: 복수 정답은 완전히 같아야 맞음, 비운 문항은 틀림, 100점 환산', () => {
  const g = loadGas();
  const items = [
    { no: 1, key: [3], points: 1 },
    { no: 2, key: [2, 4], points: 1 },
    { no: 3, key: [1], points: 1 }
  ];
  const r = g.ctx.grade_(items, { 1: [3], 2: [2], 3: [] });
  assert.strictEqual(r.correct, 1);
  assert.deepStrictEqual(Array.from(r.wrong), [2, 3]);
  assert.deepStrictEqual(Array.from(r.blank), [3]);
  assert.strictEqual(r.score, 33.3);
  assert.strictEqual(g.ctx.grade_(items, { 1: [3], 2: [2, 4], 3: [1] }).score, 100);
  assert.strictEqual(g.ctx.grade_(items, { 1: [3], 2: [2, 3, 4], 3: [1] }).correct, 2, '정답보다 많이 골라도 틀림');
});

test('채점: 배점이 다르면 배점 비율로 100점 환산', () => {
  const g = loadGas();
  const items = [{ no: 1, key: [1], points: 3 }, { no: 2, key: [2], points: 1 }];
  assert.strictEqual(g.ctx.grade_(items, { 1: [1], 2: [5] }).score, 75);
});

/* ── 학생 로그인 ── */

test('학교 목록: 퇴원생 학교 제외, 가나다순', () => {
  const g = fresh();
  assert.deepStrictEqual(ok(g.call('schools')).schools, ['샘플고A', '샘플고B']);
});

test('처음 로그인은 0000, 비밀번호를 바꾸기 전에는 아무것도 못 함', () => {
  const g = fresh();
  const r = ok(g.call('studentLogin', { school: '샘플고A', name: '가상학생01', password: '0000' }));
  assert.strictEqual(r.mustChange, true);
  fail(g.call('studentHome', { token: r.token }), 'MUST_CHANGE');
  fail(g.call('getSet', { token: r.token, setId: 'DEMO-A-1' }), 'MUST_CHANGE');
  fail(g.call('submit', { token: r.token, setId: 'DEMO-A-1', answers: {} }), 'MUST_CHANGE');
});

test('새 비밀번호 규칙: 0000 금지, 4자 미만 금지, 띄어쓰기 금지', () => {
  const g = fresh();
  const r = ok(g.call('studentLogin', { school: '샘플고A', name: '가상학생01', password: '0000' }));
  fail(g.call('changePassword', { token: r.token, currentPassword: '0000', newPassword: '0000' }));
  fail(g.call('changePassword', { token: r.token, currentPassword: '0000', newPassword: '123' }));
  fail(g.call('changePassword', { token: r.token, currentPassword: '0000', newPassword: '12 34' }));
});

test('비밀번호를 바꾸면 시트에는 해시만 남고, 0000으로는 더 못 들어감', () => {
  const g = fresh();
  studentReady(g, '샘플고A', '가상학생01', 'mypw77');
  const rec = g.sheet('학생').objects().find((x) => x.이름 === '가상학생01');
  assert.ok(/^[0-9a-f]{64}$/.test(rec.비밀번호해시), '해시 형식');
  assert.ok(!JSON.stringify(g.sheet('학생').data).includes('mypw77'), '시트에 비밀번호 원문이 없어야 함');
  assert.ok(/^S\d{4}$/.test(rec.학생ID), '학생ID 자동 생성');
  fail(g.call('studentLogin', { school: '샘플고A', name: '가상학생01', password: '0000' }), 'BADPW');
  const r = ok(g.call('studentLogin', { school: '샘플고A', name: '가상학생01', password: 'mypw77' }));
  assert.strictEqual(r.mustChange, false);
  ok(g.call('studentHome', { token: r.token }));
});

test('이름 앞뒤·가운데 띄어쓰기는 무시하고 찾는다', () => {
  const g = fresh();
  ok(g.call('studentLogin', { school: ' 샘플고A', name: '가상 학생01 ', password: '0000' }));
});

test('5번 틀리면 15분 잠금, 잠금 중엔 맞는 비밀번호도 안 됨, 15분 뒤 풀림', () => {
  const g = fresh({ now: '2026-11-07T18:00:00+09:00' });
  studentReady(g, '샘플고A', '가상학생02', 'right1');
  for (let i = 0; i < 4; i++) fail(g.call('studentLogin', { school: '샘플고A', name: '가상학생02', password: 'nope' }), 'BADPW');
  fail(g.call('studentLogin', { school: '샘플고A', name: '가상학생02', password: 'nope' }), 'LOCKED');
  fail(g.call('studentLogin', { school: '샘플고A', name: '가상학생02', password: 'right1' }), 'LOCKED');
  g.advance(14 * 60000);
  fail(g.call('studentLogin', { school: '샘플고A', name: '가상학생02', password: 'right1' }), 'LOCKED');
  g.advance(2 * 60000);
  ok(g.call('studentLogin', { school: '샘플고A', name: '가상학생02', password: 'right1' }));
  const rec = g.sheet('학생').objects().find((x) => x.이름 === '가상학생02');
  assert.ok(!rec.실패횟수 && !rec.잠금해제시각, '성공하면 실패 기록이 지워짐');
});

test('비밀번호 바꾸기에서 현재 비밀번호를 틀려도 실패 횟수에 들어감', () => {
  const g = fresh();
  const token = studentReady(g, '샘플고A', '가상학생03', 'pass11');
  fail(g.call('changePassword', { token, currentPassword: 'xxxx', newPassword: 'pass22' }), 'BADPW');
  const rec = g.sheet('학생').objects().find((x) => x.이름 === '가상학생03');
  assert.strictEqual(Number(rec.실패횟수), 1);
});

test('없는 학생, 퇴원생, 같은 학교 동명이인은 로그인 불가', () => {
  const g = fresh();
  fail(g.call('studentLogin', { school: '샘플고A', name: '없는학생', password: '0000' }), 'NOT_FOUND');
  fail(g.call('studentLogin', { school: '샘플고A', name: '가상학생10', password: '0000' }), 'NOT_FOUND');
  g.sheet('학생').addRow({ 이름: '가상학생01', 학교: '샘플고A' });
  fail(g.call('studentLogin', { school: '샘플고A', name: '가상학생01', password: '0000' }), 'DUPLICATE');
});

test('선생님 메뉴: 비밀번호 0000으로 되돌리기, 잠금 풀기', () => {
  const g = fresh();
  studentReady(g, '샘플고A', '가상학생04', 'pw4444');
  const row = g.sheet('학생').objects().find((x) => x.이름 === '가상학생04')._row;
  g.ctx.resetStudentRows_([row]);
  const r = ok(g.call('studentLogin', { school: '샘플고A', name: '가상학생04', password: '0000' }));
  assert.strictEqual(r.mustChange, true);
  for (let i = 0; i < 5; i++) g.call('studentLogin', { school: '샘플고A', name: '가상학생04', password: 'bad' });
  fail(g.call('studentLogin', { school: '샘플고A', name: '가상학생04', password: '0000' }), 'LOCKED');
  g.ctx.unlockStudentRows_([row]);
  ok(g.call('studentLogin', { school: '샘플고A', name: '가상학생04', password: '0000' }));
});

test('잘못된 토큰이나 없는 요청은 거절', () => {
  const g = fresh();
  fail(g.call('studentHome', { token: 'fake' }), 'AUTH');
  fail(g.call('teacherToday', { token: '' }), 'AUTH');
  fail(g.call('없는요청'));
  assert.strictEqual(g.raw('이건 JSON 아님').ok, false);
});

/* ── 세트와 제출 ── */

test('학생 화면 세트 목록: 자기 학교 + 공통 + 사용=Y + 문제없는 세트만', () => {
  const g = fresh();
  const tA = studentReady(g, '샘플고A', '가상학생01');
  const idsA = ok(g.call('studentHome', { token: tA })).sets.map((s) => s.setId).sort();
  assert.deepStrictEqual(idsA, ['DEMO-A-1', 'DEMO-ALL']);
  const tB = studentReady(g, '샘플고B', '가상학생07');
  const idsB = ok(g.call('studentHome', { token: tB })).sets.map((s) => s.setId).sort();
  assert.deepStrictEqual(idsB, ['DEMO-ALL', 'DEMO-B-1']);
  fail(g.call('getSet', { token: tA, setId: 'DEMO-B-1' }), 'NO_SET');
  fail(g.call('getSet', { token: tA, setId: 'DEMO-OFF' }), 'NO_SET');
  fail(g.call('getSet', { token: tA, setId: 'DEMO-BAD' }), 'NO_SET');
});

test('문제 세트를 열 때 정답은 절대 보내지 않는다', () => {
  const g = fresh();
  const t = studentReady(g, '샘플고A', '가상학생01');
  const r = ok(g.call('getSet', { token: t, setId: 'DEMO-A-1' }));
  assert.deepStrictEqual(Object.keys(r).sort(), ['choices', 'numbers', 'ok', 'setId', 'title', 'version']);
  assert.strictEqual(r.choices, 5);
  assert.deepStrictEqual(r.numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('제출: 채점 결과가 맞고, 제출 탭에 기록되고, 같은 세트는 다시 못 냄', () => {
  const g = fresh({ now: '2026-11-07T18:30:00+09:00' });
  const t = studentReady(g, '샘플고A', '가상학생01');
  // 정답: 3, 24, 1, 5, 4, 2, 13, 3, 5, 2, 4, 1
  const answers = { 1: [3], 2: [2, 4], 3: [1], 4: [5], 5: [4], 6: [2], 7: [1], 8: [3], 9: [5], 10: [2], 11: [], 12: [1] };
  const r = ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers }));
  assert.strictEqual(r.result.correct, 10);
  assert.deepStrictEqual(r.result.wrong, [7, 11]);
  assert.deepStrictEqual(r.result.blank, [11]);
  assert.strictEqual(r.result.score, 83.3);
  const row = g.sheet('제출').objects()[0];
  assert.strictEqual(row.이름, '가상학생01');
  assert.strictEqual(row.날짜, '2026-11-07');
  assert.strictEqual(row.답안, '1:3 2:24 3:1 4:5 5:4 6:2 7:1 8:3 9:5 10:2 11:- 12:1');
  assert.strictEqual(row.틀린문항, '7, 11');
  fail(g.call('submit', { token: t, setId: 'DEMO-A-1', answers }), 'ALREADY');
  fail(g.call('getSet', { token: t, setId: 'DEMO-A-1' }), 'ALREADY');
  assert.strictEqual(g.sheet('제출').objects().length, 1);
  const mine = ok(g.call('myResult', { token: t, setId: 'DEMO-A-1' }));
  assert.deepStrictEqual(mine.result, r.result);
  const home = ok(g.call('studentHome', { token: t }));
  const a = home.sets.find((s) => s.setId === 'DEMO-A-1');
  assert.strictEqual(a.done, true);
  assert.strictEqual(a.score, 83.3);
  assert.strictEqual(home.sets[0].done, false, '안 푼 세트가 먼저');
});

test('제출: 범위 밖 선지·없는 번호·이상한 값은 무시(빈칸 처리)', () => {
  const g = fresh();
  const t = studentReady(g, '샘플고A', '가상학생05');
  const r = ok(g.call('submit', { token: t, setId: 'DEMO-ALL', answers: { 1: [1, 1], 2: [7], 3: 'x', 99: [1], 4: [4.5] } }));
  assert.deepStrictEqual(r.result.blank, [2, 3, 4, 5]);
  assert.strictEqual(r.result.correct, 1);
  fail(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: [1, 2] }));
});

test('시트에서 정답을 숫자로 입력해도(24) 복수 정답으로 채점', () => {
  const g = fresh();
  const items = g.sheet('문항');
  const row = items.objects().find((x) => x.세트ID === 'DEMO-A-1' && Number(x.번호) === 2)._row;
  items.data[row - 1][2] = 24; // 숫자로 바뀐 경우
  const t = studentReady(g, '샘플고A', '가상학생06');
  const r = ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: { 2: [2, 4] } }));
  assert.ok(!r.result.wrong.includes(2));
});

/* ── 선생님 ── */

test('선생님 비밀번호가 없으면 안내, 정하면 로그인, 틀리면 잠금', () => {
  const g = fresh();
  fail(g.call('teacherLogin', { password: 'whatever' }), 'NO_TEACHER_PW');
  assert.throws(() => g.ctx.setTeacherPassword_('123'), /6자/);
  g.ctx.setTeacherPassword_('teach123');
  assert.ok(!JSON.stringify(g.sheet('설정').data).includes('teach123'));
  fail(g.call('teacherLogin', { password: 'wrong' }), 'BADPW');
  ok(g.call('teacherLogin', { password: 'teach123' }));
  for (let i = 0; i < 5; i++) g.call('teacherLogin', { password: 'wrong' });
  fail(g.call('teacherLogin', { password: 'teach123' }), 'LOCKED');
});

test('학생 토큰으로 선생님 화면은 못 봄', () => {
  const g = fresh();
  const t = studentReady(g, '샘플고A', '가상학생01');
  fail(g.call('teacherToday', { token: t }), 'AUTH');
});

test('오늘 결과: 세트별 인원·평균·최고·최저·문항별 정답률·미제출·세트 점검', () => {
  const g = fresh({ now: '2026-11-06T20:00:00+09:00' });
  // 어제 제출 1건 (오늘 결과에 안 나와야 함)
  const t3 = studentReady(g, '샘플고A', '가상학생03');
  ok(g.call('submit', { token: t3, setId: 'DEMO-A-1', answers: { 1: [3] } }));
  g.advance(22 * 3600000); // 다음 날 18:00
  const t1 = studentReady(g, '샘플고A', '가상학생01');
  const t2 = studentReady(g, '샘플고A', '가상학생02');
  const all = { 1: [3], 2: [2, 4], 3: [1], 4: [5], 5: [4], 6: [2], 7: [1, 3], 8: [3], 9: [5], 10: [2], 11: [4], 12: [1] };
  ok(g.call('submit', { token: t1, setId: 'DEMO-A-1', answers: all }));
  ok(g.call('submit', { token: t2, setId: 'DEMO-A-1', answers: Object.assign({}, all, { 2: [2], 3: [] }) }));
  const tt = teacherReady(g);
  const r = ok(g.call('teacherToday', { token: tt }));
  assert.strictEqual(r.date, '2026-11-07');
  assert.strictEqual(r.sets.length, 1);
  const s = r.sets[0];
  assert.strictEqual(s.setId, 'DEMO-A-1');
  assert.strictEqual(s.submitted, 2);
  assert.strictEqual(s.max, 100);
  assert.strictEqual(s.min, 83.3);
  assert.strictEqual(s.avg, 91.7);
  assert.deepStrictEqual(s.rows.map((x) => x.name), ['가상학생01', '가상학생02']);
  assert.deepStrictEqual(s.rows[1].wrong, [2, 3]);
  assert.deepStrictEqual(s.rows[1].blank, [3]);
  assert.strictEqual(s.rows[0].time, '18:00');
  assert.strictEqual(s.itemRates.find((x) => x.no === 2).rate, 50);
  assert.strictEqual(s.itemRates.find((x) => x.no === 1).rate, 100);
  assert.strictEqual(s.itemRates.find((x) => x.no === 2).answer, '2,4');
  assert.strictEqual(s.itemRates[0].unit, '고전시가');
  // 미제출: 샘플고A 재원생 중 이 세트를 한 번도 안 낸 학생 (03은 어제 냄, 10은 퇴원)
  assert.deepStrictEqual(s.missing, ['가상학생04', '가상학생05', '가상학생06']);
  assert.deepStrictEqual(r.warnings.map((w) => w.setId), ['DEMO-BAD']);
  assert.match(r.warnings[0].problem, /2번 정답이 비어/);
  // 어제 날짜로 보면 어제 제출만
  const y = ok(g.call('teacherToday', { token: tt, date: '2026-11-06' }));
  assert.strictEqual(y.sets[0].submitted, 1);
  assert.deepStrictEqual(y.sets[0].rows.map((x) => x.name), ['가상학생03']);
});

test('오늘 제출이 없으면 빈 목록', () => {
  const g = fresh();
  const tt = teacherReady(g);
  assert.deepStrictEqual(ok(g.call('teacherToday', { token: tt })).sets, []);
});

test('브라우저로 서버 주소를 열면 버전이 보임', () => {
  const g = loadGas();
  const out = JSON.parse(g.ctx.doGet().getContent());
  assert.strictEqual(out.ok, true);
  assert.match(out.version, /^\d+\.\d+\.\d+$/);
});

test('예상 못 한 서버 오류가 없었다', () => {
  // 위 테스트들은 각자 새 환경을 쓰므로, 여기선 대표 흐름을 한 번 더 돌려 오류 기록을 확인
  const g = fresh();
  const t = studentReady(g, '샘플고A', '가상학생01');
  ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: { 1: [3] } }));
  ok(g.call('teacherToday', { token: teacherReady(g) }));
  assert.deepStrictEqual(g.errors, []);
});

/* ── 누적 리포트 (v1.1.0) ── */

const KEY_A = { 1: [3], 2: [2, 4], 3: [1], 4: [5], 5: [4], 6: [2], 7: [1, 3], 8: [3], 9: [5], 10: [2], 11: [4], 12: [1] };
function setWeek(g, setId, week) {
  const sh = g.sheet('세트');
  const col = sh.data[0].indexOf('주차') + 1;
  const row = sh.objects().find((x) => x.세트ID === setId)._row;
  sh.setCell(row, col, week);
}
function addSet2(g) {
  g.sheet('세트').addRow({ 세트ID: 'DEMO-A-2', 세트이름: '[가짜] 2주차 점검', 학교: '샘플고A', 사용: 'Y', 주차: '2주차' });
  ['1', '2', '3', '4'].forEach((k, i) => g.sheet('문항').addRow({ 세트ID: 'DEMO-A-2', 번호: i + 1, 정답: k, 단원: '고전시가', 세부항목: i < 2 ? '표현상 특징' : '화자의 태도' }));
}

test('시트 탭 만들기: 세트 탭에 주차 칸이 생긴다', () => {
  const g = loadGas();
  g.ctx.setupSheets_();
  assert.ok(g.sheet('세트').data[0].includes('주차'));
});

test('주차 칸이 없는 예전 시트에서도 기존 기능은 그대로 동작한다', () => {
  const g = fresh({ now: '2026-11-07T18:00:00+09:00' });
  const sh = g.sheet('세트');
  const col = sh.data[0].indexOf('주차');
  sh.data.forEach((row) => { row[col] = ''; }); // 주차 칸 통째로 없애기
  const t = studentReady(g, '샘플고A', '가상학생01');
  ok(g.call('studentHome', { token: t }));
  ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: KEY_A }));
  ok(g.call('teacherToday', { token: teacherReady(g) }));
  const r = ok(g.call('myTrend', { token: t }));
  assert.deepStrictEqual(r.weeks, []);
  assert.strictEqual(r.unweeked, 1);
});

test('주차별 점수: 같은 주차 세트는 점수 평균, 주차 평균은 주차 점수의 평균', () => {
  const g = fresh({ now: '2026-11-03T18:00:00+09:00' });
  setWeek(g, 'DEMO-ALL', 1);
  addSet2(g);
  const t = studentReady(g, '샘플고A', '가상학생01');
  ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: KEY_A }));                       // 100
  ok(g.call('submit', { token: t, setId: 'DEMO-ALL', answers: { 1: [1], 2: [2], 3: [1] } }));  // 2/5 = 40
  g.advance(7 * 86400000);
  ok(g.call('submit', { token: t, setId: 'DEMO-A-2', answers: { 1: [1], 2: [2], 3: [3] } }));  // 3/4 = 75
  const r = ok(g.call('myTrend', { token: t }));
  assert.deepStrictEqual(r.weeks.map((w) => [w.label, w.score]), [['1주차', 70], ['2주차', 75]]);
  assert.strictEqual(r.weeks[0].sets.length, 2);
  assert.strictEqual(r.avg, 72.5);
  assert.strictEqual(r.submitted, 3);
});

test('세부항목 집계와 약한 세부항목(2문항 이상·80% 미만, 낮은 순 최대 3개)', () => {
  const g = fresh();
  addSet2(g);
  const t = studentReady(g, '샘플고A', '가상학생01');
  // A-1: 7번(외적 준거 감상 아님: 7번은 i%4=2 → 시어의 의미), 11번(i%4=2 → 시어의 의미) 틀림
  ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: Object.assign({}, KEY_A, { 7: [1], 11: [] }) }));
  // A-2: 3,4번(화자의 태도) 틀림
  ok(g.call('submit', { token: t, setId: 'DEMO-A-2', answers: { 1: [1], 2: [2], 3: [1], 4: [1] } }));
  const r = ok(g.call('myTrend', { token: t }));
  const tag = (name) => r.tags.find((x) => x.tag === '고전시가 > ' + name);
  assert.deepStrictEqual([tag('시어의 의미').correct, tag('시어의 의미').total], [1, 3]);
  assert.deepStrictEqual([tag('화자의 태도').correct, tag('화자의 태도').total], [3, 5]);
  assert.deepStrictEqual([tag('표현상 특징').correct, tag('표현상 특징').total], [5, 5]);
  assert.deepStrictEqual(r.weak.map((x) => [x.detail, x.rate]), [['시어의 의미', 33], ['화자의 태도', 60]]);
});

test('제출한 뒤에 추가된 문항은 세부항목 집계에서 빠진다', () => {
  const g = fresh();
  const t = studentReady(g, '샘플고A', '가상학생01');
  ok(g.call('submit', { token: t, setId: 'DEMO-ALL', answers: { 1: [1], 2: [2], 3: [3], 4: [4], 5: [5] } }));
  g.sheet('문항').addRow({ 세트ID: 'DEMO-ALL', 번호: 6, 정답: '1', 단원: '어휘', 세부항목: '한자어' });
  const r = ok(g.call('myTrend', { token: t }));
  assert.strictEqual(r.tags.find((x) => x.detail === '한자어').total, 5);
});

test('학생 추이에는 자기 기록만 있다 (다른 학생 이름 없음)', () => {
  const g = fresh();
  const t1 = studentReady(g, '샘플고A', '가상학생01');
  const t2 = studentReady(g, '샘플고A', '가상학생02');
  ok(g.call('submit', { token: t1, setId: 'DEMO-A-1', answers: KEY_A }));
  ok(g.call('submit', { token: t2, setId: 'DEMO-A-1', answers: { 1: [1] } }));
  const r = ok(g.call('myTrend', { token: t2, studentId: 'S0001', name: '가상학생01' }));
  assert.ok(!JSON.stringify(r).includes('가상학생01'));
  assert.strictEqual(r.weeks[0].score, 0);
  fail(g.call('myTrend', { token: 'nope' }), 'AUTH');
  const fresh0 = ok(g.call('studentLogin', { school: '샘플고A', name: '가상학생03', password: '0000' }));
  fail(g.call('myTrend', { token: fresh0.token }), 'MUST_CHANGE');
});

test('선생님 누적 리포트: 학교별 학생 × 주차 점수, 주차별 반 평균, 주차 없는 세트 안내', () => {
  const g = fresh({ now: '2026-11-03T18:00:00+09:00' });
  addSet2(g);
  const t1 = studentReady(g, '샘플고A', '가상학생01');
  const t2 = studentReady(g, '샘플고A', '가상학생02');
  ok(g.call('submit', { token: t1, setId: 'DEMO-A-1', answers: KEY_A }));                  // 1주차 100
  ok(g.call('submit', { token: t2, setId: 'DEMO-A-1', answers: Object.assign({}, KEY_A, { 1: [1], 2: [2], 3: [] }) })); // 75
  ok(g.call('submit', { token: t1, setId: 'DEMO-ALL', answers: { 1: [1] } }));             // 주차 없음
  ok(g.call('submit', { token: t1, setId: 'DEMO-A-2', answers: { 1: [1], 2: [2], 3: [3], 4: [4] } })); // 2주차 100
  const tt = teacherReady(g);
  fail(g.call('teacherTrend', { token: t1 }), 'AUTH');
  const r = ok(g.call('teacherTrend', { token: tt }));
  assert.deepStrictEqual(r.schools, ['샘플고A', '샘플고B']);
  assert.strictEqual(r.school, '샘플고A');
  assert.deepStrictEqual(r.weeks.map((w) => [w.label, w.avg, w.n]), [['1주차', 87.5, 2], ['2주차', 100, 1]]);
  const names = r.students.map((x) => x.name);
  assert.deepStrictEqual(names, ['가상학생01', '가상학생02', '가상학생03', '가상학생04', '가상학생05', '가상학생06']);
  const s1 = r.students[0];
  assert.deepStrictEqual([s1.weeks[1].score, s1.weeks[2].score, s1.avg, s1.submitted], [100, 100, 100, 3]);
  assert.strictEqual(r.students[2].submitted, 0);
  assert.deepStrictEqual(r.students[2].weeks, {});
  assert.deepStrictEqual(r.unweekedSets.map((x) => x.setId), ['DEMO-ALL']);
  const b = ok(g.call('teacherTrend', { token: tt, school: '샘플고B' }));
  assert.deepStrictEqual(b.students.map((x) => x.name), ['가상학생07', '가상학생08', '가상학생09']);
  const unknown = ok(g.call('teacherTrend', { token: tt, school: '없는학교' }));
  assert.strictEqual(unknown.school, '샘플고A');
});

/* ── 실행 ── */

let passed = 0;
const failed = [];
for (const t of tests) {
  try { t.fn(); passed++; console.log('  ✓ ' + t.name); }
  catch (e) { failed.push(t.name); console.log('  ✗ ' + t.name + '\n      ' + (e && e.message)); }
}
console.log(`\n${passed}/${tests.length} 통과`);
if (failed.length) { console.log('실패: ' + failed.join(' / ')); process.exit(1); }
