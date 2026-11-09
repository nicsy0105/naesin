/**
 * 내신 클리닉 — 서버 (Google Apps Script)
 * ─────────────────────────────────────────────
 * 이 파일 전체를 구글 시트의 [확장 프로그램 → Apps Script]에 붙여 넣으세요.
 * 이 파일에는 비밀번호나 학생 정보가 없습니다. 모두 구글 시트에만 저장됩니다.
 *
 * 서버 파일을 고칠 때마다 아래 버전 번호를 올립니다.
 */
const SERVER_VERSION = '1.2.0';

const CONFIG = {
  TZ: 'Asia/Seoul',
  MAX_FAILS: 5,            // 비밀번호를 이만큼 틀리면 잠금
  LOCK_MINUTES: 15,        // 잠금 시간(분)
  SESSION_SECONDS: 21600,  // 로그인 유지 시간(6시간, 구글 최대치)
  DEFAULT_PASSWORD: '0000',
  HASH_ROUNDS: 200,
  MIN_STUDENT_PW: 4,
  MIN_TEACHER_PW: 6,
  DEFAULT_CHOICES: 5
};

/* ───────────── 시트 구조 ───────────── */

const SHEET_DEFS = {
  students: {
    name: '학생',
    headers: ['학생ID', '이름', '학교', '학년', '상태', '비밀번호해시', '솔트', '실패횟수', '잠금해제시각', '비밀번호변경일'],
    system: ['학생ID', '비밀번호해시', '솔트', '실패횟수', '잠금해제시각', '비밀번호변경일'],
    text: ['학생ID', '이름', '학교', '학년', '상태', '비밀번호해시', '솔트', '잠금해제시각'],
    notes: {
      '학생ID': '자동으로 채워져요. 직접 고치지 마세요.',
      '이름': '학생 이름. 같은 학교에 이름이 같은 학생이 있으면 김민준A, 김민준B처럼 구분해 주세요.',
      '학교': '학생이 로그인할 때 고르는 학교 이름이에요.',
      '상태': '비워 두면 재원. "퇴원"이라고 쓰면 로그인할 수 없어요.',
      '비밀번호해시': '직접 쓰지 마세요. 비어 있으면 초기 비밀번호 0000이에요. 0000으로 되돌리려면 메뉴 [내신 관리 → 선택한 학생 비밀번호 0000으로 되돌리기].',
      '실패횟수': '로그인 실패 기록이에요. 메뉴 [내신 관리 → 선택한 학생 잠금 풀기]로 지울 수 있어요.'
    }
  },
  sets: {
    name: '세트',
    headers: ['세트ID', '세트이름', '학교', '선지수', '사용', '메모'],
    extra: ['주차', '결과공개'], // 주차: v1.1.0, 결과공개: v1.2.0. 칸이 없어도 동작
    text: ['세트ID', '세트이름', '학교', '사용'],
    notes: {
      '세트ID': '세트마다 겹치지 않게 정하는 이름. 예: 1107-가나고-1. 문항 탭에도 똑같이 써요.',
      '세트이름': '학생 화면에 보이는 이름이에요.',
      '학교': '이 학교 학생에게만 보여요. 비우면 모든 학생에게 보여요.',
      '선지수': '비우면 5지선다예요.',
      '사용': 'Y라고 쓰면 학생 화면에 보여요. 지우면 안 보여요.',
      '주차': '몇 주차 세트인지 숫자로 써요. 예: 1. 비우면 누적 리포트(주차별 점수)에서 빠져요.',
      '결과공개': 'Y면 학생이 제출 뒤 점수와 틀린 문항을 봐요. 비우면 학생에게는 자기가 칠한 답만 보여요(선생님 화면에는 항상 점수가 보여요). 나중에 Y로 바꾸면 그때부터 공개돼요.'
    }
  },
  items: {
    name: '문항',
    headers: ['세트ID', '번호', '정답', '배점', '단원', '세부항목', '메모'],
    text: ['세트ID', '정답', '단원', '세부항목'],
    notes: {
      '세트ID': '세트 탭의 세트ID와 똑같이 써요.',
      '번호': '문항 번호(숫자)예요.',
      '정답': '정답 번호. 여러 개면 2,4처럼 쉼표로 써요. 고른 선지가 정답과 똑같아야 맞음이에요.',
      '배점': '비우면 1점. 학생에게는 100점 만점으로 바꿔서 보여요.',
      '단원': '단원별 분석용 태그. 예: 고전시가',
      '세부항목': '단원 안의 세부 항목. 예: 표현상 특징'
    }
  },
  submissions: {
    name: '제출',
    headers: ['제출ID', '제출시각', '날짜', '학생ID', '이름', '학교', '세트ID', '세트이름', '답안', '맞은수', '문항수', '점수', '틀린문항', '비운문항'],
    text: ['제출ID', '날짜', '학생ID', '이름', '학교', '세트ID', '세트이름', '답안', '틀린문항', '비운문항'],
    notes: {
      '제출ID': '자동으로 기록돼요. 학생에게 그 세트를 다시 풀게 하려면 그 학생의 행을 지우세요.',
      '답안': '번호:고른 선지. 예) 3:24 는 3번에 ②④를 골랐다는 뜻, 5:- 는 비움.',
      '점수': '100점 만점으로 바꾼 점수예요.',
      '틀린문항': '비운 문항도 틀린 문항에 들어가요.'
    }
  },
  homework: {
    name: '숙제검사',
    headers: ['날짜', '학생ID', '이름', '숙제', '상태', '메모'],
    text: ['날짜', '학생ID', '이름', '숙제', '상태'],
    notes: { '날짜': '다음 단계에서 쓸 탭이에요. 지금은 비워 두셔도 돼요.' }
  },
  settings: {
    name: '설정',
    headers: ['항목', '값', '설명'],
    system: ['값'],
    text: ['항목', '값', '설명'],
    notes: {}
  }
};

