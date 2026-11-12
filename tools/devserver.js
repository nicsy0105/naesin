// 화면 확인용 로컬 서버: 진짜 Code.gs를 가짜 시트 위에서 돌립니다. (가짜 자료만 사용)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadGas, seedFake } = require('../test/gas-mock');

function makeDemo() {
  const g = loadGas({ now: '2026-10-17T16:00:00+09:00' });
  seedFake(g);
  const at = (iso) => { g.clock.now = Date.parse(iso); };
  const tokens = {};
  const login = (school, name) => {
    if (tokens[name]) return tokens[name];
    const r = g.call('studentLogin', { school, name, password: '0000' });
    g.call('changePassword', { token: r.token, currentPassword: '0000', newPassword: 'demo1234' });
    return (tokens[name] = r.token);
  };
  const submit = (school, name, setId, answers) => {
    const r = g.call('submit', { token: login(school, name), setId, answers });
    if (!r.ok) throw new Error(name + ' ' + setId + ' ' + r.error);
    g.advance(2 * 60000 + 13000);
  };

  // 오늘 세트(DEMO-A-1)는 4주차로, 1~3주차 세트를 더 만든다 (모두 가짜)
  const setSheet = g.sheet('세트');
  const wcol = setSheet.data[0].indexOf('주차') + 1;
  setSheet.setCell(setSheet.objects().find((x) => x.세트ID === 'DEMO-A-1')._row, wcol, 4);
  // v1.2.0: 오늘 세트는 학생에게 점수 비공개(결과공개 칸 비움)
  setSheet.setCell(setSheet.objects().find((x) => x.세트ID === 'DEMO-A-1')._row, setSheet.data[0].indexOf('결과공개') + 1, '');
  const tagsA = ['표현상 특징', '화자의 태도', '시어의 의미', '외적 준거 감상'];
  const keys = {};
  [1, 2, 3].forEach((w) => {
    const id = 'DEMO-A-W' + w;
    setSheet.addRow({ 세트ID: id, 세트이름: `[가짜] ${w}주차 고전시가 점검`, 학교: '샘플고A', 사용: 'Y', 주차: w, 결과공개: 'Y' });
    keys[id] = [];
    for (let i = 1; i <= 10; i++) {
      const k = ((i * 7 + w * 3) % 5) + 1;
      keys[id].push(k);
      g.sheet('문항').addRow({ 세트ID: id, 번호: i, 정답: String(k), 단원: '고전시가', 세부항목: tagsA[(i - 1) % 4] });
    }
  });

  // 학생별 실력(가짜): 주차마다 조금씩 변함, 세부항목마다 차이
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const skill = {
    가상학생01: [0.82, 0.86, 0.9], 가상학생02: [0.5, 0.64, 0.8], 가상학생03: [0.72, 0.7, 0.74],
    가상학생04: [0.45, 0.5, 0.62], 가상학생06: [0.68, null, 0.75]
  };
  const tagPenalty = { '표현상 특징': 0, '화자의 태도': 0.05, '시어의 의미': 0.25, '외적 준거 감상': 0.12 };
  const dates = ['2026-10-17T16:00:00+09:00', '2026-10-24T16:00:00+09:00', '2026-10-31T16:00:00+09:00'];
  [1, 2, 3].forEach((w) => {
    at(dates[w - 1]);
    Object.entries(skill).forEach(([name, ps]) => {
      const p = ps[w - 1];
      if (p == null) return; // 그 주 결석
      const id = 'DEMO-A-W' + w;
      const answers = {};
      keys[id].forEach((k, i) => {
        const ok = rand() < p - tagPenalty[tagsA[i % 4]] + (name === '가상학생02' && i % 4 === 2 ? 0.2 * (w - 1) : 0);
        answers[i + 1] = [ok ? k : (k % 5) + 1];
      });
      submit('샘플고A', name, id, answers);
    });
  });
  at('2026-10-31T17:00:00+09:00');
  submit('샘플고A', '가상학생01', 'DEMO-ALL', { 1: [1], 2: [2], 3: [3], 4: [5], 5: [5] }); // 주차 없는 세트

  // v1.4.0: 학교별 기출 모의평가 (가짜, 2학년, 배점이 문항마다 다름)
  const mockPts = [3.2, 3.5, 4.1, 3.8, 4.4, 3.0, 3.6, 4.2, 3.9, 4.3, 3.3, 3.7, 4.0, 3.4, 4.5];
  const mockKeys = {};
  [1, 2, 3].forEach((n) => {
    const id = 'DEMO-A-MOCK' + n;
    setSheet.addRow({ 세트ID: id, 세트이름: `[가짜] 샘플고A 2학기 기출 모의평가 ${n}회`, 학교: '샘플고A', 학년: '2', 사용: 'Y', 주차: n, 결과공개: 'Y', 종류: '모의평가' });
    mockKeys[id] = mockPts.map((p, i) => ((i * 3 + n) % 5) + 1);
    mockPts.forEach((p, i) => g.sheet('문항').addRow({ 세트ID: id, 번호: i + 1, 정답: String(mockKeys[id][i]), 배점: p, 단원: i < 8 ? '고전시가' : '문법', 세부항목: i < 8 ? tagsA[i % 4] : (i % 2 ? '음운 변동' : '품사') }));
  });
  const mockSkill = { 가상학생01: [0.85, 0.9], 가상학생02: [0.55, 0.7], 가상학생03: [0.7, 0.66], 가상학생04: [0.5, 0.6] };
  [['2026-10-22T18:00:00+09:00', 1], ['2026-11-05T18:00:00+09:00', 2]].forEach(([d, n]) => {
    at(d);
    const id = 'DEMO-A-MOCK' + n;
    Object.entries(mockSkill).forEach(([name, ps]) => {
      const answers = {};
      mockKeys[id].forEach((k, i) => { answers[i + 1] = [rand() < ps[n - 1] ? k : (k % 5) + 1]; });
      submit('샘플고A', name, id, answers);
    });
  });

  // v1.6.0: 서답형이 있는 모의평가 (가짜). 객관식 21문항 80점 + 서답형 5문항 20점(4점씩)
  const essPts = [3.3, 3.3, 3.8, 3.8, 3.5, 3.2, 3.9, 3.9, 4.1, 4, 3.9, 4, 3.9, 4, 3.8, 3.9, 3.8, 4.1, 4, 3.9, 3.9];
  const essKeys = essPts.map((p, i) => ((i * 2 + 1) % 5) + 1);
  setSheet.addRow({ 세트ID: 'DEMO-A-ESSAY', 세트이름: '[가짜] 샘플고A 기말 3회 모의평가 (서답형 포함)', 학교: '샘플고A', 학년: '2', 사용: 'Y', 주차: 3, 결과공개: '', 종류: '모의평가', 서답형배점: '4,4,4,4,4' });
  essPts.forEach((p, i) => g.sheet('문항').addRow({ 세트ID: 'DEMO-A-ESSAY', 번호: i + 1, 정답: String(essKeys[i]), 배점: p, 단원: i < 15 ? '문법' : '문학', 세부항목: i < 15 ? ['음운 변동', '한글 맞춤법', '띄어쓰기'][i % 3] : ['표현상 특징', '서사 내용 이해'][i % 2] }));
  at('2026-11-06T18:00:00+09:00');
  const essSkill = { 가상학생01: 0.9, 가상학생02: 0.62, 가상학생03: 0.75, 가상학생04: 0.55 };
  Object.entries(essSkill).forEach(([name, p]) => {
    const answers = {};
    essKeys.forEach((k, i) => { answers[i + 1] = [rand() < p ? k : (k % 5) + 1]; });
    submit('샘플고A', name, 'DEMO-A-ESSAY', answers);
  });
  g.ctx.makeEssayRows_([setSheet.objects().find((x) => x.세트ID === 'DEMO-A-ESSAY')._row]);
  const essSheet = g.sheet('서답형');
  const essScores = { 가상학생01: [4, 3.5, 4, 3, 4], 가상학생02: [2, 1.5, 3, 0, 2], 가상학생03: [3, 4, 2.5, 3, 4], 가상학생04: [3, 5, 2, '', ''] }; // 04: 5점은 만점(4) 초과 → 확인 필요
  Object.entries(essScores).forEach(([name, sc]) => {
    const row = essSheet.objects().find((x) => x.이름 === name)._row;
    sc.forEach((v, i) => essSheet.setCell(row, essSheet.data[0].indexOf('서답형' + (i + 1)) + 1, v));
  });

  // 오늘(4주차) 제출
  at('2026-11-07T17:40:00+09:00');
  const key = { 1: [3], 2: [2, 4], 3: [1], 4: [5], 5: [4], 6: [2], 7: [1, 3], 8: [3], 9: [5], 10: [2], 11: [4], 12: [1] };
  [
    ['가상학생01', { 7: [1] }],
    ['가상학생02', { 2: [2], 7: [3], 11: [] }],
    ['가상학생03', { 2: [4], 11: [2] }],
    ['가상학생04', { 2: [2, 4, 5], 7: [1], 9: [3] }]
  ].forEach(([n, d]) => submit('샘플고A', n, 'DEMO-A-1', Object.assign({}, key, d)));
  const keyB = { 1: [2], 2: [4], 3: [1], 4: [3], 5: [5], 6: [2], 7: [3], 8: [1], 9: [4], 10: [2] };
  submit('샘플고B', '가상학생07', 'DEMO-B-1', Object.assign({}, keyB, { 4: [2], 9: [1] }));
  submit('샘플고B', '가상학생08', 'DEMO-B-1', Object.assign({}, keyB, { 9: [3] }));
  g.ctx.setTeacherPassword_('demo-teacher');

  // v1.5.0 학부모(가짜): 01은 선생님이 준 처음 번호 상태, 02는 이미 바꾼 상태
  const st = g.sheet('학생');
  const col = (h) => st.data[0].indexOf(h) + 1;
  const setParent = (name, pw, first) => {
    const row = st.objects().find((x) => x.이름 === name)._row;
    const salt = g.ctx.newSalt_();
    st.setCell(row, col('학부모솔트'), salt);
    st.setCell(row, col('학부모비밀번호해시'), g.ctx.hashPassword_(pw, salt));
    st.setCell(row, col('학부모초기'), first ? 'Y' : '');
  };
  setParent('가상학생01', DEMO_PARENT_CODE, true);
  setParent('가상학생02', DEMO_PARENT_PW, false);
  return g;
}
const DEMO_PARENT_CODE = '135790';      // 가짜 학부모 처음 번호
const DEMO_PARENT_PW = 'parent-demo';   // 가짜 학부모 비밀번호

function start(port = 8765) {
  const g = makeDemo();
  const webDir = path.join(__dirname, '..');
  const PUBLIC = ['/index.html', '/teacher.html', '/report.html', '/parent.html', '/fill.html', '/fill.js'];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        g.advance(20000);
        const out = g.ctx.doPost({ postData: { contents: body } }).getContent();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(out);
      });
      return;
    }
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    if (p === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(`window.APP_CONFIG = { API_URL: 'http://${req.headers.host}/api' };`);
    }
    if (p === '/mock-site.html') { // 맥가이7 출석입력 흉내 (테스트용)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(path.join(__dirname, 'mock-site.html')).pipe(res);
    }
    if (!PUBLIC.includes(p)) { res.writeHead(404); return res.end('not found'); }
    const f = path.join(webDir, p);
    const type = f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, g, url: `http://localhost:${port}` })));
}

module.exports = { start, DEMO_PARENT_CODE, DEMO_PARENT_PW };
if (require.main === module) start().then(({ url }) => console.log('dev server', url));
