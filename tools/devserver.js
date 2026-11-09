// 화면 확인용 로컬 서버: 진짜 Code.gs를 가짜 시트 위에서 돌립니다. (가짜 자료만 사용)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadGas, seedFake } = require('../test/gas-mock');

function makeDemo() {
  const g = loadGas({ now: '2026-11-07T17:40:00+09:00' });
  seedFake(g);
  const key = { 1: [3], 2: [2, 4], 3: [1], 4: [5], 5: [4], 6: [2], 7: [1, 3], 8: [3], 9: [5], 10: [2], 11: [4], 12: [1] };
  const plan = [
    ['샘플고A', '가상학생01', 'DEMO-A-1', { 7: [1] }],
    ['샘플고A', '가상학생02', 'DEMO-A-1', { 2: [2], 7: [3], 11: [] }],
    ['샘플고A', '가상학생03', 'DEMO-A-1', { 2: [4], 11: [2] }],
    ['샘플고A', '가상학생04', 'DEMO-A-1', { 2: [2, 4, 5], 7: [1], 9: [3] }],
  ];
  const keyB = { 1: [2], 2: [4], 3: [1], 4: [3], 5: [5], 6: [2], 7: [3], 8: [1], 9: [4], 10: [2] };
  const planB = [
    ['샘플고B', '가상학생07', 'DEMO-B-1', { 4: [2], 9: [1] }],
    ['샘플고B', '가상학생08', 'DEMO-B-1', { 9: [3] }],
  ];
  const run = (school, name, setId, base, diff) => {
    const r = g.call('studentLogin', { school, name, password: '0000' });
    g.call('changePassword', { token: r.token, currentPassword: '0000', newPassword: 'demo1234' });
    g.call('submit', { token: r.token, setId, answers: Object.assign({}, base, diff) });
    g.advance(3 * 60000 + 17000);
  };
  plan.forEach(([s, n, id, d]) => run(s, n, id, key, d));
  planB.forEach(([s, n, id, d]) => run(s, n, id, keyB, d));
  g.ctx.setTeacherPassword_('demo-teacher');
  return g;
}

function start(port = 8765) {
  const g = makeDemo();
  const webDir = path.join(__dirname, '..');
  const PUBLIC = ['/index.html', '/teacher.html'];
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
