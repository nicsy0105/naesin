// 화면 테스트 + 캡처: 학생이 로그인→비번 변경→OMR 제출→결과, 선생님이 오늘 결과 확인
const assert = require('assert');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { start } = require('./devserver');

(async () => {
  const { server, url } = await start();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
    const page = await ctx.newPage(); watch(page);
    await page.goto(url + '/index.html');
    await page.waitForSelector('#school option[value="샘플고A"]', { state: 'attached' });
    await page.selectOption('#school', '샘플고A');
    await page.fill('#name', '가상학생05');
    await page.fill('#pw', '0000');
    await page.screenshot({ path: 'shots/s1-login.png' });

    // 틀린 비밀번호 먼저 → 오류 문구 확인
    await page.fill('#pw', '1111');
    await page.click('button[type=submit]');
    await page.waitForSelector('.error:has-text("틀렸어요")');
    await page.fill('#pw', '0000');
    await page.click('button[type=submit]');
    await page.waitForSelector('#np');
    await page.fill('#np', 'myNewPw1'); await page.fill('#np2', 'myNewPw1');
    await page.screenshot({ path: 'shots/s2-changepw.png' });
    await page.click('button[type=submit]');
    await page.waitForSelector('.set');
    await page.screenshot({ path: 'shots/s3-home.png' });
    const titles = await page.$$eval('.set-title', (n) => n.map((x) => x.textContent));
    assert.deepStrictEqual(titles.sort(), ['[가짜] 고전시가 확인 테스트', '[가짜] 공통 어휘 점검']);

    await page.click('.set:has-text("고전시가") button');
    await page.waitForSelector('.omr-row');
    const marks = { 1: [3], 2: [2, 4], 3: [1], 4: [5], 5: [4], 6: [2], 7: [1], 8: [3], 9: [5], 10: [2], 11: [4] };
    for (const [no, cs] of Object.entries(marks)) for (const c of cs) await page.click(`button[aria-label="${no}번 문항 ${c}번"]`);
    // 잘못 칠했다 지우기
    await page.click('button[aria-label="3번 문항 4번"]');
    await page.click('button[aria-label="3번 문항 4번"]');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'shots/s4-omr.png' });
    assert.strictEqual(await page.textContent('.progress'), '표시 11 / 12');

    // 새로고침해도 칠한 답이 남는지
    await page.reload();
    await page.waitForSelector('.set');
    await page.click('.set:has-text("고전시가") button');
    await page.waitForSelector('.omr-row');
    assert.strictEqual(await page.textContent('.progress'), '표시 11 / 12');

    await page.click('.bottom .btn');
    await page.waitForSelector('.sheet');
    assert.ok((await page.textContent('.sheet')).includes('비운 문항 12번'));
    await page.screenshot({ path: 'shots/s5-confirm.png' });
    await page.click('.sheet .btn:not(.ghost)');
    await page.waitForSelector('.result-card');
    await page.screenshot({ path: 'shots/s6-result.png' });
    assert.ok((await page.textContent('.big')).startsWith('83.3'));
    assert.deepStrictEqual(await page.$$eval('.chip', (n) => n.map((x) => x.firstChild.textContent)), ['7', '12']);

    await page.click('text=목록으로');
    await page.waitForSelector('.set.done');
    assert.ok((await page.textContent('.set.done')).includes('83.3'));

    // 선생님
    const tctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5, locale: 'ko-KR' });
    const tp = await tctx.newPage(); watch(tp);
    await tp.goto(url + '/teacher.html');
    await tp.fill('input[type=password]', 'nope');
    await tp.click('button[type=submit]');
    await tp.waitForSelector('.error:has-text("틀렸어요")');
    await tp.fill('input[type=password]', 'demo-teacher');
    await tp.click('button[type=submit]');
    await tp.waitForSelector('section.set');
    await tp.screenshot({ path: 'shots/t1-today.png', fullPage: true });
    const setTitles = await tp.$$eval('section.set h2', (n) => n.map((x) => x.textContent));
    assert.deepStrictEqual(setTitles, ['[가짜] 고전시가 확인 테스트', '[가짜] 현대소설 확인 테스트']);
    const firstNames = await tp.$$eval('section.set:first-of-type tbody td:first-child', (n) => n.map((x) => x.textContent));
    assert.strictEqual(firstNames.length, 5);
    assert.ok((await tp.textContent('section.set:first-of-type .missing')).includes('가상학생06'));
    assert.ok((await tp.textContent('.warn')).includes('정답 빠진 세트'));

    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
    const mp = await mctx.newPage(); watch(mp);
    await mp.goto(url + '/teacher.html');
    await mp.fill('input[type=password]', 'demo-teacher');
    await mp.click('button[type=submit]');
    await mp.waitForSelector('section.set');
    await mp.screenshot({ path: 'shots/t2-today-phone.png', fullPage: true });

    assert.deepStrictEqual(errors, []);
    console.log('화면 테스트 통과');
  } catch (e) {
    console.error('화면 테스트 실패:', e.message, errors);
    for (const p of browser.contexts().flatMap((c) => c.pages())) { try { await p.screenshot({ path: 'shots/fail-' + Math.random().toString(36).slice(2, 6) + '.png' }); console.error('page text:', (await p.textContent('body')).slice(0, 400)); } catch (x) {} }
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
