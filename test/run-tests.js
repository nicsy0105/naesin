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

test('시트 탭 만들기: 7개 탭과 칸 이름이 생긴다 (v1.6.0: 서답형 탭 추가)', () => {
  const g = loadGas();
  g.ctx.setupSheets_();
  const names = g.ss.getSheets().map((s) => s.getName());
  assert.deepStrictEqual(names, ['학생', '세트', '문항', '제출', '서답형', '숙제검사', '설정']);
  assert.deepStrictEqual(g.sheet('서답형').data[0], ['세트ID', '학생ID', '이름', '학교', '객관식', '서답형1', '서답형2', '서답형3', '서답형4', '서답형5', '서답형합계', '합계', '메모']);
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
  g.sheet('세트').addRow({ 세트ID: 'DEMO-A-2', 세트이름: '[가짜] 2주차 점검', 학교: '샘플고A', 사용: 'Y', 주차: '2주차', 결과공개: 'Y' });
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

/* ── 세트별 결과공개 (v1.2.0) ── */

function setCell(g, setId, header, value) {
  const sh = g.sheet('세트');
  const col = sh.data[0].indexOf(header) + 1;
  const row = sh.objects().find((x) => x.세트ID === setId)._row;
  sh.setCell(row, col, value);
}

test('시트 탭 만들기: 세트 탭에 결과공개 칸이 생긴다', () => {
  const g = loadGas();
  g.ctx.setupSheets_();
  assert.ok(g.sheet('세트').data[0].includes('결과공개'));
});

test('결과공개가 비어 있으면: 제출 뒤 점수·틀린 문항 없이 내가 칠한 답만, 시트에는 점수 기록', () => {
  const g = fresh();
  setCell(g, 'DEMO-A-1', '결과공개', '');
  const t = studentReady(g, '샘플고A', '가상학생01');
  const r = ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: Object.assign({}, KEY_A, { 1: [5], 12: [] }) }));
  assert.strictEqual(r.revealed, false);
  assert.strictEqual(r.result, undefined);
  const txt = JSON.stringify(r);
  assert.ok(!/score|wrong|correct|점수/.test(txt), '점수 관련 값이 있으면 안 됨: ' + txt);
  assert.deepStrictEqual(r.myAnswers.slice(0, 2), [{ no: 1, choices: [5] }, { no: 2, choices: [2, 4] }]);
  assert.deepStrictEqual(r.myAnswers[11], { no: 12, choices: [] });
  const row = g.sheet('제출').objects()[0];
  assert.strictEqual(Number(row.점수), 83.3, '시트에는 점수가 그대로 기록');
  const mine = ok(g.call('myResult', { token: t, setId: 'DEMO-A-1' }));
  assert.strictEqual(mine.revealed, false);
  assert.strictEqual(mine.result, undefined);
  assert.deepStrictEqual(mine.myAnswers, r.myAnswers);
  const home = ok(g.call('studentHome', { token: t }));
  const a = home.sets.find((x) => x.setId === 'DEMO-A-1');
  assert.deepStrictEqual([a.done, a.revealed, a.score], [true, false, null]);
  // 선생님 화면에는 점수가 그대로
  const tr = ok(g.call('teacherToday', { token: teacherReady(g) }));
  assert.strictEqual(tr.sets[0].rows[0].score, 83.3);
  assert.strictEqual(tr.sets[0].reveal, false);
});

test('결과공개 Y: 지금처럼 점수와 틀린 문항을 보여 줌', () => {
  const g = fresh();
  const t = studentReady(g, '샘플고A', '가상학생01');
  const r = ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: KEY_A }));
  assert.strictEqual(r.revealed, true);
  assert.strictEqual(r.result.score, 100);
  assert.strictEqual(ok(g.call('studentHome', { token: t })).sets.find((x) => x.setId === 'DEMO-A-1').score, 100);
});

test('나중에 결과공개를 Y로 바꾸면 그때부터 학생이 결과를 봄', () => {
  const g = fresh();
  setCell(g, 'DEMO-A-1', '결과공개', '');
  const t = studentReady(g, '샘플고A', '가상학생01');
  ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: Object.assign({}, KEY_A, { 3: [2] }) }));
  assert.strictEqual(ok(g.call('myResult', { token: t, setId: 'DEMO-A-1' })).revealed, false);
  setCell(g, 'DEMO-A-1', '결과공개', 'Y');
  const mine = ok(g.call('myResult', { token: t, setId: 'DEMO-A-1' }));
  assert.strictEqual(mine.revealed, true);
  assert.deepStrictEqual(mine.result.wrong, [3]);
});

test('결과공개 칸이 아예 없는 시트: 숨김으로 처리되고 다른 기능은 그대로', () => {
  const g = fresh();
  const sh = g.sheet('세트');
  const col = sh.data[0].indexOf('결과공개');
  sh.data.forEach((row) => { row[col] = ''; });
  const t = studentReady(g, '샘플고A', '가상학생01');
  const r = ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: KEY_A }));
  assert.strictEqual(r.revealed, false);
  ok(g.call('teacherToday', { token: teacherReady(g) }));
});