const TEACHER_KEYS = {
  hash: '선생님비밀번호해시',
  salt: '선생님솔트',
  fails: '선생님실패횟수',
  lockUntil: '선생님잠금해제시각'
};

/* ───────────── 웹 요청 받기 ───────────── */

function doGet() {
  return json_({ ok: true, app: '내신 클리닉', version: SERVER_VERSION });
}

function doPost(e) {
  return json_(route_(function () {
    const body = e && e.postData && e.postData.contents;
    const req = JSON.parse(body || '{}');
    return handle_(req);
  }));
}

const ACTIONS = {
  ping: function () { return {}; },
  schools: apiSchools_,
  studentLogin: apiStudentLogin_,
  changePassword: apiChangePassword_,
  studentHome: apiStudentHome_,
  getSet: apiGetSet_,
  submit: apiSubmit_,
  myResult: apiMyResult_,
  teacherLogin: apiTeacherLogin_,
  teacherToday: apiTeacherToday_,
  myTrend: apiMyTrend_,          // v1.1.0
  teacherTrend: apiTeacherTrend_ // v1.1.0
};

function handle_(req) {
  const fn = ACTIONS[req && req.action];
  if (!fn) throw userErr_('알 수 없는 요청이에요.');
  return fn(req);
}

function route_(fn) {
  try {
    const res = fn() || {};
    res.ok = true;
    res.version = SERVER_VERSION;
    return res;
  } catch (err) {
    if (err && err.isUser) {
      return { ok: false, error: err.message, code: err.code, version: SERVER_VERSION };
    }
    console.error(err && err.stack ? err.stack : err);
    return { ok: false, error: '서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요.', code: 'SERVER', version: SERVER_VERSION };
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function userErr_(msg, code) {
  const e = new Error(msg);
  e.isUser = true;
  e.code = code || 'USER';
  return e;
}

function authErr_() {
  return userErr_('로그인이 끝났어요. 다시 로그인해 주세요.', 'AUTH');
}

/* ───────────── 학생 API ───────────── */

function apiSchools_() {
  const t = readTable_('students');
  const seen = {};
  const list = [];
  t.rows.forEach(function (r) {
    if (!isActive_(r) || !norm_(r['이름'])) return;
    const s = String(r['학교'] == null ? '' : r['학교']).trim();
    if (s && !seen[s]) { seen[s] = true; list.push(s); }
  });
  list.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  return { schools: list };
}

function apiStudentLogin_(req) {
  const school = norm_(req.school);
  const name = norm_(req.name);
  const pw = String(req.password == null ? '' : req.password);
  if (!school || !name || !pw) throw userErr_('학교, 이름, 비밀번호를 모두 입력해 주세요.');

  return withLock_(function () {
    const t = readTable_('students');
    ensureStudentIds_(t);
    const matches = t.rows.filter(function (r) {
      return isActive_(r) && norm_(r['학교']) === school && norm_(r['이름']) === name;
    });
    if (matches.length === 0) throw userErr_('학교와 이름을 다시 확인해 주세요. 계속 안 되면 선생님께 말씀해 주세요.', 'NOT_FOUND');
    if (matches.length > 1) throw userErr_('같은 학교에 이름이 같은 학생이 있어요. 선생님께 말씀해 주세요.', 'DUPLICATE');
    const rec = matches[0];
    const res = attemptLogin_(studentAcc_(t, rec), pw, true);
    const token = newSession_({ role: 'student', sid: String(rec['학생ID']), mustChange: res.mustChange });
    return { token: token, name: String(rec['이름']).trim(), school: String(rec['학교']).trim(), mustChange: res.mustChange };
  });
}

function apiChangePassword_(req) {
  const s = getSession_(req.token, 'student');
  const np = String(req.newPassword == null ? '' : req.newPassword);
  checkNewStudentPassword_(np);
  return withLock_(function () {
    const t = readTable_('students');
    const rec = findStudent_(t, s.sid);
    attemptLogin_(studentAcc_(t, rec), String(req.currentPassword == null ? '' : req.currentPassword), true);
    const salt = newSalt_();
    t.set(rec, '솔트', salt);
    t.set(rec, '비밀번호해시', hashPassword_(np, salt));
    t.set(rec, '비밀번호변경일', now_());
    s.mustChange = false;
    saveSession_(s);
    return {};
  });
}

function checkNewStudentPassword_(np) {
  if (/\s/.test(np)) throw userErr_('비밀번호에 띄어쓰기는 쓸 수 없어요.');
  if (np.length < CONFIG.MIN_STUDENT_PW) throw userErr_('비밀번호는 ' + CONFIG.MIN_STUDENT_PW + '자 이상으로 정해 주세요.');
  if (np.length > 30) throw userErr_('비밀번호가 너무 길어요. 30자 이하로 정해 주세요.');
  if (np === CONFIG.DEFAULT_PASSWORD) throw userErr_('0000은 쓸 수 없어요. 다른 비밀번호로 정해 주세요.');
}

function apiStudentHome_(req) {
  const s = getSession_(req.token, 'student');
  requireChanged_(s);
  const st = findStudent_(readTable_('students'), s.sid);
  const items = loadItems_();
  const done = {};
  readTable_('submissions').rows.forEach(function (r) {
    if (String(r['학생ID']) === s.sid) done[norm_(r['세트ID'])] = r;
  });
  const sets = visibleSets_(st, items).map(function (set) {
    const d = done[set.id];
    return {
      setId: set.id,
      title: set.title,
      count: items[set.id].length,
      done: !!d,
      revealed: set.reveal,
      score: d && set.reveal ? Number(d['점수']) : null
    };
  });
  // 아직 안 푼 세트를 먼저, 그다음 푼 세트
  sets.sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0); });
  return { name: String(st['이름']).trim(), school: String(st['학교']).trim(), sets: sets };
}

