// 화면 테스트 + 캡처: 학생이 로그인→비번 변경→OMR 제출→결과, 선생님이 오늘 결과 확인
const assert = require('assert');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { start, DEMO_PARENT_CODE } = require('./devserver');

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
    assert.deepStrictEqual(titles.sort(), ['[가짜] 1주차 고전시가 점검', '[가짜] 2주차 고전시가 점검', '[가짜] 3주차 고전시가 점검', '[가짜] 고전시가 확인 테스트', '[가짜] 공통 어휘 점검',
      '[가짜] 샘플고A 2학기 기출 모의평가 1회', '[가짜] 샘플고A 2학기 기출 모의평가 2회', '[가짜] 샘플고A 2학기 기출 모의평가 3회', '[가짜] 샘플고A 기말 3회 모의평가 (서답형 포함)']);
    assert.ok((await page.textContent('#app')).includes('풀 수 있는 모의평가'));

    await page.click('.set:has-text("고전시가 확인 테스트") button');
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
    await page.click('.set:has-text("고전시가 확인 테스트") button');
    await page.waitForSelector('.omr-row');
    assert.strictEqual(await page.textContent('.progress'), '표시 11 / 12');

    await page.click('.bottom .btn');
    await page.waitForSelector('.sheet');
    assert.ok((await page.textContent('.sheet')).includes('비운 문항 12번'));
    await page.screenshot({ path: 'shots/s5-confirm.png' });
    await page.click('.sheet .btn:not(.ghost)');
    // v1.2.0: 이 세트는 결과 비공개 → 제출 완료 + 내가 칠한 답
    await page.waitForSelector('.submitted-title');
    await page.screenshot({ path: 'shots/s6-submitted.png', fullPage: true });
    const subText = await page.textContent('#app');
    assert.ok(!subText.includes('83.3') && !subText.includes('틀린 문항'), '점수가 보이면 안 됨');
    const cells = await page.$$eval('.myans-cell', (n) => n.map((x) => x.textContent));
    assert.strictEqual(cells.length, 12);
    assert.deepStrictEqual([cells[1], cells[6], cells[11]], ['2②④', '7①', '12비움']);

    await page.click('text=목록으로');
    await page.waitForSelector('.set.done');
    const doneText = await page.textContent('.set.done');
    assert.ok(!doneText.includes('83.3') && doneText.includes('내 답'));
    await page.click('.set.done button');
    await page.waitForSelector('.submitted-title');
    await page.click('text=목록으로');
    await page.waitForSelector('.set');

    // 결과를 공개한 세트(공통 어휘)는 예전처럼 점수가 나옴
    await page.click('.set:has-text("공통 어휘 점검") button');
    await page.waitForSelector('.omr-row');
    for (const [no, c] of [[1, 1], [2, 2], [3, 3], [4, 1]]) await page.click(`button[aria-label="${no}번 문항 ${c}번"]`);
    await page.click('.bottom .btn');
    await page.waitForSelector('.sheet');
    await page.click('.sheet .btn:not(.ghost)');
    await page.waitForSelector('.result-card .big');
    assert.ok((await page.textContent('.big')).startsWith('60'));
    await page.screenshot({ path: 'shots/s6b-result-public.png' });
    await page.click('text=목록으로');
    await page.waitForSelector('.set.done');

    // 방금 낸 학생의 추이: 공개 세트만 (공통 어휘는 주차 없음 → 그래프 없음)
    await page.click('text=내 성적 추이 보기');
    await page.waitForSelector('h1:has-text("내 성적 추이")');
    assert.ok((await page.textContent('#app')).includes('공개하지 않은 테스트 1개'));

    // v1.1.0: 기록이 쌓인 학생의 추이 화면
    const sctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
    const sp = await sctx.newPage(); watch(sp);
    await sp.goto(url + '/index.html');
    await sp.waitForSelector('#school option[value="샘플고A"]', { state: 'attached' });
    await sp.selectOption('#school', '샘플고A');
    await sp.fill('#name', '가상학생02');
    await sp.fill('#pw', 'demo1234');
    await sp.click('button[type=submit]');
    await sp.waitForSelector('.set');
    await sp.screenshot({ path: 'shots/s7-home-with-trend-button.png', fullPage: true });
    await sp.click('text=내 성적 추이 보기');
    await sp.waitForSelector('.chart');
    await sp.screenshot({ path: 'shots/s8-trend.png', fullPage: true });
    const trendText = await sp.textContent('#app');
    assert.ok(trendText.includes('시어의 의미'));
    assert.ok(!trendText.includes('가상학생01'), '다른 학생 이름이 보이면 안 됨');
    assert.strictEqual(await sp.$$eval('.chart circle[r="4"]', (n) => n.length), 3 + 2); // 내신 3주 + 모의평가 2회
    assert.ok(trendText.includes('모의평가 회차별 점수'));
    assert.ok(trendText.includes('공개하지 않은 테스트 2개'), '서답형 세트도 학생에게는 비공개 (v1.6.0)');

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
    assert.ok((await tp.textContent('section.set:first-of-type .set-head')).includes('학생에게 점수 비공개'));
    const setTitles = await tp.$$eval('section.set h2', (n) => n.map((x) => x.textContent));
    assert.deepStrictEqual(setTitles, ['[가짜] 고전시가 확인 테스트', '[가짜] 현대소설 확인 테스트', '[가짜] 공통 어휘 점검']);
    const firstNames = await tp.$$eval('section.set:first-of-type tbody td:first-child', (n) => n.map((x) => x.textContent));
    assert.strictEqual(firstNames.length, 5);
    assert.ok((await tp.textContent('section.set:first-of-type .missing')).includes('가상학생06'));
    assert.ok((await tp.textContent('.warn')).includes('정답 빠진 세트'));

    // v1.6.0: 서답형이 있는 세트 (어제 날짜)
    await tp.fill('input[aria-label="날짜"]', '2026-11-06');
    await tp.dispatchEvent('input[aria-label="날짜"]', 'change');
    await tp.waitForFunction(() => (document.querySelector('section.set h2') || {}).textContent === '[가짜] 샘플고A 기말 3회 모의평가 (서답형 포함)');
    const essHead = await tp.textContent('section.set .set-head');
    assert.ok(essHead.includes('객관식 80 + 서답형 20점') && essHead.includes('서답형 채점 3/4명') && essHead.includes('학생에게 점수 비공개'), essHead);
    assert.deepStrictEqual(await tp.$$eval('section.set thead th', (n) => n.map((x) => x.textContent).slice(2, 5)), ['객관식', '서답형', '합계']);
    const essRows = await tp.$$eval('section.set tbody tr', (n) => n.map((x) => x.textContent));
    assert.ok(essRows[0].startsWith('가상학생01') && essRows[0].includes('72.5/80') && essRows[0].includes('18.5/20') && essRows[0].includes('91'), essRows[0]);
    assert.ok(essRows[3].startsWith('가상학생04') && essRows[3].includes('확인 필요'), essRows[3]);
    assert.ok((await tp.textContent('section.set .warn')).includes('가상학생04'));
    await tp.screenshot({ path: 'shots/t6-today-essay.png', fullPage: true });

    // v1.1.0: 누적 리포트
    await tp.click('a:has-text("누적 리포트")');
    await tp.waitForSelector('tr.stu');
    assert.deepStrictEqual(await tp.$$eval('thead th.wk', (n) => n.map((x) => x.textContent)), ['1주차', '2주차', '3주차', '4주차']);
    assert.ok((await tp.textContent('.note')).includes('공통 어휘 점검'));
    assert.ok((await tp.textContent('tr.avg')).includes('반 평균'));
    assert.deepStrictEqual(await tp.$$eval('thead th.wk', (n) => n.map((x) => x.textContent)), ['1주차', '2주차', '3주차', '4주차']);
    await tp.screenshot({ path: 'shots/t3-report.png', fullPage: true });
    await tp.click('tr.stu:has-text("가상학생02")');
    await tp.waitForSelector('tr.detail .chart');
    await tp.screenshot({ path: 'shots/t4-report-detail.png', fullPage: true });
    // v1.4.0: 모의평가 따로 보기
    await tp.selectOption('select[aria-label="종류"]', '모의평가');
    await tp.waitForFunction(() => document.querySelector('.sub').textContent.startsWith('모의평가'));
    assert.deepStrictEqual(await tp.$$eval('thead th.wk', (n) => n.map((x) => x.textContent)), ['1회', '2회', '3회']);
    assert.ok((await tp.textContent('.note')).includes('서답형 채점 전') && (await tp.textContent('.note')).includes('(서답형 포함) 1명'));
    await tp.click('tr.stu:has-text("가상학생02")');
    await tp.waitForSelector('tr.detail .chart');
    await tp.screenshot({ path: 'shots/t5-report-mock.png', fullPage: true });
    await tp.selectOption('select[aria-label="종류"]', '내신');
    await tp.waitForFunction(() => document.querySelector('.sub').textContent.startsWith('내신'));
    await tp.selectOption('select[aria-label="학교"]', '샘플고B');
    await tp.waitForFunction(() => document.querySelector('.sub').textContent.includes('샘플고B'));
    assert.deepStrictEqual(await tp.$$eval('tr.stu .name', (n) => n.map((x) => x.textContent.replace(/[▸▾]|\d학년/g, ''))), ['가상학생07', '가상학생08', '가상학생09']);

    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
    const mp = await mctx.newPage(); watch(mp);
    await mp.goto(url + '/teacher.html');
    await mp.fill('input[type=password]', 'demo-teacher');
    await mp.click('button[type=submit]');
    await mp.waitForSelector('section.set');
    await mp.screenshot({ path: 'shots/t2-today-phone.png', fullPage: true });

    // v1.5.0 학부모: 처음 번호로 로그인 → 비밀번호 바꾸기 → 리포트 (자기 아이 것만)
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
    const pp = await pctx.newPage(); watch(pp);
    await pp.goto(url + '/parent.html');
    await pp.waitForSelector('#school option[value="샘플고A"]', { state: 'attached' });
    await pp.selectOption('#school', '샘플고A');
    await pp.fill('#name', '가상학생01');
    await pp.fill('#pw', 'demo1234'); // 학생 비밀번호로는 못 들어감
    await pp.click('button[type=submit]');
    await pp.waitForFunction(() => document.querySelector('.error').textContent.length > 0);
    await pp.fill('#pw', DEMO_PARENT_CODE);
    await pp.screenshot({ path: 'shots/p1-login.png' });
    await pp.click('button[type=submit]');
    await pp.waitForSelector('#np');
    assert.ok((await pp.textContent('main')).includes('새 비밀번호 정하기'));
    await pp.fill('#np', 'parent-new-01');
    await pp.fill('#np2', 'parent-new-01');
    await pp.screenshot({ path: 'shots/p2-changepw.png' });
    await pp.click('button[type=submit]');
    await pp.waitForSelector('.rec');
    const ptext = await pp.textContent('main');
    assert.ok(ptext.includes('가상학생01 학생 학습 리포트'));
    assert.ok(ptext.includes('[가짜] 고전시가 확인 테스트'), '학생에게 비공개인 세트도 학부모에게는 보임');
    assert.ok(ptext.includes('모의평가 회차별 점수') && ptext.includes('주차별 점수 (내신)'));
    assert.ok(ptext.includes('반 평균'));
    for (const other of ['가상학생02', '가상학생03', '가상학생04', '가상학생06', '가상학생07']) assert.ok(!ptext.includes(other), '다른 학생 이름이 보이면 안 됨: ' + other);
    assert.strictEqual(await pp.locator('svg.chart').count(), 2);
    assert.ok(ptext.includes('객관식 72.5/80 · 서답형 18.5/20'), 'v1.6.0 서답형 합산');
    assert.ok(ptext.includes('91점'));
    await pp.screenshot({ path: 'shots/p3-report.png', fullPage: true });
    // 새로고침해도 로그인 유지, 로그아웃하면 로그인 화면
    await pp.reload();
    await pp.waitForSelector('.rec');
    await pp.click('text=로그아웃');
    await pp.waitForSelector('#pw');

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
