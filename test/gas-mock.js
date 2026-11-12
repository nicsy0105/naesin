// 구글 앱스 스크립트 환경을 흉내 내는 가짜 환경.
// Code.gs를 고치지 않고 그대로 실행해서 테스트합니다.
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const path = require('path');

const CODE_PATH = path.join(__dirname, '..', 'server', 'Code.gs');

class MockRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.getCell(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  getValue() { return this.sheet.getCell(this.r, this.c); }
  setValues(v) {
    if (v.length !== this.nr || v.some((row) => row.length !== this.nc)) throw new Error('setValues 크기 불일치');
    v.forEach((row, i) => row.forEach((val, j) => this.sheet.setCell(this.r + i, this.c + j, val)));
    return this;
  }
  setValue(v) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.setCell(this.r + i, this.c + j, v);
    return this;
  }
  setNumberFormat(f) {
    if (f === '@') for (let j = 0; j < this.nc; j++) this.sheet.textCols.add(this.c + j);
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setNote(n) { this.sheet.notes[`${this.r},${this.c}`] = n; return this; }
  // 수식은 계산하지 않고 글자 그대로 저장 (서버는 수식 칸을 읽지 않음)
  setFormula(f) { this.sheet.formulas[`${this.r},${this.c}`] = f; this.sheet.setCell(this.r, this.c, f); return this; }
  getRow() { return this.r; }
  getNumRows() { return this.nr; }
}

class MockSheet {
  constructor(name, ss) { this.name = name; this.ss = ss; this.data = []; this.textCols = new Set(); this.notes = {}; this.formulas = {}; this.frozen = 0; }
  getName() { return this.name; }
  getCell(r, c) {
    const row = this.data[r - 1];
    const v = row ? row[c - 1] : undefined;
    return v === undefined || v === null ? '' : v;
  }
  // 진짜 구글 시트처럼: 일반 칸에 '123'을 쓰면 숫자로, '2026-11-07'을 쓰면 날짜로 바뀜
  setCell(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    if (typeof v === 'string' && r > 1 && !this.textCols.has(c)) {
      if (/^-?\d+(\.\d+)?$/.test(v.trim())) v = Number(v);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) v = new Date(v.trim() + 'T00:00:00+09:00');
    }
    this.data[r - 1][c - 1] = v;
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) {
      if ((this.data[i] || []).some((v) => v !== '' && v !== undefined && v !== null)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.data.forEach((row) => (row || []).forEach((v, j) => { if (v !== '' && v !== undefined && v !== null) m = Math.max(m, j + 1); }));
    return m;
  }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getRange(r, c, nr = 1, nc = 1) { return new MockRange(this, r, c, nr, nc); }
  appendRow(arr) { const r = this.getLastRow() + 1; arr.forEach((v, j) => this.setCell(r, j + 1, v)); }
  setFrozenRows(n) { this.frozen = n; }
  // 테스트 편의: 헤더 이름으로 행 쓰기
  addRow(obj) {
    const headers = this.data[0];
    this.appendRow(headers.map((h) => (h in obj ? obj[h] : '')));
  }
  objects() {
    const headers = this.data[0] || [];
    const out = [];
    for (let r = 2; r <= this.getLastRow(); r++) {
      const o = { _row: r };
      headers.forEach((h, j) => { o[h] = this.getCell(r, j + 1); });
      out.push(o);
    }
    return out;
  }
}

class MockSpreadsheet {
  constructor() { this.sheets = [new MockSheet('시트1', this)]; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new MockSheet(n, this); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  getSpreadsheetTimeZone() { return 'Asia/Seoul'; }
}

function formatDate(date, tz, fmt) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, (t) => ({
    yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second
  })[t]);
}