function apiGetSet_(req) {
  const s = getSession_(req.token, 'student');
  requireChanged_(s);
  const st = findStudent_(readTable_('students'), s.sid);
  const items = loadItems_();
  const set = findVisibleSet_(st, items, req.setId);
  const already = readTable_('submissions').rows.some(function (r) {
    return String(r['학생ID']) === s.sid && norm_(r['세트ID']) === set.id;
  });
  if (already) throw userErr_('이미 제출한 세트예요.', 'ALREADY');
  // 정답은 절대 보내지 않습니다. 번호와 선지 수만 보냅니다.
  return {
    setId: set.id,
    title: set.title,
    choices: set.choices,
    numbers: items[set.id].map(function (it) { return it.no; })
  };
}

function apiSubmit_(req) {
  const s = getSession_(req.token, 'student');
  requireChanged_(s);
  if (!req.answers || typeof req.answers !== 'object' || Array.isArray(req.answers)) {
    throw userErr_('답안이 비어 있어요. 다시 해 주세요.');
  }
  return withLock_(function () {
    const st = findStudent_(readTable_('students'), s.sid);
    const items = loadItems_();
    const set = findVisibleSet_(st, items, req.setId);
    const subs = readTable_('submissions');
    const already = subs.rows.some(function (r) {
      return String(r['학생ID']) === s.sid && norm_(r['세트ID']) === set.id;
    });
    if (already) throw userErr_('이미 제출한 세트예요.', 'ALREADY');

    const its = items[set.id];
    const answers = cleanAnswers_(its, req.answers, set.choices);
    const result = grade_(its, answers);
    const now = now_();
    subs.append({
      '제출ID': 'T' + Utilities.formatDate(now, CONFIG.TZ, 'yyyyMMddHHmmss') + '-' + Utilities.getUuid().slice(0, 4),
      '제출시각': now,
      '날짜': Utilities.formatDate(now, CONFIG.TZ, 'yyyy-MM-dd'),
      '학생ID': s.sid,
      '이름': String(st['이름']).trim(),
      '학교': String(st['학교']).trim(),
      '세트ID': set.id,
      '세트이름': set.title,
      '답안': encodeAnswers_(its, answers),
      '맞은수': result.correct,
      '문항수': result.count,
      '점수': result.score,
      '틀린문항': result.wrong.join(', '),
      '비운문항': result.blank.join(', ')
    });
    if (!set.reveal) return { title: set.title, revealed: false, myAnswers: its.map(function (it) { return { no: it.no, choices: answers[it.no] }; }) };
    return { result: result, title: set.title, revealed: true };
  });
}

function apiMyResult_(req) {
  const s = getSession_(req.token, 'student');
  requireChanged_(s);
  const id = norm_(req.setId);
  const row = readTable_('submissions').rows.filter(function (r) {
    return String(r['학생ID']) === s.sid && norm_(r['세트ID']) === id;
  })[0];
  if (!row) throw userErr_('제출 기록이 없어요.', 'NOT_FOUND');
  const set = setsById_()[id];
  if (!set || !set.reveal) {
    return { title: set ? set.title : String(row['세트이름'] || id), revealed: false, myAnswers: decodeAnswers_(row['답안']) };
  }
  return {
    revealed: true,
    title: String(row['세트이름'] || id),
    result: {
      score: Number(row['점수']),
      correct: Number(row['맞은수']),
      count: Number(row['문항수']),
      wrong: parseNumList_(row['틀린문항']),
      blank: parseNumList_(row['비운문항'])
    }
  };
}

/* ───────────── 선생님 API ───────────── */

function apiTeacherLogin_(req) {
  const pw = String(req.password == null ? '' : req.password);
  if (!pw) throw userErr_('비밀번호를 입력해 주세요.');
  return withLock_(function () {
    const acc = teacherAcc_();
    if (!acc.get('hash')) {
      throw userErr_('선생님 비밀번호가 아직 없어요. 구글 시트 메뉴 [내신 관리 → 선생님 비밀번호 정하기]에서 먼저 정해 주세요.', 'NO_TEACHER_PW');
    }
    attemptLogin_(acc, pw, false);
    return { token: newSession_({ role: 'teacher' }) };
  });
}

function apiTeacherToday_(req) {
  getSession_(req.token, 'teacher');
  const today = todayKey_();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.date || '')) ? String(req.date) : today;

  const sets = loadSets_();
  const setById = {};
  sets.forEach(function (x) { setById[x.id] = x; });
  const items = loadItems_();
  const students = readTable_('students').rows.filter(function (r) { return isActive_(r) && norm_(r['이름']); });
  const subs = readTable_('submissions').rows;

  const everDone = {}; // 세트ID → {학생ID: true}
  subs.forEach(function (r) {
    const id = norm_(r['세트ID']);
    (everDone[id] = everDone[id] || {})[String(r['학생ID'])] = true;
  });

  const groups = {};
  const order = [];
  subs.forEach(function (r) {
    if (submissionDate_(r) !== date) return;
    const id = norm_(r['세트ID']);
    if (!groups[id]) { groups[id] = []; order.push(id); }
    groups[id].push(r);
  });

  const out = order.map(function (id) {
    const set = setById[id];
    const its = items[id] || [];
    const rows = groups[id].map(function (r) {
      return {
        name: String(r['이름']).trim(),
        school: String(r['학교']).trim(),
        score: Number(r['점수']),
        correct: Number(r['맞은수']),
        count: Number(r['문항수']),
        wrong: parseNumList_(r['틀린문항']),
        blank: parseNumList_(r['비운문항']),
        time: Utilities.formatDate(submittedAt_(r), CONFIG.TZ, 'HH:mm')
      };
    });
    rows.sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name, 'ko'); });
    const scores = rows.map(function (x) { return x.score; });
    const n = rows.length;
    const itemRates = its.map(function (it) {
      const wrongCount = rows.filter(function (x) { return x.wrong.indexOf(it.no) >= 0; }).length;
      return {
        no: it.no,
        rate: n ? Math.round((n - wrongCount) / n * 100) : null,
        answer: it.key.join(','),
        unit: it.unit,
        detail: it.detail
      };
    });
    let missing = null;
    if (set && set.school) {
      const done = everDone[id] || {};
      missing = students.filter(function (st) {
        return norm_(st['학교']) === norm_(set.school) && !done[String(st['학생ID'])];
      }).map(function (st) { return String(st['이름']).trim(); });
      missing.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
    }
    return {
      setId: id,
      title: set ? set.title : String(groups[id][0]['세트이름'] || id),
      school: set ? set.school : '',
      reveal: set ? set.reveal : false,
      submitted: n,
      avg: n ? round1_(scores.reduce(function (a, b) { return a + b; }, 0) / n) : null,
      max: n ? Math.max.apply(null, scores) : null,
      min: n ? Math.min.apply(null, scores) : null,
      itemRates: itemRates,
      rows: rows,
      missing: missing
    };
  });

  const warnings = [];
  sets.forEach(function (set) {
    if (!set.on) return;
    const p = setProblem_(set, items[set.id]);
    if (p) warnings.push({ setId: set.id, title: set.title, problem: p });
  });

  return { date: date, today: today, sets: out, warnings: warnings };
}