test('내 성적 추이: 결과를 공개한 세트만 들어가고, 숨긴 세트 수를 알려 줌', () => {
  const g = fresh();
  addSet2(g);
  setCell(g, 'DEMO-A-2', '결과공개', '');
  const t = studentReady(g, '샘플고A', '가상학생01');
  ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: KEY_A }));
  ok(g.call('submit', { token: t, setId: 'DEMO-A-2', answers: { 1: [5], 2: [5], 3: [5], 4: [5] } }));
  const r = ok(g.call('myTrend', { token: t }));
  assert.deepStrictEqual(r.weeks.map((w) => w.label), ['1주차']);
  assert.strictEqual(r.hidden, 1);
  assert.strictEqual(r.submitted, 1);
  assert.ok(!JSON.stringify(r).includes('2주차 점검'));
  // 선생님 누적 리포트에는 숨긴 세트도 들어감
  const tr = ok(g.call('teacherTrend', { token: teacherReady(g) }));
  assert.deepStrictEqual(Object.keys(tr.students[0].weeks), ['1', '2']);
});

/* ── 학부모 문자용 평가 점수 (v1.3.0) ── */

test('평가 점수: 그날 제출을 학생별 총·단원별 맞은 수로 (선생님만)', () => {
  const g = fresh({ now: '2026-11-06T18:00:00+09:00' });
  // 문항 탭 단원을 두 갈래로: 1~8번 '고전시가', 9~12번 '문법'
  const items = g.sheet('문항');
  const ucol = items.data[0].indexOf('단원');
  items.objects().filter((x) => x.세트ID === 'DEMO-A-1' && Number(x.번호) >= 9).forEach((x) => { items.data[x._row - 1][ucol] = '문법'; });
  const t1 = studentReady(g, '샘플고A', '가상학생01');
  ok(g.call('submit', { token: t1, setId: 'DEMO-A-1', answers: { 1: [1] } })); // 어제 (오늘 결과에 안 들어감)
  g.advance(24 * 3600000);
  const t2 = studentReady(g, '샘플고A', '가상학생02');
  ok(g.call('submit', { token: t2, setId: 'DEMO-A-1', answers: Object.assign({}, KEY_A, { 1: [1], 9: [], 10: [5] }) }));
  const tt = teacherReady(g);
  fail(g.call('teacherEval', { token: t2 }), 'AUTH');
  const r = ok(g.call('teacherEval', { token: tt }));
  assert.strictEqual(r.date, '2026-11-07');
  assert.strictEqual(r.students.length, 1);
  const s = r.students[0];
  assert.deepStrictEqual([s.name, s.school, s.correct, s.count], ['가상학생02', '샘플고A', 9, 12]);
  assert.deepStrictEqual(s.units, [{ unit: '고전시가', correct: 7, total: 8 }, { unit: '문법', correct: 2, total: 4 }]);
  const y = ok(g.call('teacherEval', { token: tt, date: '2026-11-06' }));
  assert.deepStrictEqual(y.students.map((x) => [x.name, x.correct, x.count]), [['가상학생01', 0, 12]]);
});

test('평가 점수: 결과 비공개 세트도 선생님에게는 나옴', () => {
  const g = fresh();
  setCell(g, 'DEMO-A-1', '결과공개', '');
  const t = studentReady(g, '샘플고A', '가상학생01');
  ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: KEY_A }));
  const r = ok(g.call('teacherEval', { token: teacherReady(g) }));
  assert.strictEqual(r.students[0].correct, 12);
});

/* ── 세트 종류(내신/모의평가)·학년 (v1.4.0) ── */

function addMock(g, id, title, week, extra) {
  g.sheet('세트').addRow(Object.assign({ 세트ID: id, 세트이름: title, 학교: '샘플고A', 사용: 'Y', 주차: week, 결과공개: 'Y', 종류: '모의평가' }, extra || {}));
  // 배점이 문항마다 다른 학교 시험 모양: 3.2 + 4.1 + 2.7 = 10점
  [['2', 3.2], ['4', 4.1], ['1', 2.7]].forEach(([k, p], i) => g.sheet('문항').addRow({ 세트ID: id, 번호: i + 1, 정답: k, 배점: p, 단원: '고전시가', 세부항목: '화자의 태도' }));
}

test('시트 탭 만들기: 세트 탭에 종류·학년 칸이 생긴다', () => {
  const g = loadGas();
  g.ctx.setupSheets_();
  const h = g.sheet('세트').data[0];
  assert.ok(h.includes('종류') && h.includes('학년'));
});

