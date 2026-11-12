// '평가 채우기' 버튼 테스트: 맥가이7 출석입력을 흉내 낸 가짜 페이지(다른 주소)에서 즐겨찾기 버튼을 누른 것처럼 실행
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { start } = require('./devserver');

(async () => {
  const { server, url } = await start(8781);
  const mock = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(__dirname, 'mock-site.html')).pipe(res);
  });
  await new Promise((r) => mock.listen(8782, r));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5, locale: 'ko-KR' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await p.goto(url + '/fill.html');
    await p.screenshot({ path: 'shots/f1-install.png', fullPage: true });
    const href = await p.getAttribute('#bm', 'href');
    assert.ok(href.startsWith('javascript:(function(){'));
    const code = href.slice('javascript:'.length);

    await p.goto('http://localhost:8782/'); // 다른 주소(교차 출처)에서 실행
    const before = await p.evaluate(() => dsLST1[1].CC_MEMO);
    await p.evaluate(code);
    await p.waitForSelector('#naesin-fill-panel input[type=password]');
    await p.fill('#naesin-fill-panel input[type=password]', 'wrong-pass');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => ((document.getElementById('naesin-fill-panel') || {}).textContent || '').includes('틀렸어요'));
    await p.fill('#naesin-fill-panel input[type=password]', 'demo-teacher');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => ((document.getElementById('naesin-fill-panel') || {}).textContent || '').includes('채움 ('));
    await p.screenshot({ path: 'shots/f2-filled.png', fullPage: true });

    const memo = await p.evaluate(() => Array.from({ length: dsLST1.length }, (_, i) => dsLST1[i + 1]));
    const m = (i) => memo[i].CC_MEMO;
    assert.ok(m(0).includes('- 총 11 / 12문항') && m(0).includes('- 고전시가 : 11 / 12'), m(0));
    assert.ok(m(0).includes('- 자습서 : 상') && m(0).includes('- 개념 복습 테스트 : \n'), '다른 줄은 그대로');
    const LINK = '\n\n■ 성적 리포트 (학부모 비밀번호로 보기)\n' + url + '/parent.html';
    assert.strictEqual(m(0), before.replace('- 총 / 12문항', '- 총 11 / 12문항').replace('- 고전시가 :  / 12', '- 고전시가 : 11 / 12').replace(/\n+$/, '') + LINK,
      '학부모 비밀번호가 있는 학생은 맨 끝에 리포트 링크 줄');
    assert.ok(m(1).includes('- 총 9 / 12문항') && m(1).endsWith(LINK));
    [2, 3, 5].forEach((i) => assert.ok(!m(i).includes('parent.html'), '학부모 비밀번호가 없으면 링크 줄 없음: ' + memo[i].M_NAME));
    assert.strictEqual(memo[1].CC_TEACHER, '1', '담당 선생님 칸이 비어 있으면 채움');
    assert.ok(m(2).includes('- 총 10 / 12문항') && m(2).includes('- 고전시가 : 10 / 12'));
    assert.ok(m(3).includes('- 총 / 15문항') && m(3).includes('- 고전시가 : 9 / 12'), '틀 문항 수가 다르면 총은 비워 둠');
    assert.ok(m(4).includes('- 총 / 12문항') && memo[4].status === '', '제출 없는 학생은 그대로');
    assert.ok(m(5).includes('- 총 8 / 10문항') && m(5).includes('- 현대소설 : 8 / 10'));
    const panel = await p.textContent('#naesin-fill-panel');
    assert.ok(panel.includes('가상학생06') && panel.includes('가상학생08'));
    assert.ok(panel.includes('틀은 15문항'));
    assert.ok(panel.includes('리포트 링크') && panel.includes('학부모 비밀번호 없음'));

    await p.click('text=저장');
    assert.strictEqual(await p.textContent('#saved'), '저장될 학생: 가상학생01, 가상학생02, 가상학생03, 가상학생04, 가상학생07');

    // 한 번 더 누르면: 비밀번호를 다시 묻지 않고, 이미 채운 줄은 건드리지 않음
    await p.evaluate(code);
    await p.waitForFunction(() => ((document.getElementById('naesin-fill-panel') || {}).textContent || '').includes('새로 채운 학생이 없어요'));
    const again = await p.evaluate(() => [dsLST1[1].CC_MEMO, dsLST1[2].CC_MEMO]);
    assert.deepStrictEqual(again, [m(0), m(1)], '링크 줄은 두 번 들어가지 않음');

    // v1.2.0: 서답형이 있는 모의평가 (2026-11-06) — 객관식·서답형·합계 줄
    await p.evaluate(() => {
      document.getElementById('txt_yyyymmdd').value = '2026-11-06';
      const T = '[샘플고A 기말 모의평가 결과]\n■ 모의평가 결과\n- 총 / 21문항\n- 문법 :  / 15\n- 문학 :  / 6\n- 객관식 :  / 80\n- 서답형 :  / 20\n- 합계 :  / 100\n';
      for (let i = 1; i <= dsLST1.length; i++) { dsLST1[i].CC_MEMO = T; dsLST1[i].status = ''; }
      render();
    });
    await p.evaluate(code);
    await p.waitForFunction(() => ((document.getElementById('naesin-fill-panel') || {}).textContent || '').includes('채움 ('));
    await p.screenshot({ path: 'shots/f3-filled-essay.png', fullPage: true });
    const em = await p.evaluate(() => Array.from({ length: dsLST1.length }, (_, i) => dsLST1[i + 1].CC_MEMO));
    assert.ok(em[0].includes('- 객관식 : 72.5 / 80') && em[0].includes('- 서답형 : 18.5 / 20') && em[0].includes('- 합계 : 91 / 100'), em[0]);
    assert.ok(/- 총 \d+ \/ 21문항/.test(em[0]) && /- 문법 : \d+ \/ 15/.test(em[0]) && /- 문학 : \d+ \/ 6/.test(em[0]), em[0]);
    assert.ok(em[0].endsWith(LINK) && em[1].endsWith(LINK), '리포트 링크 줄도 그대로 동작');
    assert.ok(em[3].includes('- 객관식 : 34.7 / 80') && em[3].includes('- 서답형 :  / 20') && em[3].includes('- 합계 :  / 100'), '서답형 채점 전이면 서답형·합계는 비워 둠: ' + em[3]);
    assert.ok((await p.textContent('#naesin-fill-panel')).includes('서답형 채점 전'));

    // 다른 화면에서 누르면 안내만
    await p.goto(url + '/teacher.html');
    await p.evaluate(code);
    await p.waitForFunction(() => ((document.getElementById('naesin-fill-panel') || {}).textContent || '').includes('출석입력'));

    assert.deepStrictEqual(errors, []);
    console.log('평가 채우기 테스트 통과');
  } catch (e) {
    console.error('평가 채우기 테스트 실패:', e.message, errors);
    process.exitCode = 1;
  } finally {
    await browser.close(); server.close(); mock.close();
  }
})();