/* ───────────── 누적 리포트 (v1.1.0에 추가) ─────────────
 * 주차: 세트 탭의 '주차' 칸. 비어 있으면 주차별 점수에서 빠짐(세부항목 집계에는 들어감).
 * 주차 점수: 그 주차 세트 점수(100점 환산)의 평균.
 * 약한 세부항목: 2문항 이상 풀었고 정답률 80% 미만인 것 중 낮은 순 3개.
 */

function apiMyTrend_(req) {
  const s = getSession_(req.token, 'student');
  requireChanged_(s);
  findStudent_(readTable_('students'), s.sid);
  const setById = setsById_();
  const items = loadItems_();
  const mine = readTable_('submissions').rows.filter(function (r) { return String(r['학생ID']) === s.sid; });
  // v1.2.0: 결과를 공개한 세트만 학생 추이에 넣음
  const rows = mine.filter(function (r) { const set = setById[norm_(r['세트ID'])]; return set && set.reveal; });
  const st = buildStats_(rows, setById, items);
  return {
    hidden: mine.length - rows.length,
    weeks: st.weeks.map(function (w) {
      return { week: w.week, label: w.label, score: w.score, sets: w.sets.map(function (x) { return { title: x.title, score: x.score }; }) };
    }),
    avg: st.avg,
    weak: weakTags_(st.tags),
    tags: st.tags,
    submitted: rows.length,
    unweeked: st.unweeked
  };
}

function apiTeacherTrend_(req) {
  getSession_(req.token, 'teacher');
  const students = readTable_('students').rows.filter(function (r) { return isActive_(r) && norm_(r['이름']); });
  const schools = [];
  students.forEach(function (r) {
    const sc = String(r['학교'] == null ? '' : r['학교']).trim();
    if (sc && schools.indexOf(sc) < 0) schools.push(sc);
  });
  schools.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  const school = schools.indexOf(String(req.school || '')) >= 0 ? String(req.school) : (schools[0] || '');

  const setById = setsById_();
  const items = loadItems_();
  const bySid = {};
  readTable_('submissions').rows.forEach(function (r) {
    const sid = String(r['학생ID']);
    (bySid[sid] = bySid[sid] || []).push(r);
  });

  const unweeked = {};
  const list = students.filter(function (r) { return norm_(r['학교']) === norm_(school); }).map(function (r) {
    const rows = bySid[String(r['학생ID'])] || [];
    rows.forEach(function (x) {
      const set = setById[norm_(x['세트ID'])];
      if (!set || set.week == null) unweeked[norm_(x['세트ID'])] = set ? set.title : String(x['세트이름'] || x['세트ID']);
    });
    const st = buildStats_(rows, setById, items);
    const weeks = {};
    st.weeks.forEach(function (w) { weeks[w.week] = { score: w.score, sets: w.sets.map(function (x) { return { title: x.title, score: x.score }; }) }; });
    return {
      name: String(r['이름']).trim(),
      grade: String(r['학년'] == null ? '' : r['학년']).trim(),
      weeks: weeks,
      avg: st.avg,
      weak: weakTags_(st.tags),
      tags: st.tags,
      submitted: rows.length
    };
  });
  list.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });

  const weekNums = [];
  list.forEach(function (x) { Object.keys(x.weeks).forEach(function (k) { if (weekNums.indexOf(Number(k)) < 0) weekNums.push(Number(k)); }); });
  weekNums.sort(function (a, b) { return a - b; });
  const weeks = weekNums.map(function (w) {
    const scores = list.filter(function (x) { return x.weeks[w]; }).map(function (x) { return x.weeks[w].score; });
    return { week: w, label: w + '주차', n: scores.length, avg: scores.length ? round1_(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : null };
  });

  return {
    schools: schools,
    school: school,
    weeks: weeks,
    students: list,
    unweekedSets: Object.keys(unweeked).map(function (id) { return { setId: id, title: unweeked[id] }; })
  };
}

function setsById_() {
  const m = {};
  loadSets_().forEach(function (x) { m[x.id] = x; });
  return m;
}