test('종류 칸: 비우면 내신, "모의평가"·"모의"는 모의평가', () => {
  const g = loadGas();
  assert.strictEqual(g.ctx.parseKind_(''), '내신');
  assert.strictEqual(g.ctx.parseKind_('내신'), '내신');
  assert.strictEqual(g.ctx.parseKind_('모의평가'), '모의평가');
  assert.strictEqual(g.ctx.parseKind_('기출 모의'), '모의평가');
  assert.strictEqual(g.ctx.gradeKey_('고2'), '2');
  assert.strictEqual(g.ctx.gradeKey_(2), '2');
  assert.strictEqual(g.ctx.gradeKey_(''), '');
});

test('학년 칸: 그 학교의 같은 학년 학생에게만 보이고, 비우면 학교 전체', () => {
  const g = fresh();
  g.sheet('학생').addRow({ 이름: '가상학생11', 학교: '샘플고A', 학년: '1' });
  addMock(g, 'MOCK-A2', '[가짜] 2학년 모의평가', 1, { 학년: '고2' });
  addMock(g, 'MOCK-A', '[가짜] 학교 전체 모의평가', 2);
  const t2 = studentReady(g, '샘플고A', '가상학생01'); // 2학년
  const t1 = studentReady(g, '샘플고A', '가상학생11'); // 1학년
  const ids2 = ok(g.call('studentHome', { token: t2 })).sets.map((x) => x.setId);
  const ids1 = ok(g.call('studentHome', { token: t1 })).sets.map((x) => x.setId);
  assert.ok(ids2.includes('MOCK-A2') && ids2.includes('MOCK-A'));
  assert.ok(!ids1.includes('MOCK-A2') && ids1.includes('MOCK-A'));
  fail(g.call('getSet', { token: t1, setId: 'MOCK-A2' }), 'NO_SET');
  const home = ok(g.call('studentHome', { token: t2 }));
  assert.strictEqual(home.sets.find((x) => x.setId === 'MOCK-A2').kind, '모의평가');
  assert.strictEqual(home.sets.find((x) => x.setId === 'DEMO-A-1').kind, '내신');
});

test('모의평가: 배점이 소수여도 100점 환산, 서술형 없이 객관식만', () => {
  const g = fresh();
  addMock(g, 'MOCK-A', '[가짜] 모의평가 1회', 1);
  const t = studentReady(g, '샘플고A', '가상학생01');
  const r = ok(g.call('submit', { token: t, setId: 'MOCK-A', answers: { 1: [2], 2: [4], 3: [5] } }));
  assert.strictEqual(r.result.score, 73); // (3.2 + 4.1) / 10 = 73%
});

test('누적 리포트: 내신과 모의평가를 따로, 모의평가는 N회', () => {
  const g = fresh({ now: '2026-11-03T18:00:00+09:00' });
  addMock(g, 'MOCK-A1', '[가짜] 모의평가 1회', 1);
  addMock(g, 'MOCK-A2', '[가짜] 모의평가 2회', 2);
  const t = studentReady(g, '샘플고A', '가상학생01');
  ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: KEY_A }));                       // 내신 1주차 100
  ok(g.call('submit', { token: t, setId: 'MOCK-A1', answers: { 1: [2], 2: [4], 3: [1] } }));    // 모의 1회 100
  ok(g.call('submit', { token: t, setId: 'MOCK-A2', answers: { 1: [2] } }));                    // 모의 2회 32
  const tt = teacherReady(g);
  const n = ok(g.call('teacherTrend', { token: tt }));
  assert.strictEqual(n.kind, '내신');
  assert.deepStrictEqual(n.weeks.map((w) => w.label), ['1주차']);
  assert.strictEqual(n.students[0].submitted, 1);
  const m = ok(g.call('teacherTrend', { token: tt, kind: '모의평가' }));
  assert.strictEqual(m.kind, '모의평가');
  assert.deepStrictEqual(m.weeks.map((w) => [w.label, w.avg]), [['1회', 100], ['2회', 32]]);
  assert.strictEqual(m.students[0].submitted, 2);
  // 학생 추이: 내신은 주차, 모의평가는 회차로 따로
  const my = ok(g.call('myTrend', { token: t }));
  assert.deepStrictEqual(my.weeks.map((w) => [w.label, w.score]), [['1주차', 100]]);
  assert.deepStrictEqual(my.mock.weeks.map((w) => [w.label, w.score]), [['1회', 100], ['2회', 32]]);
  assert.strictEqual(my.mock.avg, 66);
  // 오늘 결과에 종류 표시
  const today = ok(g.call('teacherToday', { token: tt }));
  assert.deepStrictEqual(today.sets.map((x) => x.kind).sort(), ['내신', '모의평가', '모의평가']);
});

