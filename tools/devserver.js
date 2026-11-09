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
  return g;
}

function start(port = 8765) {
  const g = makeDemo();
  const webDir = path.join(__dirname, '..');
  const PUBLIC = ['/index.html', '/teacher.html', '/report.html'];
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
      return res.end("window.APP_CONFIG = { API_URL: '/api' };");
    }
    if (!PUBLIC.includes(p)) { res.writeHead(404); return res.end('not found'); }
    const f = path.join(webDir, p);
    const type = f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, g, url: `http://localhost:${port}` })));
}

module.exports = { start };
if (require.main === module) start().then(({ url }) => console.log('dev server', url));