/** 한 학생의 제출 기록 → 주차별 점수 + 세부항목 정답률 */
function buildStats_(rows, setById, items) {
  const byWeek = {};
  const tags = {};
  let unweeked = 0;
  rows.forEach(function (r) {
    const id = norm_(r['세트ID']);
    const set = setById[id];
    const wrong = parseNumList_(r['틀린문항']);
    const answered = answeredNumbers_(r['답안']);
    (items[id] || []).forEach(function (it) {
      if (answered && answered.indexOf(it.no) < 0) return; // 제출 뒤에 추가된 문항은 빼기
      const key = tagKey_(it);
      if (!key) return;
      const t = tags[key] = tags[key] || { tag: key, unit: it.unit, detail: it.detail, correct: 0, total: 0 };
      t.total++;
      if (wrong.indexOf(it.no) < 0) t.correct++;
    });
    if (!set || set.week == null) { unweeked++; return; }
    const w = byWeek[set.week] = byWeek[set.week] || { week: set.week, sets: [] };
    w.sets.push({ setId: id, title: set.title, score: Number(r['점수']) });
  });
  const weeks = Object.keys(byWeek).map(Number).sort(function (a, b) { return a - b; }).map(function (k) {
    const w = byWeek[k];
    w.label = k + '주차';
    w.score = round1_(w.sets.reduce(function (a, x) { return a + x.score; }, 0) / w.sets.length);
    return w;
  });
  const tagList = Object.keys(tags).map(function (k) {
    const t = tags[k];
    t.rate = Math.round(t.correct / t.total * 100);
    return t;
  }).sort(function (a, b) { return a.rate - b.rate || b.total - a.total || a.tag.localeCompare(b.tag, 'ko'); });
  return {
    weeks: weeks,
    tags: tagList,
    avg: weeks.length ? round1_(weeks.reduce(function (a, w) { return a + w.score; }, 0) / weeks.length) : null,
    unweeked: unweeked
  };
}

function weakTags_(tags) {
  return tags.filter(function (t) { return t.total >= 2 && t.rate < 80; }).slice(0, 3);
}

function tagKey_(it) {
  if (it.unit && it.detail) return it.unit + ' > ' + it.detail;
  return it.detail || it.unit || '';
}

/** 답안 칸 "1:3 2:24 3:-" → [1,2,3]. 읽을 수 없으면 null */
function answeredNumbers_(v) {
  const nums = [];
  String(v == null ? '' : v).split(/\s+/).forEach(function (p) {
    const m = p.match(/^(\d+):/);
    if (m) nums.push(Number(m[1]));
  });
  return nums.length ? nums : null;
}

/** 주차 칸: 1 / "1" / "1주차" → 1, 비었으면 null */
function parseWeek_(v) {
  const m = String(v == null ? '' : v).match(/\d+/);
  return m ? Number(m[0]) : null;
}

/* ───────────── 채점 ───────────── */

/**
 * 채점 규칙 (선생님이 정한 것)
 *  - 고른 선지가 정답과 '완전히 같을 때만' 맞음 (부분 점수 없음)
 *  - 비운 문항은 틀림
 *  - 점수는 배점 합계를 100점 만점으로 환산, 소수 첫째 자리까지
 */
function grade_(items, answers) {
  let total = 0, got = 0, correct = 0;
  const wrong = [], blank = [];
  items.forEach(function (it) {
    const ans = answers[it.no] || [];
    total += it.points;
    if (ans.length === 0) { blank.push(it.no); wrong.push(it.no); return; }
    if (sameList_(ans, it.key)) { got += it.points; correct++; }
    else wrong.push(it.no);
  });
  return {
    score: total > 0 ? round1_(got / total * 100) : 0,
    correct: correct,
    count: items.length,
    wrong: wrong,
    blank: blank
  };
}

function cleanAnswers_(items, raw, choices) {
  const out = {};
  items.forEach(function (it) {
    const v = raw[String(it.no)];
    const arr = Array.isArray(v) ? v : [];
    out[it.no] = uniqSorted_(arr.map(Number).filter(function (n) {
      return n % 1 === 0 && n >= 1 && n <= choices;
    }));
  });
  return out;
}

function encodeAnswers_(items, answers) {
  return items.map(function (it) {
    const a = answers[it.no] || [];
    return it.no + ':' + (a.length ? a.join('') : '-');
  }).join(' ');
}

/** 답안 칸 "1:3 2:24 3:-" → [{no:1,choices:[3]}, {no:2,choices:[2,4]}, {no:3,choices:[]}] (v1.2.0) */
function decodeAnswers_(v) {
  const out = [];
  String(v == null ? '' : v).split(/\s+/).forEach(function (p) {
    const m = p.match(/^(\d+):([0-9]*|-)$/);
    if (m) out.push({ no: Number(m[1]), choices: m[2] === '-' ? [] : m[2].split('').map(Number) });
  });
  return out;
}

/** 정답 칸 읽기: "2,4" / "2, 4" / 24 / "②④" 모두 [2,4] */
function parseChoices_(v) {
  if (v === '' || v == null) return [];
  const s = String(v).replace(/[①-⑨]/g, function (c) {
    return String(c.charCodeAt(0) - 0x2460 + 1);
  });
  const nums = [];
  s.split(/[^0-9]+/).filter(Boolean).forEach(function (p) {
    if (p.length > 1) p.split('').forEach(function (d) { nums.push(Number(d)); });
    else nums.push(Number(p));
  });
  return uniqSorted_(nums);
}

/** "3, 12, 15" → [3,12,15] */
function parseNumList_(v) {
  if (v === '' || v == null) return [];
  return String(v).split(/[^0-9]+/).filter(Boolean).map(Number);
}