test('종류·학년 칸이 없는 시트: 전부 내신, 학년 거르기 없음', () => {
  const g = fresh();
  const sh = g.sheet('세트');
  ['종류', '학년'].forEach((h) => { const c = sh.data[0].indexOf(h); sh.data.forEach((row) => { row[c] = ''; }); });
  const t = studentReady(g, '샘플고A', '가상학생01');
  const home = ok(g.call('studentHome', { token: t }));
  assert.ok(home.sets.every((x) => x.kind === '내신'));
  ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: KEY_A }));
  ok(g.call('teacherTrend', { token: teacherReady(g) }));
});

/* ── 학부모 화면 (v1.5.0) ── */

function parentCodes(g, names) {
  const rows = g.sheet('학생').objects().filter((x) => names.includes(x.이름)).map((x) => x._row);
  return Object.fromEntries(Array.from(g.ctx.setParentCodes_(rows)).map((x) => [x.name, x.code]));
}
function parentReady(g, school, name, code, pw = 'parent123') {
  const r = ok(g.call('parentLogin', { school, name, password: code }), '학부모 첫 로그인');
  assert.strictEqual(r.mustChange, true);
  ok(g.call('parentChangePassword', { token: r.token, currentPassword: code, newPassword: pw }), '학부모 비번 변경');
  return ok(g.call('parentLogin', { school, name, password: pw })).token;
}

test('시트 탭 만들기: 학생 탭에 학부모 칸이 생긴다', () => {
  const g = loadGas();
  g.ctx.setupSheets_();
  const h = g.sheet('학생').data[0];
  ['학부모비밀번호해시', '학부모솔트', '학부모실패횟수', '학부모잠금해제시각', '학부모초기'].forEach((x) => assert.ok(h.includes(x), x));
});

test('학부모: 초기 비밀번호 전에는 못 들어오고, 0000도 안 됨', () => {
  const g = fresh();
  fail(g.call('parentLogin', { school: '샘플고A', name: '가상학생01', password: '0000' }), 'NO_PARENT_PW');
});

test('학부모: 초기 번호는 6자리, 시트엔 해시만, 첫 로그인 때 바꿔야 함', () => {
  const g = fresh();
  const codes = parentCodes(g, ['가상학생01', '가상학생02']);
  assert.ok(/^\d{6}$/.test(codes['가상학생01']));
  assert.notStrictEqual(codes['가상학생01'], codes['가상학생02']);
  const sheetText = JSON.stringify(g.sheet('학생').data);
  assert.ok(!sheetText.includes(codes['가상학생01']), '시트에 초기 번호 원문이 없어야 함');
  const rec = g.sheet('학생').objects().find((x) => x.이름 === '가상학생01');
  assert.ok(/^[0-9a-f]{64}$/.test(rec.학부모비밀번호해시));
  assert.strictEqual(rec.학부모초기, 'Y');
  const r = ok(g.call('parentLogin', { school: '샘플고A', name: '가상학생01', password: codes['가상학생01'] }));
  fail(g.call('parentReport', { token: r.token }), 'MUST_CHANGE');
  fail(g.call('parentChangePassword', { token: r.token, currentPassword: codes['가상학생01'], newPassword: '12345' }));
  fail(g.call('parentChangePassword', { token: r.token, currentPassword: codes['가상학생01'], newPassword: codes['가상학생01'] }));
  ok(g.call('parentChangePassword', { token: r.token, currentPassword: codes['가상학생01'], newPassword: 'parent123' }));
  ok(g.call('parentReport', { token: r.token }));
  fail(g.call('parentLogin', { school: '샘플고A', name: '가상학생01', password: codes['가상학생01'] }), 'BADPW');
  const rec2 = g.sheet('학생').objects().find((x) => x.이름 === '가상학생01');
  assert.strictEqual(rec2.학부모초기, '');
  assert.ok(!JSON.stringify(g.sheet('학생').data).includes('parent123'));
});

test('학부모·학생 계정은 서로 섞이지 않음', () => {
  const g = fresh();
  const codes = parentCodes(g, ['가상학생01']);
  const ts = studentReady(g, '샘플고A', '가상학생01', 'stud11');
  fail(g.call('parentLogin', { school: '샘플고A', name: '가상학생01', password: 'stud11' }), 'BADPW');
  const tp = parentReady(g, '샘플고A', '가상학생01', codes['가상학생01']);
  fail(g.call('studentLogin', { school: '샘플고A', name: '가상학생01', password: 'parent123' }), 'BADPW');
  fail(g.call('parentReport', { token: ts }), 'AUTH');
  fail(g.call('studentHome', { token: tp }), 'AUTH');
  fail(g.call('teacherToday', { token: tp }), 'AUTH');
});