function loadGas(opts = {}) {
  const ss = new MockSpreadsheet();
  const cache = new Map();
  const clock = { now: opts.now ? new Date(opts.now).getTime() : Date.now() };
  const errors = [];
  const context = {
    console: {
      log: () => {}, info: () => {}, warn: () => {},
      error: (...a) => { errors.push(a.join(' ')); if (opts.verbose) console.error(...a); }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      flush: () => {},
      getUi: () => { throw new Error('UI 없음(테스트)'); }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, value) => Array.from(crypto.createHash('sha256').update(String(value), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
        remove: (k) => { cache.delete(k); }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return this.content; } })
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(CODE_PATH, 'utf8'), context, { filename: 'Code.gs' });
  // 시계를 테스트가 조절할 수 있게
  context.now_ = opts.realtime ? () => new Date() : () => new Date(clock.now);

  const call = (action, data = {}) => {
    const out = context.doPost({ postData: { contents: JSON.stringify(Object.assign({ action }, data)) } });
    return JSON.parse(out.getContent());
  };
  const raw = (body) => JSON.parse(context.doPost({ postData: { contents: body } }).getContent());
  const sheet = (name) => ss.getSheetByName(name);
  const advance = (ms) => { clock.now += ms; };
  return { ctx: context, ss, call, raw, sheet, clock, advance, errors, cache };
}

// 화면 캡처·테스트용 가짜 자료 (실제 학생 아님)
function seedFake(g) {
  g.ctx.setupSheets_();
  const st = g.sheet('학생');
  [
    ['가상학생01', '샘플고A', '2'], ['가상학생02', '샘플고A', '2'], ['가상학생03', '샘플고A', '2'],
    ['가상학생04', '샘플고A', '2'], ['가상학생05', '샘플고A', '2'], ['가상학생06', '샘플고A', '2'],
    ['가상학생07', '샘플고B', '1'], ['가상학생08', '샘플고B', '1'], ['가상학생09', '샘플고B', '1'],
    ['가상학생10', '샘플고A', '2', '퇴원']
  ].forEach(([이름, 학교, 학년, 상태]) => st.addRow({ 이름, 학교, 학년, 상태: 상태 || '' }));

  const sets = g.sheet('세트');
  sets.addRow({ 세트ID: 'DEMO-A-1', 세트이름: '[가짜] 고전시가 확인 테스트', 학교: '샘플고A', 선지수: '', 사용: 'Y', 주차: 1, 결과공개: 'Y' });
  sets.addRow({ 세트ID: 'DEMO-B-1', 세트이름: '[가짜] 현대소설 확인 테스트', 학교: '샘플고B', 선지수: 5, 사용: 'Y', 주차: '1주차', 결과공개: 'Y' });
  sets.addRow({ 세트ID: 'DEMO-ALL', 세트이름: '[가짜] 공통 어휘 점검', 학교: '', 선지수: '', 사용: 'Y', 결과공개: 'Y' });
  sets.addRow({ 세트ID: 'DEMO-OFF', 세트이름: '[가짜] 사용 안 함', 학교: '', 선지수: '', 사용: '' });
  sets.addRow({ 세트ID: 'DEMO-BAD', 세트이름: '[가짜] 정답 빠진 세트', 학교: '', 선지수: '', 사용: 'Y' });

  const items = g.sheet('문항');
  const unitsA = [['고전시가', '표현상 특징'], ['고전시가', '화자의 태도'], ['고전시가', '시어의 의미'], ['고전시가', '외적 준거 감상']];
  const keysA = ['3', '2,4', '1', '5', '4', '2', '1,3', '3', '5', '2', '4', '1'];
  keysA.forEach((k, i) => items.addRow({ 세트ID: 'DEMO-A-1', 번호: i + 1, 정답: k, 배점: '', 단원: unitsA[i % 4][0], 세부항목: unitsA[i % 4][1] }));
  ['2', '4', '1', '3', '5', '2', '3', '1', '4', '2'].forEach((k, i) => items.addRow({ 세트ID: 'DEMO-B-1', 번호: i + 1, 정답: k, 단원: '현대소설', 세부항목: i % 2 ? '서술상 특징' : '인물의 심리' }));
  ['1', '2', '3', '4', '5'].forEach((k, i) => items.addRow({ 세트ID: 'DEMO-ALL', 번호: i + 1, 정답: k, 단원: '어휘', 세부항목: '한자어' }));
  ['1', '2'].forEach((k, i) => items.addRow({ 세트ID: 'DEMO-OFF', 번호: i + 1, 정답: k }));
  items.addRow({ 세트ID: 'DEMO-BAD', 번호: 1, 정답: '2' });
  items.addRow({ 세트ID: 'DEMO-BAD', 번호: 2, 정답: '' });
}

module.exports = { loadGas, seedFake, formatDate };