function sameList_(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function uniqSorted_(arr) {
  const seen = {};
  const out = [];
  arr.forEach(function (n) { if (!seen[n]) { seen[n] = true; out.push(n); } });
  return out.sort(function (a, b) { return a - b; });
}

function round1_(x) { return Math.round(x * 10) / 10; }

/* ───────────── 세트·문항 읽기 ───────────── */

function loadSets_() {
  return readTable_('sets').rows.filter(function (r) { return norm_(r['세트ID']); }).map(function (r) {
    const id = norm_(r['세트ID']);
    let choices = Number(r['선지수']);
    if (!choices || choices % 1 !== 0) choices = CONFIG.DEFAULT_CHOICES;
    choices = Math.max(2, Math.min(9, choices));
    return {
      id: id,
      title: String(r['세트이름'] == null ? '' : r['세트이름']).trim() || id,
      school: String(r['학교'] == null ? '' : r['학교']).trim(),
      choices: choices,
      on: isYes_(r['사용']),
      week: parseWeek_(r['주차']),
      reveal: isYes_(r['결과공개']) // v1.2.0
    };
  });
}

function loadItems_() {
  const bySet = {};
  readTable_('items').rows.forEach(function (r) {
    const id = norm_(r['세트ID']);
    if (!id) return;
    const p = r['배점'];
    (bySet[id] = bySet[id] || []).push({
      no: Number(r['번호']),
      key: parseChoices_(r['정답']),
      points: (p === '' || p == null) ? 1 : Number(p),
      unit: String(r['단원'] == null ? '' : r['단원']).trim(),
      detail: String(r['세부항목'] == null ? '' : r['세부항목']).trim()
    });
  });
  Object.keys(bySet).forEach(function (id) {
    bySet[id].sort(function (a, b) { return a.no - b.no; });
  });
  return bySet;
}

/** 세트에 문제가 있으면 이유를, 없으면 '' */
function setProblem_(set, items) {
  if (!items || !items.length) return '문항 탭에 이 세트의 문항이 없어요';
  const seen = {};
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!(it.no > 0) || it.no % 1 !== 0) return '번호 칸이 비었거나 숫자가 아닌 문항이 있어요';
    if (seen[it.no]) return it.no + '번 문항이 두 번 있어요';
    seen[it.no] = true;
    if (!it.key.length) return it.no + '번 정답이 비어 있어요';
    for (let k = 0; k < it.key.length; k++) {
      if (it.key[k] < 1 || it.key[k] > set.choices) return it.no + '번 정답이 선지 수(' + set.choices + ')를 벗어나요';
    }
    if (!(it.points >= 0)) return it.no + '번 배점이 숫자가 아니에요';
    total += it.points;
  }
  if (!(total > 0)) return '배점 합계가 0이에요';
  return '';
}

function visibleSets_(st, items) {
  const school = norm_(st['학교']);
  return loadSets_().filter(function (set) {
    return set.on && (!set.school || norm_(set.school) === school) && !setProblem_(set, items[set.id]);
  }).reverse(); // 시트 아래쪽(최근에 넣은 것)부터
}

function findVisibleSet_(st, items, setId) {
  const id = norm_(setId);
  const set = visibleSets_(st, items).filter(function (x) { return x.id === id; })[0];
  if (!set) throw userErr_('이 세트는 지금 풀 수 없어요. 선생님께 말씀해 주세요.', 'NO_SET');
  return set;
}

/* ───────────── 학생·로그인 ───────────── */

function isActive_(r) { return norm_(r['상태']) !== '퇴원'; }

function isYes_(v) {
  if (v === true) return true;
  return ['Y', 'O', '예', '네', '사용', 'TRUE', '1'].indexOf(String(v == null ? '' : v).trim().toUpperCase()) >= 0;
}

function findStudent_(t, sid) {
  const rec = t.rows.filter(function (r) { return String(r['학생ID']) === String(sid) && isActive_(r); })[0];
  if (!rec) throw authErr_();
  return rec;
}

function ensureStudentIds_(t) {
  let max = 0;
  t.rows.forEach(function (r) {
    const m = String(r['학생ID'] == null ? '' : r['학생ID']).match(/^S(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  t.rows.forEach(function (r) {
    if (!norm_(r['학생ID']) && norm_(r['이름'])) {
      max++;
      t.set(r, '학생ID', 'S' + ('000' + max).slice(-4));
    }
  });
}

function requireChanged_(s) {
  if (s.mustChange) throw userErr_('처음 로그인했어요. 먼저 비밀번호를 바꿔 주세요.', 'MUST_CHANGE');
}

function studentAcc_(t, rec) {
  const map = { hash: '비밀번호해시', salt: '솔트', fails: '실패횟수', lockUntil: '잠금해제시각' };
  return {
    get: function (f) { return rec[map[f]]; },
    set: function (f, v) { t.set(rec, map[f], v); }
  };
}

function teacherAcc_() {
  const t = readTable_('settings');
  const byKey = {};
  t.rows.forEach(function (r) { byKey[norm_(r['항목'])] = r; });
  return {
    get: function (f) { const r = byKey[TEACHER_KEYS[f]]; return r ? r['값'] : ''; },
    set: function (f, v) {
      const key = TEACHER_KEYS[f];
      if (byKey[key]) t.set(byKey[key], '값', v);
      else { t.append({ '항목': key, '값': v }); byKey[key] = { '값': v, _row: t.sheet.getLastRow() }; }
    }
  };
}

/**
 * 비밀번호 확인 + 잠금 처리. 학생·선생님 공통.
 * allowDefault: 해시가 비어 있으면 0000을 받아 줄지
 */
function attemptLogin_(acc, pw, allowDefault) {
  const now = now_().getTime();
  const lockUntil = toMillis_(acc.get('lockUntil'));
  if (lockUntil && lockUntil > now) {
    const mins = Math.ceil((lockUntil - now) / 60000);
    throw userErr_('비밀번호를 여러 번 틀려서 잠겼어요. ' + mins + '분 뒤에 다시 해 주세요.', 'LOCKED');
  }
  const hash = String(acc.get('hash') == null ? '' : acc.get('hash'));
  const ok = hash ? hashPassword_(pw, acc.get('salt')) === hash
                  : (allowDefault && pw === CONFIG.DEFAULT_PASSWORD);
  if (!ok) {
    const fails = (Number(acc.get('fails')) || 0) + 1;
    if (fails >= CONFIG.MAX_FAILS) {
      acc.set('fails', 0);
      acc.set('lockUntil', new Date(now + CONFIG.LOCK_MINUTES * 60000).toISOString());
      throw userErr_('비밀번호를 ' + CONFIG.MAX_FAILS + '번 틀려서 ' + CONFIG.LOCK_MINUTES + '분 동안 잠겼어요.', 'LOCKED');
    }
    acc.set('fails', fails);
    throw userErr_('비밀번호가 틀렸어요. (' + (CONFIG.MAX_FAILS - fails) + '번 더 틀리면 잠겨요)', 'BADPW');
  }
  if (Number(acc.get('fails')) || acc.get('lockUntil')) {
    acc.set('fails', 0);
    acc.set('lockUntil', '');
  }
  return { mustChange: !hash };
}

function hashPassword_(pw, salt) {
  let v = String(salt) + '|' + String(pw);
  for (let i = 0; i < CONFIG.HASH_ROUNDS; i++) {
    v = toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v, Utilities.Charset.UTF_8));
  }
  return v;
}

function toHex_(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const h = (bytes[i] & 0xff).toString(16);
    s += h.length === 1 ? '0' + h : h;
  }
  return s;
}

function newSalt_() { return Utilities.getUuid().replace(/-/g, ''); }

/* ───────────── 로그인 유지(세션) ───────────── */

function newSession_(data) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('sess:' + token, JSON.stringify(data), CONFIG.SESSION_SECONDS);
  return token;
}