test('학부모: 5번 틀리면 잠금, 메뉴로 잠금 풀기', () => {
  const g = fresh();
  const codes = parentCodes(g, ['가상학생01']);
  for (let i = 0; i < 4; i++) fail(g.call('parentLogin', { school: '샘플고A', name: '가상학생01', password: '999999' }), 'BADPW');
  fail(g.call('parentLogin', { school: '샘플고A', name: '가상학생01', password: '999999' }), 'LOCKED');
  fail(g.call('parentLogin', { school: '샘플고A', name: '가상학생01', password: codes['가상학생01'] }), 'LOCKED');
  const row = g.sheet('학생').objects().find((x) => x.이름 === '가상학생01')._row;
  g.ctx.unlockParentRows_([row]);
  ok(g.call('parentLogin', { school: '샘플고A', name: '가상학생01', password: codes['가상학생01'] }));
});

test('학부모 리포트: 자기 아이 것만, 비공개 세트도 보이고, 다른 학생은 반 평균으로만', () => {
  const g = fresh({ now: '2026-11-03T18:00:00+09:00' });
  addSet2(g);
  addMock(g, 'MOCK-A1', '[가짜] 모의평가 1회', 1);
  setCell(g, 'DEMO-A-2', '결과공개', ''); // 학생에게 비공개
  const t1 = studentReady(g, '샘플고A', '가상학생01');
  const t2 = studentReady(g, '샘플고A', '가상학생02');
  ok(g.call('submit', { token: t1, setId: 'DEMO-A-1', answers: KEY_A }));                                 // 100
  ok(g.call('submit', { token: t2, setId: 'DEMO-A-1', answers: Object.assign({}, KEY_A, { 1: [1], 2: [2], 3: [] }) })); // 75
  g.advance(7 * 86400000);
  ok(g.call('submit', { token: t1, setId: 'DEMO-A-2', answers: { 1: [1], 2: [2], 3: [3], 4: [1] } }));  // 75 (비공개)
  ok(g.call('submit', { token: t1, setId: 'MOCK-A1', answers: { 1: [2], 2: [4], 3: [1] } }));            // 100
  const codes = parentCodes(g, ['가상학생01']);
  const tp = parentReady(g, '샘플고A', '가상학생01', codes['가상학생01']);
  const r = ok(g.call('parentReport', { token: tp }));
  assert.strictEqual(r.name, '가상학생01');
  assert.ok(!JSON.stringify(r).includes('가상학생02'), '다른 학생 이름이 있으면 안 됨');
  assert.strictEqual(r.submitted, 3);
  assert.deepStrictEqual(r.recent.map((x) => x.title).slice(0, 2).sort(), ['[가짜] 2주차 점검', '[가짜] 모의평가 1회']);
  assert.strictEqual(r.recent[2].title, '[가짜] 고전시가 확인 테스트', '최근 것부터');
  const a1 = r.recent.find((x) => x.title === '[가짜] 고전시가 확인 테스트');
  assert.deepStrictEqual([a1.score, a1.classAvg, a1.classN], [100, null, null], '2명뿐이면 반 평균을 숨김(다른 아이 점수 역산 방지)');
  const a2 = r.recent.find((x) => x.title === '[가짜] 2주차 점검');
  assert.deepStrictEqual([a2.score, a2.wrong], [75, [4]], '비공개 세트도 학부모에게는 보임');
  assert.deepStrictEqual(r.naesin.weeks.map((w) => [w.label, w.score, w.classAvg]), [['1주차', 100, null], ['2주차', 75, null]]);
  assert.deepStrictEqual(r.mock.weeks.map((w) => [w.label, w.score]), [['1회', 100]]);
  assert.ok(Array.isArray(r.weak));
});

test('학부모 리포트: 반 평균은 3명 이상 냈을 때만', () => {
  const g = fresh({ now: '2026-11-03T18:00:00+09:00' });
  const ans = [KEY_A, Object.assign({}, KEY_A, { 1: [1], 2: [2], 3: [] }), Object.assign({}, KEY_A, { 1: [1] })]; // 100, 25, 75
  const scores = ['가상학생01', '가상학생02', '가상학생03'].map((n, i) => ok(g.call('submit', { token: studentReady(g, '샘플고A', n), setId: 'DEMO-A-1', answers: ans[i] })).result.score);
  const codes = parentCodes(g, ['가상학생01']);
  const r = ok(g.call('parentReport', { token: parentReady(g, '샘플고A', '가상학생01', codes['가상학생01']) }));
  const a = r.recent[0];
  assert.deepStrictEqual([a.score, a.classN], [100, 3]);
  assert.strictEqual(a.classAvg, Math.round((scores.reduce((x, y) => x + y, 0) / 3) * 10) / 10, JSON.stringify({ scores, a }));
  assert.strictEqual(r.naesin.weeks[0].classAvg, a.classAvg, '주차 반 평균도 3명이면 보임');
  assert.ok(!JSON.stringify(r).includes('가상학생02') && !JSON.stringify(r).includes('가상학생03'));
});

test('평가 점수: 학부모 비밀번호를 만든 학생만 parent 표시 (v1.5.0)', () => {
  const g = fresh();
  const t1 = studentReady(g, '샘플고A', '가상학생01');
  const t2 = studentReady(g, '샘플고A', '가상학생02');
  ok(g.call('submit', { token: t1, setId: 'DEMO-A-1', answers: KEY_A }));
  ok(g.call('submit', { token: t2, setId: 'DEMO-A-1', answers: KEY_A }));
  parentCodes(g, ['가상학생01']);
  const r = ok(g.call('teacherEval', { token: teacherReady(g) }));
  assert.deepStrictEqual(r.students.map((x) => [x.name, x.parent]).sort(), [['가상학생01', true], ['가상학생02', false]]);
});

test('학부모 칸이 없는 예전 시트: 학부모 로그인은 안내, 다른 기능은 그대로', () => {
  const g = fresh();
  const sh = g.sheet('학생');
  ['학부모비밀번호해시', '학부모솔트', '학부모실패횟수', '학부모잠금해제시각', '학부모초기'].forEach((h) => { const c = sh.data[0].indexOf(h); sh.data.forEach((row) => { row[c] = ''; }); });
  fail(g.call('parentLogin', { school: '샘플고A', name: '가상학생01', password: '123456' }), 'SETUP');
  const t = studentReady(g, '샘플고A', '가상학생01');
  ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: KEY_A }));
  assert.strictEqual(ok(g.call('teacherEval', { token: teacherReady(g) })).students[0].parent, false);
});

/* ── 서답형 합산 (v1.6.0) ── */

// 객관식 4문항(각 20점, 합 80) + 서답형 5문항(각 4점, 합 20). 결과공개 Y여도 학생에게는 비공개여야 함
function addEssaySet(g, extra) {
  g.sheet('세트').addRow(Object.assign({ 세트ID: 'ESS 1', 세트이름: '[가짜] 서답형 포함 모의평가', 학교: '샘플고A', 사용: 'Y', 주차: 1, 결과공개: 'Y', 종류: '모의평가', 서답형배점: '4,4,4,4,4' }, extra || {}));
  [1, 2, 3, 4].forEach((k) => g.sheet('문항').addRow({ 세트ID: 'ESS 1', 번호: k, 정답: String(k), 배점: 20, 단원: '문법', 세부항목: '음운 변동' }));
}
const ESS_KEY = { 1: [1], 2: [2], 3: [3], 4: [4] };
function essayRowsFor(g) { return g.sheet('서답형').objects().filter((x) => x.세트ID); }
function setEssay(g, name, scores) {
  const sh = g.sheet('서답형');
  const row = sh.objects().find((x) => x.이름 === name);
  scores.forEach((v, i) => sh.setCell(row._row, sh.data[0].indexOf('서답형' + (i + 1)) + 1, v));
}
function setRowOf(g, id) { return g.sheet('세트').objects().find((x) => x.세트ID === id)._row; }

test('서답형배점 읽기', () => {
  const g = fresh();
  const p = g.ctx.parseEssayPoints_;
  assert.strictEqual(p(''), null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p('4,4,4,4,4'))), { points: [4, 4, 4, 4, 4], max: 20 });
  assert.strictEqual(p('4.6, 3.1, 4.6, 4.6, 3.1').max, 20);
  assert.strictEqual(p('20').max, 20);
  assert.ok(p(44444).error, '쉼표가 사라져 숫자가 된 경우');
  assert.ok(p('4,-1').error);
  assert.ok(p('4,abc').error);
  assert.ok(p('60,40').error, '합계 100 이상');
});

test('서답형 세트: 결과공개 Y여도 학생에게는 점수 비공개, 다른 세트는 그대로', () => {
  const g = fresh();
  addEssaySet(g);
  const t = studentReady(g, '샘플고A', '가상학생01');
  const r = ok(g.call('submit', { token: t, setId: 'ESS 1', answers: ESS_KEY }));
  assert.strictEqual(r.revealed, false);
  assert.ok(!('result' in r) || r.result == null);
  const home = ok(g.call('studentHome', { token: t }));
  const e = home.sets.find((x) => x.setId === 'ESS1');
  assert.deepStrictEqual([e.revealed, e.score], [false, null]);
  const pub = ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: KEY_A }));
  assert.strictEqual(pub.result.score, 100, '서답형 없는 세트는 예전처럼 공개');
  const tr = ok(g.call('myTrend', { token: t }));
  assert.ok(!JSON.stringify(tr.mock).includes('ESS'), '학생 성적 추이에도 안 들어감');
});