function getSession_(token, role) {
  if (!token) throw authErr_();
  const raw = CacheService.getScriptCache().get('sess:' + String(token));
  if (!raw) throw authErr_();
  const s = JSON.parse(raw);
  if (role && s.role !== role) throw authErr_();
  s.token = String(token);
  return s;
}

function saveSession_(s) {
  const copy = {};
  Object.keys(s).forEach(function (k) { if (k !== 'token') copy[k] = s[k]; });
  CacheService.getScriptCache().put('sess:' + s.token, JSON.stringify(copy), CONFIG.SESSION_SECONDS);
}

/* ───────────── 시트 읽고 쓰기 ───────────── */

function sheet_(key) {
  const def = SHEET_DEFS[key];
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.name);
  if (!sh) throw userErr_('구글 시트에 [' + def.name + '] 탭이 없어요. 시트 메뉴 [내신 관리 → 시트 탭 만들기]를 먼저 실행해 주세요.', 'SETUP');
  return sh;
}

function readTable_(key) {
  const def = SHEET_DEFS[key];
  const sh = sheet_(key);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const values = lastRow > 0 && lastCol > 0 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  const headers = values[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  const col = {};
  headers.forEach(function (h, i) { if (h && !(h in col)) col[h] = i; });
  def.headers.forEach(function (h) {
    if (!(h in col)) throw userErr_('[' + def.name + '] 탭에 [' + h + '] 칸이 없어요. 시트 메뉴 [내신 관리 → 시트 탭 만들기]를 다시 실행해 주세요.', 'SETUP');
  });
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(function (v) { return v === '' || v == null; })) continue;
    const obj = { _row: r + 1 };
    headers.forEach(function (h, i) { if (h && !(h in obj)) obj[h] = row[i]; });
    rows.push(obj);
  }
  return {
    sheet: sh,
    rows: rows,
    set: function (rowObj, header, value) {
      sh.getRange(rowObj._row, col[header] + 1).setValue(value);
      rowObj[header] = value;
    },
    append: function (obj) {
      sh.appendRow(headers.map(function (h) { return (h && h in obj) ? obj[h] : ''; }));
    }
  };
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw userErr_('지금 제출하는 사람이 많아요. 잠시 뒤 다시 눌러 주세요.', 'BUSY');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

/* ───────────── 날짜·기타 ───────────── */

function now_() { return new Date(); }

function todayKey_() { return Utilities.formatDate(now_(), CONFIG.TZ, 'yyyy-MM-dd'); }

function toMillis_(v) {
  if (v === '' || v == null) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (/^\d{10,}$/.test(String(v).trim())) return Number(String(v).trim());
  const t = Date.parse(String(v));
  return isNaN(t) ? 0 : t;
}

function submittedAt_(r) {
  const v = r['제출시각'];
  if (v instanceof Date) return v;
  const t = toMillis_(v);
  return t ? new Date(t) : new Date(0);
}

function submissionDate_(r) {
  const v = r['제출시각'];
  if (v instanceof Date || (v && !isNaN(Date.parse(String(v))))) {
    return Utilities.formatDate(submittedAt_(r), CONFIG.TZ, 'yyyy-MM-dd');
  }
  const d = r['날짜'];
  if (d instanceof Date) return Utilities.formatDate(d, CONFIG.TZ, 'yyyy-MM-dd');
  return String(d == null ? '' : d).trim();
}

function norm_(v) { return String(v == null ? '' : v).replace(/\s+/g, ''); }