test('서답형 입력표 만들기: 제출한 학생 줄과 객관식 점수, 다시 눌러도 중복 없음·적은 점수 그대로', () => {
  const g = fresh({ now: '2026-11-12T18:00:00+09:00' });
  addEssaySet(g);
  ok(g.call('submit', { token: studentReady(g, '샘플고A', '가상학생01'), setId: 'ESS 1', answers: ESS_KEY }));                       // 80
  ok(g.call('submit', { token: studentReady(g, '샘플고A', '가상학생02'), setId: 'ESS 1', answers: { 1: [1], 2: [2], 3: [5], 4: [] } })); // 40
  const res = g.ctx.makeEssayRows_([setRowOf(g, 'ESS 1')]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res)), [{ title: '[가짜] 서답형 포함 모의평가', added: 2, kept: 0, count: 5, max: 20, mcqMax: 80 }]);
  let rows = essayRowsFor(g);
  assert.deepStrictEqual(rows.map((x) => [x.세트ID, x.이름, x.학교, x.객관식]).sort(), [['ESS 1', '가상학생01', '샘플고A', 80], ['ESS 1', '가상학생02', '샘플고A', 40]]);
  const sh = g.sheet('서답형');
  const f = Object.values(sh.formulas);
  assert.ok(f.some((x) => /^=IF\(COUNT\(F\d,G\d,H\d,I\d,J\d\)<5,"",ROUND\(E\d\+SUM/.test(x)), '합계 수식: ' + f.join(' | '));
  setEssay(g, '가상학생01', [4, 3, 4, 2, 4]);
  ok(g.call('submit', { token: studentReady(g, '샘플고A', '가상학생03'), setId: 'ESS 1', answers: ESS_KEY }));
  const again = g.ctx.makeEssayRows_([setRowOf(g, 'ESS 1')]);
  assert.deepStrictEqual([again[0].added, again[0].kept], [1, 2]);
  rows = essayRowsFor(g);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows.find((x) => x.이름 === '가상학생01').서답형2, 3, '적어 둔 점수는 그대로');
  const none = g.ctx.makeEssayRows_([setRowOf(g, 'DEMO-A-1')]);
  assert.ok(none[0].error.includes('서답형배점'));
});

test('서답형 합계: 다 채우면 객관식+서답형, 덜 채웠거나 만점보다 크면 채점 전', () => {
  const g = fresh({ now: '2026-11-12T18:00:00+09:00' });
  addEssaySet(g);
  ['가상학생01', '가상학생02', '가상학생03', '가상학생04'].forEach((n, i) => {
    const answers = [ESS_KEY, { 1: [1], 2: [2], 3: [5], 4: [] }, { 1: [1], 2: [2], 3: [3], 4: [1] }, ESS_KEY][i];
    ok(g.call('submit', { token: studentReady(g, '샘플고A', n), setId: 'ESS 1', answers }));
  });
  g.ctx.makeEssayRows_([setRowOf(g, 'ESS 1')]);
  setEssay(g, '가상학생01', [4, 3, 4, 2, 4]);      // 17 → 97
  setEssay(g, '가상학생02', [2, 0, 1.5, 0, 4]);    // 7.5 → 47.5
  setEssay(g, '가상학생03', [4, 4, '', 4, 4]);     // 비어 있음 → 채점 전
  setEssay(g, '가상학생04', [4, 6, 4, 4, 4]);      // 6 > 4 → 확인 필요
  const tt = teacherReady(g);
  const today = ok(g.call('teacherToday', { token: tt }));
  const set = today.sets.find((x) => x.setId === 'ESS1');
  assert.strictEqual(set.reveal, false);
  const by = Object.fromEntries(set.rows.map((x) => [x.name, x.essay]));
  assert.deepStrictEqual([by.가상학생01.mcq, by.가상학생01.essay, by.가상학생01.total, by.가상학생01.done], [80, 17, 97, true]);
  assert.deepStrictEqual([by.가상학생02.total, by.가상학생03.done, by.가상학생03.total], [47.5, false, null]);
  assert.deepStrictEqual([by.가상학생04.done, by.가상학생04.bad], [false, [2]]);
  assert.deepStrictEqual(set.rows.map((x) => x.name), ['가상학생01', '가상학생02', '가상학생04', '가상학생03'], '합계 난 학생 먼저, 그다음 객관식 순');
  assert.deepStrictEqual([set.essay.max, set.essay.mcqMax, set.essay.graded, set.essay.totalAvg, set.essay.bad], [20, 80, 2, 72.3, ['가상학생04']]);
  assert.strictEqual(set.essay.mcqAvg, 65);

  const ev = ok(g.call('teacherEval', { token: tt }));
  const e1 = ev.students.find((x) => x.name === '가상학생01').essays[0];
  assert.deepStrictEqual([e1.mcq, e1.mcqMax, e1.essay, e1.essayMax, e1.total, e1.done], [80, 80, 17, 20, 97, true]);
  assert.strictEqual(ev.students.find((x) => x.name === '가상학생03').essays[0].done, false);

  const trend = ok(g.call('teacherTrend', { token: tt, school: '샘플고A', kind: '모의평가' }));
  const w = (n) => (trend.students.find((x) => x.name === n).weeks[1] || {}).score;
  assert.deepStrictEqual([w('가상학생01'), w('가상학생02'), w('가상학생03'), w('가상학생04')], [97, 47.5, undefined, undefined]);
  assert.deepStrictEqual(trend.pendingEssay.map((x) => [x.title, x.n]), [['[가짜] 서답형 포함 모의평가', 2]]);
  assert.ok(trend.students.find((x) => x.name === '가상학생03').tags.length, '채점 전이어도 세부항목은 객관식으로 집계');
});