/* ───────────── 시트 메뉴 (선생님만 씀) ───────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('내신 관리')
    .addItem('① 시트 탭 만들기 (처음 한 번)', 'menuSetup')
    .addItem('② 선생님 비밀번호 정하기', 'menuSetTeacherPassword')
    .addSeparator()
    .addItem('선택한 학생 비밀번호 0000으로 되돌리기', 'menuResetStudentPassword')
    .addItem('선택한 학생 잠금 풀기', 'menuUnlockStudent')
    .addSeparator()
    .addItem('서버 버전 보기', 'menuVersion')
    .addToUi();
}

function menuSetup() {
  setupSheets_();
  SpreadsheetApp.getUi().alert('탭을 만들었어요: 학생, 세트, 문항, 제출, 숙제검사, 설정\n\n다음: 메뉴 [내신 관리 → ② 선생님 비밀번호 정하기]');
}

function menuSetTeacherPassword() {
  const ui = SpreadsheetApp.getUi();
  const a = ui.prompt('선생님 비밀번호 정하기', CONFIG.MIN_TEACHER_PW + '자 이상으로 입력해 주세요. (입력한 글자가 화면에 보이니 주변을 확인하세요)', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  const b = ui.prompt('한 번 더 입력', '같은 비밀번호를 한 번 더 입력해 주세요.', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  if (a.getResponseText() !== b.getResponseText()) { ui.alert('두 번 입력한 비밀번호가 달라요. 다시 해 주세요.'); return; }
  try {
    setTeacherPassword_(a.getResponseText());
    ui.alert('선생님 비밀번호를 저장했어요. (시트에는 알아볼 수 없는 해시로만 저장돼요)');
  } catch (e) {
    ui.alert(e.message);
  }
}

function menuResetStudentPassword() {
  const ui = SpreadsheetApp.getUi();
  const rows = selectedStudentRows_();
  if (!rows) return;
  const ok = ui.alert('비밀번호 되돌리기', rows.names.join(', ') + '\n\n이 학생들의 비밀번호를 0000으로 되돌릴까요? (다음 로그인 때 새 비밀번호를 정하게 돼요)', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  resetStudentRows_(rows.rows);
  ui.alert('되돌렸어요.');
}

function menuUnlockStudent() {
  const ui = SpreadsheetApp.getUi();
  const rows = selectedStudentRows_();
  if (!rows) return;
  unlockStudentRows_(rows.rows);
  ui.alert('잠금을 풀었어요: ' + rows.names.join(', '));
}

function menuVersion() {
  SpreadsheetApp.getUi().alert('서버 버전: ' + SERVER_VERSION);
}

function selectedStudentRows_() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEET_DEFS.students.name) {
    ui.alert('[학생] 탭에서 학생 행을 선택한 다음 다시 눌러 주세요.');
    return null;
  }
  const range = sh.getActiveRange();
  const nums = [];
  for (let r = range.getRow(); r < range.getRow() + range.getNumRows(); r++) if (r >= 2) nums.push(r);
  const t = readTable_('students');
  const recs = t.rows.filter(function (x) { return nums.indexOf(x._row) >= 0; });
  if (!recs.length) { ui.alert('학생 행을 선택해 주세요.'); return null; }
  return { rows: recs.map(function (x) { return x._row; }), names: recs.map(function (x) { return String(x['이름']); }) };
}

/* 메뉴가 쓰는 기능 (테스트도 이 함수들을 씀) */

function setupSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_DEFS).forEach(function (key) {
    const def = SHEET_DEFS[key];
    const sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
    const lastCol = sh.getLastColumn();
    const existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h == null ? '' : h).trim(); }) : [];
    while (existing.length && !existing[existing.length - 1]) existing.pop();
    const headers = existing.slice();
    def.headers.concat(def.extra || []).forEach(function (h) { if (headers.indexOf(h) < 0) headers.push(h); });
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f1f3f5');
    sh.setFrozenRows(1);
    const maxRows = Math.max(sh.getMaxRows() - 1, 1);
    headers.forEach(function (h, i) {
      const cell = sh.getRange(1, i + 1);
      if (def.system && def.system.indexOf(h) >= 0) cell.setBackground('#e9ecef').setFontColor('#868e96');
      if (def.notes && def.notes[h]) cell.setNote(def.notes[h]);
      if (def.text && def.text.indexOf(h) >= 0) sh.getRange(2, i + 1, maxRows, 1).setNumberFormat('@');
    });
  });
  const st = readTable_('settings');
  const have = {};
  st.rows.forEach(function (r) { have[norm_(r['항목'])] = true; });
  [
    [TEACHER_KEYS.hash, '메뉴 [② 선생님 비밀번호 정하기]로 정해요. 직접 쓰지 마세요.'],
    [TEACHER_KEYS.salt, '자동'],
    [TEACHER_KEYS.fails, '자동'],
    [TEACHER_KEYS.lockUntil, '자동']
  ].forEach(function (pair) {
    if (!have[pair[0]]) st.append({ '항목': pair[0], '값': '', '설명': pair[1] });
  });
  ss.getSheets().forEach(function (sh) {
    const n = sh.getName();
    if ((n === '시트1' || n === 'Sheet1') && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

function setTeacherPassword_(pw) {
  pw = String(pw == null ? '' : pw);
  if (/\s/.test(pw)) throw userErr_('비밀번호에 띄어쓰기는 쓸 수 없어요.');
  if (pw.length < CONFIG.MIN_TEACHER_PW) throw userErr_('선생님 비밀번호는 ' + CONFIG.MIN_TEACHER_PW + '자 이상으로 정해 주세요.');
  withLock_(function () {
    const acc = teacherAcc_();
    const salt = newSalt_();
    acc.set('salt', salt);
    acc.set('hash', hashPassword_(pw, salt));
    acc.set('fails', 0);
    acc.set('lockUntil', '');
  });
}

function resetStudentRows_(rowNumbers) {
  withLock_(function () {
    const t = readTable_('students');
    t.rows.forEach(function (r) {
      if (rowNumbers.indexOf(r._row) < 0) return;
      ['비밀번호해시', '솔트', '실패횟수', '잠금해제시각'].forEach(function (h) { t.set(r, h, ''); });
    });
  });
}

function unlockStudentRows_(rowNumbers) {
  withLock_(function () {
    const t = readTable_('students');
    t.rows.forEach(function (r) {
      if (rowNumbers.indexOf(r._row) < 0) return;
      t.set(r, '실패횟수', '');
      t.set(r, '잠금해제시각', '');
    });
  });
}