test('학부모 리포트: 서답형 세트는 합계, 채점 전이면 표시만 하고 추세·반 평균에서 뺌', () => {
  const g = fresh({ now: '2026-11-12T18:00:00+09:00' });
  addEssaySet(g);
  ['가상학생01', '가상학생02', '가상학생03'].forEach((n) => ok(g.call('submit', { token: studentReady(g, '샘플고A', n), setId: 'ESS 1', answers: ESS_KEY })));
  g.ctx.makeEssayRows_([setRowOf(g, 'ESS 1')]);
  const codes = parentCodes(g, ['가상학생01']);
  const tp = parentReady(g, '샘플고A', '가상학생01', codes['가상학생01']);
  let r = ok(g.call('parentReport', { token: tp }));
  let a = r.recent[0];
  assert.deepStrictEqual([a.score, a.essay.mcq, a.essay.mcqMax, a.essay.done, a.classAvg], [null, 80, 80, false, null]);
  assert.deepStrictEqual(r.mock.weeks, [], '채점 전이면 회차 점수에 안 들어감');
  assert.ok(r.tags.length, '세부항목은 들어감');
  setEssay(g, '가상학생01', [4, 4, 4, 4, 4]);
  setEssay(g, '가상학생02', [2, 2, 2, 2, 2]);
  r = ok(g.call('parentReport', { token: tp }));
  a = r.recent[0];
  assert.deepStrictEqual([a.score, a.essay.essay, a.essay.done, a.classAvg], [100, 20, true, null], '채점된 학생이 2명이면 반 평균 숨김');
  setEssay(g, '가상학생03', [0, 0, 0, 0, 0]);
  r = ok(g.call('parentReport', { token: tp }));
  a = r.recent[0];
  assert.deepStrictEqual([a.score, a.classAvg, a.classN], [100, 90, 3]);
  assert.deepStrictEqual(r.mock.weeks.map((x) => [x.label, x.score, x.classAvg]), [['1회', 100, 90]]);
  assert.ok(!JSON.stringify(r).includes('가상학생02'));
});

test('서답형 탭에 학생ID 없이 이름·학교만 적어도 맞춰짐', () => {
  const g = fresh();
  addEssaySet(g);
  ok(g.call('submit', { token: studentReady(g, '샘플고A', '가상학생01'), setId: 'ESS 1', answers: ESS_KEY }));
  g.ctx.setupSheets_();
  g.sheet('서답형').addRow({ 세트ID: 'ESS 1', 이름: '가상학생01', 학교: '샘플고A', 서답형1: 1, 서답형2: 1, 서답형3: 1, 서답형4: 1, 서답형5: 1 });
  const today = ok(g.call('teacherToday', { token: teacherReady(g) }));
  assert.strictEqual(today.sets.find((x) => x.setId === 'ESS1').rows[0].essay.total, 85);
});

test('서답형배점이 잘못되면 학생에게 안 보이고 선생님 화면에 안내', () => {
  const g = fresh();
  addEssaySet(g, { 서답형배점: '60,50' });
  const home = ok(g.call('studentHome', { token: studentReady(g, '샘플고A', '가상학생01') }));
  assert.ok(!home.sets.some((x) => x.setId === 'ESS1'));
  const today = ok(g.call('teacherToday', { token: teacherReady(g) }));
  assert.ok(today.warnings.some((x) => x.setId === 'ESS1' && x.problem.includes('서답형배점')));
});

test('서답형 탭이 없는 예전 시트에서도 다른 기능은 그대로', () => {
  const g = fresh();
  g.ss.deleteSheet(g.sheet('서답형'));
  const t = studentReady(g, '샘플고A', '가상학생01');
  ok(g.call('submit', { token: t, setId: 'DEMO-A-1', answers: KEY_A }));
  const tt = teacherReady(g);
  ok(g.call('teacherToday', { token: tt }));
  ok(g.call('teacherTrend', { token: tt, school: '샘플고A' }));
  ok(g.call('teacherEval', { token: tt }));
  addEssaySet(g);
  ok(g.call('submit', { token: t, setId: 'ESS 1', answers: ESS_KEY }));
  const res = g.ctx.makeEssayRows_([setRowOf(g, 'ESS 1')]);
  assert.strictEqual(res[0].added, 1, '메뉴가 서답형 탭을 만듦');
  assert.ok(g.sheet('서답형'));
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
