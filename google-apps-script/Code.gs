/**
 * 웹앱 배포용 예시 스크립트 (프로젝트 저장용).
 * 실제 시트는 스프레드시트에 붙여 넣어 사용하세요.
 *
 * 시트 열(1행 헤더 가정):
 * A nickname, B classCode, C level, D diag_score, E diag_time,
 * F problem, G type, H timestamp, I~P step1~step6(+5_1,5_2,5_3), Q total, R fail_count, S hint, T status, U ai
 *
 * 교사 클래스 목록: 시트 이름 "classes" (대소문자 무시 매칭)
 *   1행 헤더 예: teacherEmail | classCode | className | createdAt
 *
 * AI 피드백: 프로젝트 설정 → 스크립트 속성 → OPENAI_API_KEY (OpenAI API 키). 브라우저 .env에 두지 않음.
 */
/** R열(ai) 등에 쓰는 피드백 전체 길이 상한(셀당 약 5만자). 예전 500자 잘림 제거용. */
var AI_FEEDBACK_CELL_MAX_ = 50000;

function doPost(e) {
  var data = {};
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    Logger.log('doPost JSON parse error: ' + err);
    return jsonOut({ ok: false, error: 'invalid_json' });
  }

  if (data.action === 'generate_ai_feedback') {
    try {
      var feedbackText = generateAIFeedback_(data.data || {});
      return jsonResponse({ result: 'success', feedback: feedbackText });
    } catch (err2) {
      Logger.log('generate_ai_feedback: ' + err2);
      return jsonResponse({
        result: 'error',
        message: String(err2 && err2.message ? err2.message : err2),
      });
    }
  }
  if (data.action === 'create_class') {
    try {
      return jsonResponse(handleCreateClassPost_(data));
    } catch (err3) {
      Logger.log('create_class: ' + err3);
      return jsonResponse({
        result: 'error',
        message: String(err3 && err3.message ? err3.message : err3),
      });
    }
  }
  if (data.action === 'delete_class') {
    try {
      return jsonResponse(handleDeleteClassPost_(data));
    } catch (err4) {
      Logger.log('delete_class: ' + err4);
      return jsonResponse({
        result: 'error',
        message: String(err4 && err4.message ? err4.message : err4),
      });
    }
  }
  if (data.action === 'update_class') {
    try {
      return jsonResponse(handleUpdateClassPost_(data));
    } catch (err5) {
      Logger.log('update_class: ' + err5);
      return jsonResponse({
        result: 'error',
        message: String(err5 && err5.message ? err5.message : err5),
      });
    }
  }
  if (String(data.action || '').trim() === 'admin_problem_analysis') {
    try {
      var paResult = generateAdminProblemAnalysis_(data.data || {});
      if (paResult.ok && paResult.analysis) {
        return jsonResponse({
          result: 'success',
          ok: true,
          analysis: paResult.analysis,
        });
      }
      return jsonResponse({
        ok: false,
        result: 'error',
        message: paResult.message || 'admin_problem_analysis_failed',
      });
    } catch (errPa) {
      Logger.log('admin_problem_analysis: ' + errPa);
      return jsonResponse({
        ok: false,
        result: 'error',
        message: String(errPa && errPa.message ? errPa.message : errPa),
      });
    }
  }

  var actionStr = String(data.action || '').trim();
  if (actionStr) {
    return jsonResponse({
      result: 'error',
      message:
        '요청을 처리할 수 없습니다. Code.gs를 최신으로 저장한 뒤 웹앱을 「새 버전」으로 배포해 주세요. (action: ' +
        actionStr +
        ')',
    });
  }

  Logger.log(data);
  var diagScore =
    Object.prototype.hasOwnProperty.call(data, 'diag_score') &&
    Number.isFinite(Number(data.diag_score))
      ? Number(data.diag_score)
      : '';
  Logger.log(
    'diag_score(parsed)=' +
      diagScore +
      ' totalScore=' +
      data.totalScore +
      ' score=' +
      data.score +
      ' status=' +
      (data.status || '')
  );

  var sheet = getTargetSheet_();
  var row = buildRowFromPayload_(data);
  sheet.appendRow(row);

  return jsonOut({ ok: true });
}

/** doGet에서 사용 — `jsonOut`과 동일(JSON MIME). */
function jsonResponse(obj) {
  return jsonOut(obj);
}

/**
 * GET 동작 요약:
 * 1) ?nickname=만 있음(classCode 없음 또는 빈 문자열)
 *    → 해당 닉네임 행의 classCode 집합으로 resolvedClassCode / multipleClassCodes / found 반환
 * 2) ?nickname=&classCode=
 *    → 해당 학습자 행만 모아 { data: [...] } (프론트 parseProgressFromData 호환)
 * 3) ?action=class_roster&classCode=  → Sheet2에서 classCode 일치 행만, nickname별 집계 → { result, students }
 * 4) ?action=class_info&classCode=
 * 5) ?action=student_history&nickname=&classCode=  → 해당 학습자 **전체 시트 행** (step1~6 포함)
 * 6) ?action=class_problem_stats&classCode= → 수련완료 행만, 문제(F)×유형(G) 통계 + problems[] + records[]
 * 7) ?mode=classes&teacherEmail=…  → 관리자: Sheet1이 아닌 **classes** 시트만 조회
 * 8) ?action=teacher_classes&teacherEmail=…  → (호환) 위와 동일 데이터를 { ok, classes, rows } 형태로
 * 9) ?action=ai_feedback&payload=(base64 UTF-8 JSON)&callback=… — 수련 AI 피드백(JSON/JSONP). OPENAI_API_KEY는 스크립트 속성.
 */
function doGet(e) {
  var p = e && e.parameter ? e.parameter : {};
  var mode = String(p.mode || '')
    .trim()
    .toLowerCase();
  var actionRaw = String(p.action != null ? p.action : p.ACTION || '').trim();
  var action = actionRaw.toLowerCase();
  try {
    // ⭐ AI 피드백 JSONP 폴백
    if (action === 'ai_feedback') {
      var aiResult = handleAiFeedbackGet_(p);
      var cb = String(p.callback || '').trim();

      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(cb)) {
        return ContentService.createTextOutput(cb + '(' + JSON.stringify(aiResult) + ');')
          .setMimeType(ContentService.MimeType.TEXT);
      }

      return jsonResponse(aiResult);
    }
    if (action === 'teacher_classes') {
      return jsonOut(handleTeacherClassesGet_(p));
    }
    if (action === 'class_roster') {
      return jsonOut(handleClassRosterGet_(p));
    }
    if (action === 'class_info') {
      return jsonOut(handleClassInfoGet_(p));
    }
    if (action === 'student_history') {
      return jsonOut(handleStudentHistoryGet_(p));
    }
    if (action === 'class_problem_stats') {
      return jsonResponse(handleClassProblemStatsGet_(p));
    }
    if (action === 'create_class') {
      return jsonResponse(
        handleCreateClassPost_({
          teacherEmail: p.teacherEmail,
          classCode: p.classCode,
          className: p.className,
        })
      );
    }
    if (mode === 'classes') {
      return jsonOut(handleAdminClassesModeGet_(p));
    }

    var nick = String(p.nickname || '').trim();
    var ccRaw = p.classCode;
    var ccTrim =
      ccRaw !== undefined && ccRaw !== null ? String(ccRaw).trim() : '';
    var hasClassCode = ccTrim.length > 0;

    if (nick && !hasClassCode) {
      return jsonOut(lookupNicknameClassCode_(nick));
    }
    if (nick && hasClassCode) {
      return jsonOut(fetchStudentRowsForLearner_(nick, ccTrim));
    }

    return jsonOut({ ok: false, error: 'unsupported_or_missing_query' });
  } catch (err) {
    Logger.log('doGet error: ' + err);
    return jsonOut({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  }
}

/** Sheet2 1행 헤더 → 열 인덱스 (H timestamp = 7 기본) */
function getDefaultLearnerColMap_() {
  return {
    nickname: 0,
    classCode: 1,
    level: 2,
    diag_score: 3,
    diag_time: 4,
    problem: 5,
    type: 6,
    timestamp: 7,
    step1: 8,
    step2: 9,
    step3: 10,
    step4: 11,
    step5_1: 12,
    step5_2: 13,
    step5_3: 14,
    step6: 15,
    total: 16,
    fail_count: 17,
    hint: 18,
    status: 19,
    ai: 20,
  };
}

function normalizeSheetHeaderKey_(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '');
}

/**
 * 1행 헤더에서 timestamp·diag_time 등 열 위치 해석 (없으면 기본 A~U 매핑).
 * @param {Array} headerRow
 */
function getLearnerSheetColumnMap_(headerRow) {
  var map = getDefaultLearnerColMap_();
  if (!headerRow || !headerRow.length) {
    return map;
  }
  for (var c = 0; c < headerRow.length; c++) {
    var key = normalizeSheetHeaderKey_(headerRow[c]);
    if (!key) continue;
    if (key === 'nickname' || key === '닉네임') map.nickname = c;
    else if (key === 'classcode' || key === '클래스코드') map.classCode = c;
    else if (key === 'level' || key === '레벨') map.level = c;
    else if (key === 'diagscore' || key === '진단점수') map.diag_score = c;
    else if (key === 'diagtime' || key === '진단시간') map.diag_time = c;
    else if (key === 'problem' || key === '문제' || key === '문항') map.problem = c;
    else if (key === 'type' || key === '유형') map.type = c;
    else if (key === 'timestamp' || key === '시간' || key === '기록시각') map.timestamp = c;
    else if (key === 'step1') map.step1 = c;
    else if (key === 'step2') map.step2 = c;
    else if (key === 'step3') map.step3 = c;
    else if (key === 'step4') map.step4 = c;
    else if (key === 'step51' || key === 'step5_1' || key === 'step5') map.step5_1 = c;
    else if (key === 'step52' || key === 'step5_2') map.step5_2 = c;
    else if (key === 'step53' || key === 'step5_3') map.step5_3 = c;
    else if (key === 'step6') map.step6 = c;
    else if (key === 'total' || key === '점수') map.total = c;
    else if (key === 'hint' || key === '힌트') map.hint = c;
    else if (key === 'status' || key === '상태') map.status = c;
    else if (key === 'ai' || key === 'aifeedback' || key === '피드백') map.ai = c;
    else if (key === 'failcount' || key === 'fail_count') map.fail_count = c;
  }
  return map;
}

/** Google Sheets 날짜 직렬값(일 단위) → Date */
function sheetSerialToDate_(serial) {
  var n = Number(serial);
  if (!Number.isFinite(n) || n <= 20000 || n >= 120000) {
    return null;
  }
  var ms = Math.round((n - 25569) * 86400 * 1000);
  var d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

/** H/E열: getValues 빈칸일 때 getDisplayValues 문자열 보강 (기본 H=7 폴백) */
function readSheetTimestampCell_(row, displayRow, colIdx) {
  var idx = Number(colIdx);
  if (!Number.isFinite(idx) || idx < 0) {
    return '';
  }
  var out = readSheetTimestampCellAt_(row, displayRow, idx);
  if (out) {
    return out;
  }
  if (idx !== 7) {
    return readSheetTimestampCellAt_(row, displayRow, 7);
  }
  return '';
}

function readSheetTimestampCellAt_(row, displayRow, idx) {
  var raw = '';
  if (row && row.length > idx) {
    var v = row[idx];
    if (v !== undefined && v !== null && v !== '') {
      raw = v;
    } else if (v === 0) {
      raw = v;
    }
  }
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return formatLastActivity_(raw);
  }
  var serialDate = sheetSerialToDate_(raw);
  if (serialDate) {
    return formatLastActivity_(serialDate);
  }
  var rs = String(raw != null ? raw : '').trim();
  if (rs) {
    var ko = formatLastActivity_(raw);
    return ko || rs;
  }
  if (displayRow && displayRow.length > idx) {
    var disp = String(displayRow[idx] != null ? displayRow[idx] : '').trim();
    if (disp) {
      return formatLastActivity_(disp) || disp;
    }
  }
  return '';
}

/** JSON 응답용 — Date·시트 표기 문자열을 한국어 시각 문자열로 */
function formatTimestampFieldForJson_(v) {
  if (v === undefined || v === null || v === '') {
    return '';
  }
  if (v instanceof Date && !isNaN(v.getTime())) {
    return formatLastActivity_(v);
  }
  var serialDate = sheetSerialToDate_(v);
  if (serialDate) {
    return formatLastActivity_(serialDate);
  }
  var s = String(v).trim();
  if (!s) {
    return '';
  }
  var ko = formatLastActivity_(v);
  return ko || s;
}

/**
 * 시트 한 행(2행부터) → 객체.
 * 신규: I~P step1~step6(+5_1,5_2,5_3), Q total, R fail_count, S hint, T status, U ai
 * 레거시(열 16개 이하): I~N step1~step6(6칸), O total, …
 * @param {Array} row getValues() 행
 * @param {Array=} displayRow getDisplayValues() 행 (timestamp 보강)
 * @param {Object=} colMap getLearnerSheetColumnMap_
 */
function rowToRecord_(row, displayRow, colMap) {
  var col = colMap || getDefaultLearnerColMap_();
  function g(i) {
    if (!row || row.length <= i) return '';
    var v = row[i];
    if (v === undefined || v === null) return '';
    return v;
  }
  /** 8단계 열(total@16) 신규 레이아웃은 최소 21열(0~20) */
  var legacy = !row || row.length < 20;
  var s1;
  var s2;
  var s3;
  var s4;
  var s51;
  var s52;
  var s53;
  var s6;
  var totalIdx;
  var hintIdx;
  var statusIdx;
  var aiIdx;
  var failIdx;
  if (legacy) {
    s1 = g(8);
    s2 = g(9);
    s3 = g(10);
    s4 = g(11);
    s51 = g(12);
    s52 = '';
    s53 = '';
    s6 = g(13);
    totalIdx = 14;
    hintIdx = 15;
    statusIdx = 16;
    aiIdx = 17;
    failIdx = 18;
  } else {
    s1 = g(col.step1);
    s2 = g(col.step2);
    s3 = g(col.step3);
    s4 = g(col.step4);
    s51 = g(col.step5_1);
    s52 = g(col.step5_2);
    s53 = g(col.step5_3);
    s6 = g(col.step6);
    totalIdx = col.total;
    hintIdx = col.hint;
    statusIdx = col.status;
    aiIdx = col.ai;
    failIdx = col.fail_count;
  }
  return {
    nickname: String(g(col.nickname)).trim(),
    classCode: String(g(col.classCode)).trim(),
    level: String(g(col.level)),
    diag_score: g(col.diag_score),
    diag_time: readSheetTimestampCell_(row, displayRow, col.diag_time),
    problem: String(g(col.problem)),
    type: String(g(col.type)),
    timestamp: readSheetTimestampCell_(row, displayRow, col.timestamp),
    step1: s1,
    step2: s2,
    step3: s3,
    step4: s4,
    step5: s51,
    step5_1: s51,
    step5_2: s52,
    step5_3: s53,
    step6: s6,
    scores: [s1, s2, s3, s4, s51, s52, s53, s6],
    total: g(totalIdx),
    hint: g(hintIdx),
    totalHint: g(hintIdx),
    status: String(g(statusIdx)),
    ai: String(g(aiIdx)),
    fail_count: g(failIdx),
    failCount: g(failIdx),
  };
}

function getAllRecordsFromSheet_() {
  var sheet = getTargetSheet_();
  var range = sheet.getDataRange();
  var values = range.getValues();
  var displays = range.getDisplayValues();
  if (!values || values.length < 2) {
    return [];
  }
  var colMap = getLearnerSheetColumnMap_(values[0]);
  var out = [];
  for (var i = 1; i < values.length; i++) {
    out.push(rowToRecord_(values[i], displays[i], colMap));
  }
  return out;
}

/**
 * GET ?nickname=만 — classCode 후보 해석
 * @returns {{ found: boolean, resolvedClassCode?: string, multipleClassCodes: boolean }}
 */
function lookupNicknameClassCode_(nickname) {
  var nick = String(nickname || '').trim();
  if (!nick) {
    return { found: false, multipleClassCodes: false };
  }
  var all = getAllRecordsFromSheet_();
  var seen = {};
  var order = [];
  for (var i = 0; i < all.length; i++) {
    var r = all[i];
    if (String(r.nickname || '').trim() !== nick) {
      continue;
    }
    var cc = String(r.classCode || '').trim();
    if (!cc) {
      continue;
    }
    if (!seen[cc]) {
      seen[cc] = true;
      order.push(cc);
    }
  }
  if (order.length === 0) {
    return { found: false, multipleClassCodes: false };
  }
  if (order.length > 1) {
    return { found: true, multipleClassCodes: true };
  }
  return {
    found: true,
    multipleClassCodes: false,
    resolvedClassCode: order[0],
  };
}

/** GET ?nickname=&classCode= — 진단/수련 기록(프론트 flattenRecords·parseProgressFromData 호환) */
function fetchStudentRowsForLearner_(nickname, classCode) {
  var nick = String(nickname || '').trim();
  var cc = String(classCode || '').trim();
  var sheet = getTargetSheet_();
  var range = sheet.getDataRange();
  var values = range.getValues();
  var displays = range.getDisplayValues();
  if (!values || values.length < 2) {
    return {
      data: [],
      completedProblems: [],
      failedProblems: [],
      failedRecords: [],
    };
  }
  var colMap = getLearnerSheetColumnMap_(values[0]);
  var ccNorm = adminClassCodeNorm_(cc);
  var filtered = [];
  for (var rowIdx = 1; rowIdx < values.length; rowIdx++) {
    var r = rowToRecord_(values[rowIdx], displays[rowIdx], colMap);
    if (String(r.nickname || '').trim() !== nick) {
      continue;
    }
    if (adminClassCodeNorm_(r.classCode) !== ccNorm) {
      continue;
    }
    filtered.push(recordToAdminHistoryPayload_(r, rowIdx + 1));
  }
  var accum = accumulateProblemStatusFromRecords_(filtered);
  return {
    data: filtered,
    completedProblems: accum.completedProblems,
    failedProblems: accum.failedProblems,
    failedRecords: accum.failedRecords,
  };
}

/**
 * 관리자: GET ?action=student_history&nickname=&classCode=
 * 시트에 있는 해당 학습자 행을 **빠짐없이** records로 반환 (JSON은 Date → ISO 문자열).
 */
function adminHistoryRowTimeMs_(rec) {
  var t = rec.timestamp;
  if (t instanceof Date && !isNaN(t.getTime())) return t.getTime();
  var e = rec.diag_time;
  if (e instanceof Date && !isNaN(e.getTime())) return e.getTime();
  var s = String(t || '').trim();
  if (s) {
    var p = Date.parse(s);
    if (!isNaN(p)) return p;
  }
  var s2 = String(e || '').trim();
  if (s2) {
    var p2 = Date.parse(s2);
    if (!isNaN(p2)) return p2;
  }
  return 0;
}

/**
 * classCode 비교용 정규화 (소문자·trim). student_history 필터에 사용.
 */
function adminClassCodeNorm_(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

/**
 * I~N열(step1~step6) 값을 그대로 반환. 0·1 숫자 유지, 빈 칸만 ''.
 * rowToRecord_가 stepN·scores 둘 다 채우므로 둘 중 하나에서 읽음.
 */
function stepFromRecord_(r, index) {
  var keys = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6'];
  var key = keys[index];
  if (r && Object.prototype.hasOwnProperty.call(r, key)) {
    var d = r[key];
    if (d !== undefined && d !== null && d !== '') return d;
    if (d === 0) return 0;
  }
  var scores = r.scores || [];
  if (scores.length > index) {
    var v = scores[index];
    if (v !== undefined && v !== null && v !== '') return v;
    if (v === 0) return 0;
  }
  return '';
}

/** P열 hint (레거시 필드 totalHint 동일 열) */
function hintFromRecord_(r) {
  if (r.hint !== undefined && r.hint !== null && r.hint !== '') return r.hint;
  if (r.hint === 0) return 0;
  if (r.totalHint !== undefined && r.totalHint !== null && r.totalHint !== '') return r.totalHint;
  if (r.totalHint === 0) return 0;
  return '';
}

/**
 * student_history records 한 행. 필드 고정 (프론트·관리자 팝업과 맞춤).
 */
/**
 * 수련 행 전체에서 문항별 성공·실패 누적 (성공이 있으면 해당 문항은 completed만).
 * @param {Array.<Object>} records
 * @returns {{ completedProblems: string[], failedProblems: string[], failedRecords: Object[] }}
 */
function accumulateProblemStatusFromRecords_(records) {
  var completedSet = {};
  var failedSet = {};
  var failedRecords = [];
  var list = records || [];
  for (var i = 0; i < list.length; i++) {
    var rec = list[i];
    var prob = String(rec.problem || '').trim().toUpperCase();
    if (!/^\d+-[A-Z]$/.test(prob)) {
      continue;
    }
    var st = String(rec.status || '').trim();
    if (st === '성공' || st.toLowerCase() === 'success') {
      completedSet[prob] = true;
    } else if (st === '실패' || st.toLowerCase() === 'fail') {
      failedSet[prob] = true;
      failedRecords.push(rec);
    }
  }
  var completedProblems = Object.keys(completedSet).sort();
  var failedProblems = [];
  var failedKeys = Object.keys(failedSet);
  for (var j = 0; j < failedKeys.length; j++) {
    var code = failedKeys[j];
    if (!completedSet[code]) {
      failedProblems.push(code);
    }
  }
  failedProblems.sort();
  return {
    completedProblems: completedProblems,
    failedProblems: failedProblems,
    failedRecords: failedRecords,
  };
}

function recordToAdminHistoryPayload_(r, sheetRow1Based) {
  return {
    nickname: String(r.nickname || '').trim(),
    classCode: String(r.classCode || '').trim(),
    level: String(r.level || ''),
    diag_score: r.diag_score,
    diag_time: formatTimestampFieldForJson_(r.diag_time),
    problem: String(r.problem || ''),
    type: String(r.type || ''),
    timestamp: formatTimestampFieldForJson_(r.timestamp),
    step1: stepFromRecord_(r, 0),
    step2: stepFromRecord_(r, 1),
    step3: stepFromRecord_(r, 2),
    step4: stepFromRecord_(r, 3),
    step5: stepFromRecord_(r, 4),
    step5_1: r.step5_1 != null && r.step5_1 !== '' ? r.step5_1 : stepFromRecord_(r, 4),
    step5_2: r.step5_2 != null && r.step5_2 !== '' ? r.step5_2 : '',
    step5_3: r.step5_3 != null && r.step5_3 !== '' ? r.step5_3 : '',
    step6: r.step6 != null && r.step6 !== '' ? r.step6 : stepFromRecord_(r, 5),
    total: r.total,
    fail_count: r.fail_count != null && r.fail_count !== '' ? r.fail_count : r.failCount,
    hint: hintFromRecord_(r),
    status: String(r.status || ''),
    ai: String(r.ai || ''),
    sheetRow: sheetRow1Based,
  };
}

function handleStudentHistoryGet_(p) {
  var nick = String(p.nickname || '').trim();
  var cc = String(p.classCode || '').trim();
  var ccNorm = adminClassCodeNorm_(cc);
  if (!nick || !cc) {
    return { result: 'error', message: 'missing_nickname_or_classCode', records: [] };
  }
  var sheet = getTargetSheet_();
  var range = sheet.getDataRange();
  var values = range.getValues();
  var displays = range.getDisplayValues();
  if (!values || values.length < 2) {
    return { result: 'success', records: [] };
  }
  var colMap = getLearnerSheetColumnMap_(values[0]);
  var matchedRaw = [];
  for (var rowIdx = 1; rowIdx < values.length; rowIdx++) {
    var r = rowToRecord_(values[rowIdx], displays[rowIdx], colMap);
    if (String(r.nickname || '').trim() !== nick) {
      continue;
    }
    if (adminClassCodeNorm_(r.classCode) !== ccNorm) {
      continue;
    }
    matchedRaw.push({ r: r, sheetRow: rowIdx + 1 });
  }
  matchedRaw.sort(function (a, b) {
    var ta = adminHistoryRowTimeMs_(a.r);
    var tb = adminHistoryRowTimeMs_(b.r);
    if (ta !== tb) {
      return ta - tb;
    }
    return (Number(a.sheetRow) || 0) - (Number(b.sheetRow) || 0);
  });
  var matched = [];
  for (var m = 0; m < matchedRaw.length; m++) {
    matched.push(
      recordToAdminHistoryPayload_(matchedRaw[m].r, matchedRaw[m].sheetRow)
    );
  }
  var accum = accumulateProblemStatusFromRecords_(matched);
  return {
    result: 'success',
    records: matched,
    completedProblems: accum.completedProblems,
    failedProblems: accum.failedProblems,
    failedRecords: accum.failedRecords,
  };
}

function pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

/** Sheet H timestamp / E diag_time 등 → 표시용 (예: 2026. 5. 1 오후 3:20:10) */
function formatLastActivity_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return formatDateKoSeoul12h_(v);
  }
  var serialDate = sheetSerialToDate_(v);
  if (serialDate) {
    return formatDateKoSeoul12h_(serialDate);
  }
  var s = String(v != null ? v : '')
    .trim()
    .replace(/^["']|["']$/g, '');
  if (!s) {
    return '';
  }
  if (/^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\s*(오전|오후)\s*\d{1,2}:\d{2}:\d{2}$/.test(s)) {
    return s;
  }
  if (/^\d{10,13}$/.test(s)) {
    var n = Number(s);
    if (n >= 1e12) {
      return formatDateKoSeoul12h_(new Date(n));
    }
    if (n >= 1e9) {
      return formatDateKoSeoul12h_(new Date(n * 1000));
    }
  }
  var parsed = Date.parse(s);
  if (!isNaN(parsed)) {
    return formatDateKoSeoul12h_(new Date(parsed));
  }
  return s;
}

function formatDateKoSeoul12h_(d) {
  var tz = 'Asia/Seoul';
  var y = Utilities.formatDate(d, tz, 'yyyy');
  var mo = parseInt(Utilities.formatDate(d, tz, 'M'), 10);
  var day = parseInt(Utilities.formatDate(d, tz, 'd'), 10);
  var H = parseInt(Utilities.formatDate(d, tz, 'H'), 10);
  var min = parseInt(Utilities.formatDate(d, tz, 'm'), 10);
  var sec = parseInt(Utilities.formatDate(d, tz, 's'), 10);
  var ap = H < 12 ? '오전' : '오후';
  var h12 = H % 12;
  if (h12 === 0) h12 = 12;
  return y + '. ' + mo + '. ' + day + ' ' + ap + ' ' + h12 + ':' + pad2_(min) + ':' + pad2_(sec);
}

function activityMsForRecord_(r, stableIdx) {
  var t = r.timestamp;
  if (t instanceof Date && !isNaN(t.getTime())) return t.getTime();
  var e = r.diag_time;
  if (e instanceof Date && !isNaN(e.getTime())) return e.getTime();
  var s = String(t || '').trim();
  if (s) {
    var p = Date.parse(s);
    if (!isNaN(p)) return p;
  }
  var s2 = String(e || '').trim();
  if (s2) {
    var p2 = Date.parse(s2);
    if (!isNaN(p2)) return p2;
  }
  return stableIdx;
}

function formatStatusKo_(s) {
  var k = String(s || '').trim();
  if (k === '성공') return '성공';
  if (k === '실패') return '실패';
  if (k === 'training_completed' || k === 'completed' || k === '수련완료') return '수련완료';
  if (k === 'diagnostic_completed' || k === '진단완료') return '진단완료';
  if (k === 'in_progress') return '진행중';
  return k || '—';
}

function rowHasDiagnostic_(r) {
  var ds = Number(r.diag_score);
  if (Number.isFinite(ds) && ds > 0) return true;
  if (String(r.diag_time || '').trim()) return true;
  var st = String(r.status || '').trim();
  if (st === 'diagnostic_completed' || st === '진단완료') return true;
  return false;
}

/** 수련 시도 행 (성공·실패·레거시 수련완료) */
function isTrainingCompletedRowForStats_(r) {
  var raw = String(r && r.status != null ? r.status : '').trim();
  if (!raw) return false;
  if (raw === '성공' || raw === '실패') return true;
  var lo = raw.toLowerCase();
  if (lo === 'training_completed' || lo === 'completed') return true;
  var compactKo = raw.replace(/\s+/g, '');
  if (compactKo === '수련완료') return true;
  return false;
}

function hintNumericFromRow_(r) {
  var raw = r.hint != null && r.hint !== '' ? r.hint : r.totalHint;
  var n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTrainingKind_(raw) {
  var t = String(raw || '').trim().replace(/\s+/g, '');
  if (t === '본문제') return '본문제';
  if (t === '유사문제1') return '유사문제1';
  return t;
}

function isTrainingSuccessStatusRow_(r) {
  var st = String(r && r.status != null ? r.status : '').trim();
  return st === '성공' || st.toLowerCase() === 'success';
}

function isTrainingFailStatusRow_(r) {
  var st = String(r && r.status != null ? r.status : '').trim();
  return st === '실패' || st.toLowerCase() === 'fail';
}

function isTrainingHistoryRowForSummary_(r) {
  var st = String(r && r.status != null ? r.status : '').trim();
  if (st === '진단완료' || st === 'diagnostic_completed') return false;
  return true;
}

function problemCodeNormForSummary_(r) {
  var prob = String(r.problem || '').trim().toUpperCase();
  return /^\d+-[A-Z]$/.test(prob) ? prob : '';
}

/**
 * nickname별 items({r, idx})에서 수련 요약 집계 (진단완료 행 제외).
 * @param {Array.<{r: Object, idx: number}>} items
 */
function summarizeStudentTrainingMetricsFromItems_(items) {
  var mainSuccess = {};
  var mainFail = {};
  var simSuccess = {};
  var simFail = {};
  var trainingRows = [];
  var list = items || [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i].r;
    if (!isTrainingHistoryRowForSummary_(r)) continue;
    var prob = problemCodeNormForSummary_(r);
    if (!prob) continue;
    trainingRows.push(r);
    var kind = normalizeTrainingKind_(r.type);
    if (kind === '본문제') {
      if (isTrainingSuccessStatusRow_(r)) mainSuccess[prob] = true;
      if (isTrainingFailStatusRow_(r)) mainFail[prob] = true;
    } else if (kind === '유사문제1') {
      if (isTrainingSuccessStatusRow_(r)) simSuccess[prob] = true;
      if (isTrainingFailStatusRow_(r)) simFail[prob] = true;
    }
  }
  var accum = accumulateProblemStatusFromRecords_(trainingRows);
  return {
    mainSuccessCount: Object.keys(mainSuccess).length,
    mainFailCount: Object.keys(mainFail).length,
    similarSuccessCount: Object.keys(simSuccess).length,
    similarFailCount: Object.keys(simFail).length,
    mathCardCount: accum.completedProblems.length,
  };
}

/** 유형 열(G) 표시 순서: 본문제 → 유사문제1 → 유사문제2 → 기타 */
function trainingTypeSortKey_(typeLabel) {
  var t = String(typeLabel || '').trim();
  if (t === '본문제') return 0;
  if (t === '유사문제1') return 1;
  if (t === '유사문제2') return 2;
  return 100;
}

/**
 * GET ?action=class_problem_stats&classCode=
 * 수련완료 행만, problem(F)×type(G) 단위 통계 + 원시 records + 문제 목록.
 */
function handleClassProblemStatsGet_(p) {
  var cc = String(p.classCode || '').trim();
  var ccNorm = adminClassCodeNorm_(cc);
  if (!ccNorm) {
    return { result: 'error', message: 'missing_classCode', stats: [], records: [], problems: [] };
  }
  var all = getAllRecordsFromSheet_();
  var groupMap = {};
  var records = [];

  for (var i = 0; i < all.length; i++) {
    var r = all[i];
    if (adminClassCodeNorm_(r.classCode) !== ccNorm) {
      continue;
    }
    if (!isTrainingCompletedRowForStats_(r)) {
      continue;
    }
    var prob = String(r.problem || '').trim();
    if (!prob) {
      continue;
    }
    var typeLabel = String(r.type || '').trim();
    if (!typeLabel) {
      typeLabel = '미분류';
    }
    var nick = String(r.nickname || '').trim();
    var gk = prob + '\t' + typeLabel;

    records.push({
      nickname: nick,
      problem: prob,
      type: typeLabel,
      total: r.total,
      hint: hintNumericFromRow_(r),
      status: String(r.status || '').trim(),
    });

    if (!groupMap[gk]) {
      groupMap[gk] = {
        problem: prob,
        type: typeLabel,
        participants: {},
        sumTotal: 0,
        sumHint: 0,
        validN: 0,
        failN: 0,
      };
    }
    var G = groupMap[gk];
    if (nick) {
      G.participants[nick] = true;
    }
    var t = Number(r.total);
    if (Number.isFinite(t)) {
      G.sumTotal += t;
      G.validN += 1;
      if (t < 5) {
        G.failN += 1;
      }
      G.sumHint += hintNumericFromRow_(r);
    }
  }

  var keys = Object.keys(groupMap);
  keys.sort(function (a, b) {
    var A = groupMap[a];
    var B = groupMap[b];
    var cp = String(A.problem).localeCompare(String(B.problem), 'ko', { numeric: true });
    if (cp !== 0) return cp;
    var oa = trainingTypeSortKey_(A.type);
    var ob = trainingTypeSortKey_(B.type);
    if (oa !== ob) return oa - ob;
    return String(A.type).localeCompare(String(B.type), 'ko');
  });

  var stats = [];
  var probSet = {};
  for (var j = 0; j < keys.length; j++) {
    var G2 = groupMap[keys[j]];
    probSet[G2.problem] = true;
    var vn = G2.validN;
    var pc = Object.keys(G2.participants).length;
    stats.push({
      problem: G2.problem,
      type: G2.type,
      participantCount: pc,
      avgTotal: vn > 0 ? G2.sumTotal / vn : 0,
      failRate: vn > 0 ? G2.failN / vn : 0,
      avgHint: vn > 0 ? G2.sumHint / vn : 0,
      recordCount: vn,
    });
  }

  var problems = Object.keys(probSet);
  problems.sort(function (a, b) {
    return String(a).localeCompare(String(b), 'ko', { numeric: true });
  });

  return { result: 'success', stats: stats, records: records, problems: problems };
}

/**
 * 관리자 목록용 레벨: 최신 행이 수련완료여도, 진단완료 행의 level을 유지한다.
 * items는 활동 시각 내림차순(최신이 앞).
 * 순서: (1) 가장 최근 진단완료 행의 level (2) 아무 행이나 최신순으로 비어 있지 않은 level (3) latest.level
 */
function isDiagnosticCompleteStatusRow_(r) {
  var st = String(r && r.status != null ? r.status : '')
    .trim();
  return st === 'diagnostic_completed' || st === '진단완료';
}

function pickClassRosterLevel_(items, latest) {
  if (!items || !items.length) {
    return String((latest && latest.level) || '')
      .trim();
  }
  var d;
  for (var i = 0; i < items.length; i++) {
    if (isDiagnosticCompleteStatusRow_(items[i].r)) {
      d = String((items[i].r && items[i].r.level) || '')
        .trim();
      break;
    }
  }
  if (d) {
    return d;
  }
  for (var j = 0; j < items.length; j++) {
    var saved = String((items[j].r && items[j].r.level) || '')
      .trim();
    if (saved) {
      return saved;
    }
  }
  return String((latest && latest.level) || '')
    .trim();
}

/** GET ?action=class_roster&classCode= — Sheet2, nickname별 집계 */
function handleClassRosterGet_(p) {
  var code = String(p.classCode || '').trim();
  if (!code) {
    return { result: 'error', message: 'missing_classCode', students: [] };
  }
  var all = getAllRecordsFromSheet_();
  var grouped = {};
  for (var i = 0; i < all.length; i++) {
    var r = all[i];
    if (String(r.classCode || '').trim() !== code) {
      continue;
    }
    var n = String(r.nickname || '').trim();
    if (!n) {
      continue;
    }
    if (!grouped[n]) {
      grouped[n] = [];
    }
    grouped[n].push({ r: r, idx: i });
  }
  function cmpDesc_(a, b) {
    var ma = activityMsForRecord_(a.r, a.idx);
    var mb = activityMsForRecord_(b.r, b.idx);
    if (mb !== ma) {
      return mb - ma;
    }
    return b.idx - a.idx;
  }
  var nickKeys = Object.keys(grouped);
  var summaries = [];
  for (var j = 0; j < nickKeys.length; j++) {
    var nick = nickKeys[j];
    var items = grouped[nick].slice();
    items.sort(cmpDesc_);
    var latest = items[0].r;
    var bestDiagScore = -Infinity;
    var hasDiag = false;
    for (var k = 0; k < items.length; k++) {
      var rr = items[k].r;
      if (rowHasDiagnostic_(rr)) {
        hasDiag = true;
      }
      var ds = Number(rr.diag_score);
      if (Number.isFinite(ds) && ds > bestDiagScore) {
        bestDiagScore = ds;
      }
    }
    var diagOut = 0;
    if (bestDiagScore > -Infinity && Number.isFinite(bestDiagScore)) {
      diagOut = Math.round(bestDiagScore);
    }
    var levelOut = pickClassRosterLevel_(items, latest);
    var tot = Number(latest.total);
    var latestTotalOut = Number.isFinite(tot) ? tot : 0;
    var lastMs = activityMsForRecord_(latest, items[0].idx);
    var lastAct = formatLastActivity_(latest.timestamp);
    if (!lastAct && latest.diag_time) {
      lastAct = formatLastActivity_(latest.diag_time);
    }
    for (var la = 0; la < items.length; la++) {
      var msLa = activityMsForRecord_(items[la].r, items[la].idx);
      if (msLa > lastMs) {
        lastMs = msLa;
        var rLa = items[la].r;
        var actLa = formatLastActivity_(rLa.timestamp);
        if (!actLa && rLa.diag_time) {
          actLa = formatLastActivity_(rLa.diag_time);
        }
        if (actLa) lastAct = actLa;
      }
    }
    var metrics = summarizeStudentTrainingMetricsFromItems_(items);
    summaries.push({
      sortMs: lastMs,
      row: {
        nickname: nick,
        level: levelOut,
        diag_score: diagOut,
        hasDiagnosticResult: hasDiag,
        latestProblem: String(latest.problem || '').trim(),
        latestType: String(latest.type || '').trim(),
        latestTotal: latestTotalOut,
        latestStatus: formatStatusKo_(latest.status),
        lastActivity: lastAct,
        mainSuccessCount: metrics.mainSuccessCount,
        mainFailCount: metrics.mainFailCount,
        similarSuccessCount: metrics.similarSuccessCount,
        similarFailCount: metrics.similarFailCount,
        mathCardCount: metrics.mathCardCount,
      },
    });
  }
  summaries.sort(function (a, b) {
    return b.sortMs - a.sortMs;
  });
  var students = [];
  for (var s = 0; s < summaries.length; s++) {
    students.push(summaries[s].row);
  }
  return { result: 'success', students: students };
}

function handleClassInfoGet_(p) {
  var code = String(p.classCode || '').trim();
  return {
    ok: true,
    data: {
      courseTitle: code ? '반 코드 ' + code : '나의 클래스',
      classCode: code,
      teacherName: '',
      subtitle: '',
      eyebrow: '나의 클래스',
    },
  };
}

/**
 * "classes" 시트 (이름 대소문자 무시).
 * 헤더 예: teacherEmail | classCode | className | createdAt
 */
function getClassesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('classes');
  if (sh) return sh;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getName() || '').toLowerCase() === 'classes') {
      return sheets[i];
    }
  }
  return null;
}

function normalizeHeaderKeyClasses_(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '');
}

/** 비교용 이메일: 공백·제로폭·NBSP 제거, 소문자, Gmail 로컬부 점 제거 */
function normalizeEmailForCompareClasses_(raw) {
  var s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00a0/g, '')
    .trim();
  var at = s.indexOf('@');
  if (at > 0 && s.slice(at + 1) === 'gmail.com') {
    var local = s.slice(0, at).replace(/\./g, '');
    return local + '@gmail.com';
  }
  return s;
}

/** createdAt 등 빈 열 때문에 짧은 행도 안전하게 읽기 */
function padSheetRow_(row, minLen) {
  var out = [];
  var n = Math.max(minLen, row ? row.length : 0);
  for (var i = 0; i < n; i++) {
    out.push(i < row.length && row[i] !== undefined && row[i] !== null ? row[i] : '');
  }
  return out;
}

/** 헤더로 열 인덱스 결정. 기본: A teacherEmail, B classCode, C className (createdAt 비어 있어도 무관) */
function resolveClassesSheetColumns_(header) {
  var map = {};
  for (var c = 0; c < header.length; c++) {
    var k = normalizeHeaderKeyClasses_(header[c]);
    if (k) map[k] = c;
  }
  function idx(keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      if (map.hasOwnProperty(keys[i])) return map[keys[i]];
    }
    return fallback;
  }
  return {
    iTeacher: idx(
      ['teacheremail', 'teacher_email', '이메일', '교사이메일', '선생님이메일'],
      0
    ),
    iCode: idx(['classcode', 'class_code', '클래스코드', '반코드'], 1),
    iName: idx(
      ['classname', 'class_name', 'displayname', 'name', '클래스명', '과목명', '수업명'],
      2
    ),
    iCreated: idx(['createdat', 'created_at', '생성일', '만든일'], 3),
  };
}

/**
 * classes 시트만 읽어 교사 이메일이 일치하는 행 반환 (Sheet1 미사용).
 * @returns {{ rows: Array, matched: Array<{teacherEmail, classCode, className, createdAt}> }}
 */
function readClassesSheetForTeacher_(loginEmail) {
  var sh = getClassesSheet_();
  if (!sh) {
    Logger.log('[classes_sheet] no sheet named classes');
    return { rows: [], matched: [] };
  }
  var values = sh.getDataRange().getValues();
  if (!values || values.length < 1) {
    Logger.log('[classes_sheet] empty');
    return { rows: [], matched: [] };
  }

  var headerRow = values[0];
  var firstCell = String(headerRow[0] != null ? headerRow[0] : '').trim();
  var header;
  var startRow;
  if (firstCell.indexOf('@') !== -1) {
    header = ['teacherEmail', 'classCode', 'className', 'createdAt'];
    startRow = 0;
    Logger.log('[classes_sheet] row0 has @; data starts row0, synthetic header');
  } else {
    header = headerRow;
    startRow = 1;
    if (values.length < 2) {
      return { rows: [], matched: [] };
    }
  }

  var col = resolveClassesSheetColumns_(header);
  var iTeacher = col.iTeacher;
  var iCode = col.iCode;
  var iName = col.iName;
  var iCreated = col.iCreated;
  var minWidth = Math.max(
    header.length,
    iTeacher + 1,
    iCode + 1,
    iName + 1,
    iCreated + 1,
    4
  );

  var rows = [];
  var matched = [];
  for (var r = startRow; r < values.length; r++) {
    var row = padSheetRow_(values[r], minWidth);
    var rawTeacher = String(row[iTeacher] != null ? row[iTeacher] : '').trim();
    var rowTeacherNorm = normalizeEmailForCompareClasses_(rawTeacher);
    var code = String(row[iCode] != null ? row[iCode] : '').trim();
    var classNameCell = row[iName];
    var className = '';
    if (classNameCell instanceof Date && !isNaN(classNameCell.getTime())) {
      // 기존에 "1-1" 같은 클래스명이 날짜로 자동 변환된 경우 표시 보정
      className = Utilities.formatDate(classNameCell, 'Asia/Seoul', 'M-d');
    } else {
      className = String(classNameCell != null ? classNameCell : '').trim();
    }
    className = className || code;
    var createdAt = String(row[iCreated] != null ? row[iCreated] : '').trim();

    rows.push({
      teacherEmail: rawTeacher,
      classCode: code,
      className: className,
      createdAt: createdAt,
    });

    if (code && rowTeacherNorm === loginEmail) {
      matched.push({
        teacherEmail: rawTeacher,
        classCode: code,
        className: className,
        createdAt: createdAt,
      });
    }
  }

  Logger.log(
    '[classes_sheet] loginNorm=' +
      loginEmail +
      ' matched=' +
      matched.length +
      ' scanned=' +
      rows.length
  );
  return { rows: rows, matched: matched };
}

function getOrCreateClassesSheet_() {
  var sh = getClassesSheet_();
  if (sh) {
    var values = sh.getDataRange().getValues();
    if (!values || values.length === 0) {
      sh.getRange(1, 1, 1, 4).setValues([['teacherEmail', 'classCode', 'className', 'createdAt']]);
    }
    return sh;
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var created = ss.insertSheet('classes');
  created.getRange(1, 1, 1, 4).setValues([['teacherEmail', 'classCode', 'className', 'createdAt']]);
  return created;
}

function handleCreateClassPost_(data) {
  var teacherEmailRaw = String(data.teacherEmail || '').trim();
  var classCode = String(data.classCode || '').trim().toUpperCase();
  var className = String(data.className || '').trim();
  var teacherEmailNorm = normalizeEmailForCompareClasses_(teacherEmailRaw);
  if (!teacherEmailNorm || !classCode || !className) {
    return {
      result: 'error',
      message: 'missing_teacherEmail_or_classCode_or_className',
    };
  }

  var sh = getOrCreateClassesSheet_();
  var values = sh.getDataRange().getValues();
  var hasHeader = values && values.length > 0;
  var startRow = hasHeader ? 1 : 0;
  for (var i = startRow; i < values.length; i++) {
    var row = padSheetRow_(values[i], 4);
    var rowEmailRaw = String(row[0] != null ? row[0] : '').trim();
    var rowCode = String(row[1] != null ? row[1] : '')
      .trim()
      .toUpperCase();
    if (normalizeEmailForCompareClasses_(rowEmailRaw) === teacherEmailNorm && rowCode === classCode) {
      return {
        result: 'exists',
        message: '이미 같은 클래스 코드가 등록되어 있습니다.',
        class: {
          teacherEmail: rowEmailRaw || teacherEmailRaw,
          classCode: rowCode,
          className: String(row[2] != null ? row[2] : '').trim() || className,
          createdAt: String(row[3] != null ? row[3] : '').trim(),
        },
      };
    }
  }

  var createdAt = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  var nextRow = sh.getLastRow() + 1;
  // className(C열)은 텍스트 강제(예: 1-1이 날짜로 바뀌는 것 방지)
  sh.getRange(nextRow, 3).setNumberFormat('@');
  sh.getRange(nextRow, 1, 1, 4).setValues([[teacherEmailRaw, classCode, className, createdAt]]);
  return {
    result: 'success',
    class: {
      teacherEmail: teacherEmailRaw,
      classCode: classCode,
      className: className,
      createdAt: createdAt,
    },
  };
}

function handleDeleteClassPost_(data) {
  var teacherEmailRaw = String(data.teacherEmail || '').trim();
  var classCode = String(data.classCode || '').trim().toUpperCase();
  var teacherEmailNorm = normalizeEmailForCompareClasses_(teacherEmailRaw);
  if (!teacherEmailNorm || !classCode) {
    return {
      result: 'error',
      message: 'missing_teacherEmail_or_classCode',
    };
  }

  var sh = getOrCreateClassesSheet_();
  var values = sh.getDataRange().getValues();
  if (!values || values.length < 2) {
    return { result: 'not_found', message: '삭제할 클래스가 없습니다.' };
  }

  for (var i = 1; i < values.length; i++) {
    var row = padSheetRow_(values[i], 4);
    var rowEmailRaw = String(row[0] != null ? row[0] : '').trim();
    var rowCode = String(row[1] != null ? row[1] : '').trim().toUpperCase();
    if (normalizeEmailForCompareClasses_(rowEmailRaw) === teacherEmailNorm && rowCode === classCode) {
      sh.deleteRow(i + 1); // values는 0-index, 시트는 1-index + header
      return { result: 'success' };
    }
  }
  return { result: 'not_found', message: '해당 클래스 코드를 찾지 못했습니다.' };
}

/** POST action=update_class — className(C열)만 변경, classCode는 유지 */
function handleUpdateClassPost_(data) {
  var teacherEmailRaw = String(data.teacherEmail || '').trim();
  var classCode = String(data.classCode || '').trim().toUpperCase();
  var className = String(data.className || '').trim();
  var teacherEmailNorm = normalizeEmailForCompareClasses_(teacherEmailRaw);
  if (!teacherEmailNorm || !classCode || !className) {
    return {
      result: 'error',
      message: 'missing_teacherEmail_or_classCode_or_className',
    };
  }

  var sh = getOrCreateClassesSheet_();
  var values = sh.getDataRange().getValues();
  if (!values || values.length < 2) {
    return { result: 'not_found', message: '수정할 클래스가 없습니다.' };
  }

  for (var i = 1; i < values.length; i++) {
    var row = padSheetRow_(values[i], 4);
    var rowEmailRaw = String(row[0] != null ? row[0] : '').trim();
    var rowCode = String(row[1] != null ? row[1] : '').trim().toUpperCase();
    if (normalizeEmailForCompareClasses_(rowEmailRaw) === teacherEmailNorm && rowCode === classCode) {
      var sheetRow = i + 1;
      sh.getRange(sheetRow, 3).setNumberFormat('@');
      sh.getRange(sheetRow, 3).setValue(className);
      return {
        result: 'success',
        class: {
          teacherEmail: rowEmailRaw || teacherEmailRaw,
          classCode: rowCode,
          className: className,
          createdAt: String(row[3] != null ? row[3] : '').trim(),
        },
      };
    }
  }
  return { result: 'not_found', message: '해당 클래스 코드를 찾지 못했습니다.' };
}

/** 관리자: GET ?mode=classes&teacherEmail=… */
function handleAdminClassesModeGet_(p) {
  var loginEmailRaw = String(p.teacherEmail || '').trim();
  var loginEmail = normalizeEmailForCompareClasses_(loginEmailRaw);
  if (!loginEmail) {
    return { result: 'error', message: 'missing_teacherEmail', classes: [] };
  }
  var pack = readClassesSheetForTeacher_(loginEmail);
  var list = [];
  for (var i = 0; i < pack.matched.length; i++) {
    var m = pack.matched[i];
    list.push({
      teacherEmail: m.teacherEmail,
      classCode: m.classCode,
      className: m.className,
      createdAt: m.createdAt != null && m.createdAt !== undefined ? String(m.createdAt) : '',
    });
  }
  return { result: 'success', classes: list };
}

function handleTeacherClassesGet_(p) {
  var loginEmailRaw = String(p.teacherEmail || '').trim();
  var loginEmail = normalizeEmailForCompareClasses_(loginEmailRaw);
  if (!loginEmail) {
    return { ok: false, error: 'missing_teacherEmail', classes: [], rows: [] };
  }
  var pack = readClassesSheetForTeacher_(loginEmail);
  var out = [];
  for (var j = 0; j < pack.matched.length; j++) {
    var m = pack.matched[j];
    out.push({
      teacherEmail: m.teacherEmail,
      displayName: m.className,
      classCode: m.classCode,
      className: m.className,
    });
  }
  return { ok: true, classes: out, rows: pack.rows };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * GET action=ai_feedback — JSONP. payload=Base64(UTF-8 JSON)에 문제 본문·단계별 답 포함(v:2).
 * Script Properties: OPENAI_API_KEY (없으면 맥락 반영 규칙 템플릿).
 */
function handleAiFeedbackGet_(p) {
  try {
    var raw = String(p.payload != null ? p.payload : '').trim();
    if (raw) {
      try {
        var jsonStr0 = Utilities.newBlob(Utilities.base64Decode(raw)).getDataAsString('UTF-8');
        var ob0 = JSON.parse(jsonStr0);
        if (
          (ob0.v === 4 && ob0.analysis) ||
          (ob0.analysis && typeof ob0.analysis === 'object') ||
          (ob0.problemMeta && Array.isArray(ob0.steps))
        ) {
          var textV3 = generateAIFeedback_(ob0);
          return { ok: true, feedback: textV3 };
        }
      } catch (e0) {
        Logger.log('handleAiFeedbackGet_ v3 decode: ' + e0);
      }
    }
    var ctx = parseAiFeedbackContextFromParams_(p);
    var text = generateTrainingAiFeedback_(ctx);
    return { ok: true, feedback: text };
  } catch (err) {
    Logger.log('handleAiFeedbackGet_: ' + err);
    var ctx2 = parseAiFeedbackContextFromParams_(p);
    return { ok: true, feedback: templateTrainingAiFeedbackFromContext_(ctx2) };
  }
}

/** @returns {object} normalized context */
function parseAiFeedbackContextFromParams_(p) {
  var raw = String(p.payload != null ? p.payload : '').trim();
  if (raw) {
    try {
      var jsonStr = Utilities.newBlob(Utilities.base64Decode(raw)).getDataAsString('UTF-8');
      var ob = JSON.parse(jsonStr);
      return normalizeAiFeedbackContext_(ob);
    } catch (e1) {
      Logger.log('parseAiFeedbackContextFromParams_ payload decode: ' + e1);
    }
  }
  return legacyAiFeedbackContextFromQuery_(p);
}

function normalizeAiFeedbackContext_(ob) {
  var stepsIn = ob.steps;
  var steps = [];
  if (Array.isArray(stepsIn)) {
    for (var i = 0; i < stepsIn.length; i += 1) {
      var s = stepsIn[i] || {};
      var sn = Number(s.stepNumber);
      if (!Number.isFinite(sn) || sn < 1 || sn > 6) continue;
      steps.push({
        stepNumber: sn,
        meaning: String(s.meaning != null ? s.meaning : '').trim(),
        success: Boolean(
          Object.prototype.hasOwnProperty.call(s, 'success') ? s.success : s.isCorrect
        ),
        label: String(s.label != null ? s.label : '').trim(),
        questionPreview: String(s.questionPreview != null ? s.questionPreview : '').trim(),
        studentAnswer: String(s.studentAnswer != null ? s.studentAnswer : '').trim(),
        correctAnswer: String(s.correctAnswer != null ? s.correctAnswer : '').trim(),
      });
    }
  }
  steps.sort(function (a, b) {
    return (Number(a.stepNumber) || 0) - (Number(b.stepNumber) || 0);
  });

  var total = Number(ob.total);
  if (!Number.isFinite(total)) total = 0;
  var hint = Number(ob.hint);
  if (!Number.isFinite(hint)) hint = 0;

  return {
    v: Number(ob.v) || 2,
    problem: String(ob.problem != null ? ob.problem : '').trim(),
    trainingType: String(
      ob.trainingType != null && ob.trainingType !== ''
        ? ob.trainingType
        : ob.type != null
          ? ob.type
          : ''
    ).trim(),
    problemText: String(ob.problemText != null ? ob.problemText : '').trim(),
    total: total,
    hint: hint,
    steps: steps,
  };
}

function legacyAiFeedbackContextFromQuery_(p) {
  var bin = [];
  var j;
  for (j = 0; j < 6; j += 1) {
    var key = 'step' + (j + 1);
    var v = p[key];
    var n = Number(v);
    bin.push(Number.isFinite(n) && n >= 1 ? 1 : 0);
  }
  var meanings = [
    '무엇을 구하는지 파악',
    '미지수 설정',
    '문제 상황을 식으로 표현',
    '방정식 세우기',
    '방정식 풀이',
    '구한 값을 문제 상황에 맞게 해석',
  ];
  var steps = [];
  for (j = 0; j < 6; j += 1) {
    steps.push({
      stepNumber: j + 1,
      meaning: meanings[j],
      success: bin[j] === 1,
      label: '',
      questionPreview: '',
      studentAnswer: '',
      correctAnswer: '',
    });
  }
  var total = Number(p.total);
  if (!Number.isFinite(total)) total = 0;
  var hint = Number(p.hint);
  if (!Number.isFinite(hint)) hint = 0;
  return {
    v: 1,
    problem: String(p.problem != null ? p.problem : '').trim(),
    trainingType: String(
      p.trainingType != null && p.trainingType !== '' ? p.trainingType : p.type != null ? p.type : ''
    ).trim(),
    problemText: '',
    total: total,
    hint: hint,
    steps: steps,
  };
}

function buildOpenAiUserContent_(ctx) {
  var lines = [];
  lines.push(
    '다음은 중학교 1학년 학생의 일차방정식 문장제 문제 풀이 결과입니다. 학생의 성공 단계와 실패 단계를 바탕으로 구체적인 피드백을 작성해주세요.'
  );
  lines.push(
    '단, 정답을 그대로 알려주기보다 어떤 사고 과정을 보완하면 좋은지 안내해주세요. 문제 본문의 맥락(상황·단위·대상 등)을 피드백 안에 짧게 녹여 주세요.'
  );
  lines.push('');
  lines.push('[문항 코드] ' + (ctx.problem || '—'));
  lines.push('[유형] ' + (ctx.trainingType || '—'));
  lines.push('[문제 본문]');
  lines.push(ctx.problemText ? ctx.problemText : '(본문 없음)');
  lines.push('');
  lines.push('[단계 의미 안내]');
  lines.push('1/6: 무엇을 구하는지 파악');
  lines.push('2/6: 미지수 설정');
  lines.push('3/6: 문제 상황을 식으로 표현');
  lines.push('4/6: 방정식 세우기');
  lines.push('5/6: 방정식 풀이');
  lines.push('6/6: 구한 값을 문제 상황에 맞게 해석');
  lines.push('');
  lines.push('[단계별 결과·학생 답·참고 정답]');
  var k;
  for (k = 0; k < ctx.steps.length; k += 1) {
    var st = ctx.steps[k];
    var tag = st.stepNumber + '/6';
    var okTxt = st.success ? '성공' : '실패';
    lines.push(
      '- ' +
        tag +
        ' (' +
        (st.meaning || '단계') +
        ') : ' +
        okTxt
    );
    if (st.questionPreview) {
      lines.push('  · 비계 질문 요약: ' + st.questionPreview);
    }
    if (st.studentAnswer) {
      lines.push('  · 학생 답: ' + st.studentAnswer);
    }
    if (st.correctAnswer && String(st.correctAnswer).indexOf('정답 정보 없음') === -1) {
      lines.push('  · 참고 정답: ' + st.correctAnswer);
    }
  }
  lines.push('');
  lines.push('[요약] total=' + ctx.total + ' (성공한 단계 개수), 힌트 사용=' + ctx.hint + '회');
  return lines.join('\n');
}

function getOpenAiApiKey_() {
  return (
    PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || ''
  ).trim();
}

/** @returns {string[]} */
function getFeedbackBannedPhraseList_() {
  return [
    '문제 상황을 분석해보면',
    '문제 상황을 살펴보면',
    '우리는',
    '학생이',
    '학생이 틀린 단계는',
    '앞으로의 풀이 전략은',
    '어려움을 겪었을 것입니다',
    '이 문제를 해결하기 위한 전략은',
    '연습을 반복하는 것이 중요합니다',
  ];
}

/**
 * 금지 표현만 제거하고 공백 정리. 격식 어미 일괄 치환은 수학 문장 손상 가능성이 있어 compact 단계에서는 최소화.
 */
function stripFeedbackBannedPhrases_(rawText) {
  var text = String(rawText != null ? rawText : '').replace(/\r/g, '\n');
  text = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  var banned = getFeedbackBannedPhraseList_();
  var i;
  for (i = 0; i < banned.length; i += 1) {
    text = text.replace(new RegExp(banned[i], 'g'), '');
  }
  text = text.replace(/\b\d+\.\s*/g, '').replace(/[•\-]\s+/g, '');
  return text.replace(/\s+/g, ' ').trim();
}

/** 피드백 본문에서 비계·단계 이름·마크다운 강조 제거 (학생 화면·시트 공통 후처리) */
function stripTrainingStageLabels_(rawText) {
  var text = String(rawText != null ? rawText : '');
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/첫\s*번째\s*단계(?:인|에서|를|을)?\s*/gi, '')
    .replace(/두\s*번째\s*단계(?:인|에서|를|을)?\s*/gi, '')
    .replace(/세\s*번째\s*단계(?:인|에서|를|을)?\s*/gi, '')
    .replace(/다음\s*단계(?:인|에서|를|을)?\s*/gi, '')
    .replace(/그\s*다음\s*단계(?:인|에서)?\s*/gi, '')
    .replace(/제\s*\d+\s*단계(?:인|에서|를|을)?\s*/gi, '')
    .replace(/\d\s*\/\s*6\s*(?:단계)?(?:에서|의|,)?\s*/gi, '')
    .replace(/비계\s*\d\s*(?:에서|의)?\s*/gi, '')
    .replace(/미지수\s*설정(?:에서|을|를|인)?\s*/gi, '')
    .replace(/(?:문제\s*상황을\s*식으로\s*표현|식\s*표현)(?:에서|을|를|인)?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

/**
 * 정답 꼴의 식을 직접 드러내지 않고 질문형·차이만 말하는 힌트로 완화 (연속 홀수 등)
 */
function softenAnswerLeakHints_(rawText, problemText) {
  var t = String(rawText || '');
  var body = String(problemText || '');
  var talksOddPair = /연속[^.]{0,12}홀수|두\s*홀수|홀수\s*두|연속하는\s*두\s*홀수/i.test(body + ' ' + t);
  if (talksOddPair) {
    t = t.replace(
      /큰\s*[^\s.!?]{0,12}\s*(를|을)\s*x\s*\+\s*2\s*로\s*나타내(야|야\s*했|는|면)/gi,
      '큰 쪽은 작은 쪽보다 2만큼 크니까, 그 차이를 식으로 어떻게 쓸지 생각해봐'
    );
    t = t.replace(
      /작은\s*[^\s.!?]{0,12}\s*(를|을)\s*x\s*로\s*(두|설정|잡)[^.!?]*/gi,
      '한쪽을 미지수로 잡았다면, 다른 쪽은 그보다 몇만큼 큰 수인지 먼저 말로 정리해봐'
    );
    t = t.replace(/\bx\s*\+\s*2\b(?:\s*로)?(?:\s*나타내|\s*써|\s*표현|\s*적어)[^.!?]*/gi, 'x보다 2큰 수를 식으로 어떻게 나타낼지 생각해봐');
  }
  t = t.replace(
    /정답\s*(은|는|이|가)?\s*x\s*[=＝]\s*[^.!?]+/gi,
    '미지수에 넣을 값은 직접 말하지 않을게, 식만 다시 세워봐'
  );
  return t.replace(/\s+/g, ' ').trim();
}

/** 문장 후보 분리: 마침표·물음표 이후, 또는 긴 단일 덩어리는 쉼표 기준으로 나눔 */
function splitFeedbackSentences_(text) {
  var t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  var parts = t
    .split(/[.!?…]+\s+/)
    .map(function (x) {
      return String(x || '').trim();
    })
    .filter(function (x) {
      return x.length > 0;
    });
  if (parts.length === 1 && parts[0].length > 85) {
    var inner = parts[0].split(/\s*,\s+/);
    if (inner.length >= 2) {
      return inner.map(function (x) {
        return String(x || '').trim();
      }).filter(function (x) {
        return x.length > 0;
      });
    }
  }
  return parts.length ? parts : [t];
}

/** 수학적 힌트 가중치 (높을수록 최종 출력에 우선) */
function scoreMathHintSentence_(s) {
  var t = String(s || '');
  var score = 0;
  if (/10x\s*\+\s*a|10x\+a|10x＋a/i.test(t)) score += 10;
  if (/x\s*\+\s*1/i.test(t)) score += 8;
  if (/\(\s*x\s*\)|를\s*\(?x\)?|미지수\s*x|\bx\s*로\s*(두|잡|설정)|를\s*x로/i.test(t)) score += 6;
  if (/\d+\s*x|[가-힣]\s*의\s*x|4x|3x|2x/i.test(t)) score += 5;
  if (/관계식/.test(t)) score += 6;
  if (/방정식/.test(t)) score += 6;
  if (/미지수/.test(t)) score += 5;
  if (/자릿수|십의\s*자리|일의\s*자리|두\s*자리/.test(t)) score += 5;
  if (/나타낼\s*수\s*있어|나타낼\s*수\s*있습|나타내야|표현해야|표현해|식으로\s*(잘\s*)?표현|상황을\s*식으로/.test(t))
    score += 8;
  if (/큰\s*[^\s]{0,10}\s*를\s*x\s*\+\s*2|작은\s*[^\s]{0,10}\s*를\s*x\s*로\s*설정[^?]*$/i.test(t))
    score -= 14;
  if (/몇\s*배|\d+\s*배|[가-힣]\s*의\s*\d+\s*배/.test(t)) score += 4;
  if (/합\s*(이|을|은|의)?|두\s*수의\s*합|더한/.test(t)) score += 3;
  if (/차\s*(이|를|은)?|두\s*수의\s*차|뺀/.test(t)) score += 3;
  if (/식으로|관계식으로|방정식으로|식을\s*세우|식\s*세우|연립/.test(t)) score += 4;
  if (/^\s*식\s/.test(t) || /\s식\s*한/.test(t)) score += 1;
  // 일반 응원·메타 조언은 우선순위 하향
  if (/다시\s*한번\s*해보자|아자아자|노력이\s*중요|계산\s*끝나면|마지막에\s*꼭\s*확인|구한\s*수를\s*조건에/.test(t))
    score -= 8;
  if (/^화이팅\.?$/.test(t.trim())) score -= 12;
  return score;
}

/** 짧은 일반 응원 문장인지 (핵심 힌트와 분리해 마지막 한 줄로만 쓰기) */
function isGenericCheerSentence_(s) {
  var t = String(s || '').trim();
  if (t.length > 56) return false;
  if (
    /다시\s*한번|화이팅|아자아자|도전해볼|해볼까|응원해|노력|최고|대단|멋져|짱|굿|좋았|잘했|힘내|수고했|오늘도|내일도|또\s*보자|가보자|이어가|MATH|마스터/i.test(
      t
    )
  )
    return true;
  if (/계산\s*끝나면|확인해보자|물었는지|물어보는/.test(t)) return true;
  return false;
}

/** 응원 문장으로 쓰면 안 되는 메타·검산 조언 (수학 핵심이 아님) */
function isUndesirableCheerLine_(s) {
  return /계산\s*끝나면|마지막에\s*꼭\s*확인|구한\s*수를\s*조건에|실수를\s*바로\s*찾/.test(String(s || ''));
}

function shortCheerFromCtx_(ctx) {
  var t = Number(ctx && ctx.total);
  if (!Number.isFinite(t)) t = 0;
  if (t >= 5) return '다시 한번 도전해볼까? 🙂';
  if (t >= 3) return '조금만 더 밀어보자, 화이팅!';
  return '다시 한번 도전해볼까? 🙂';
}

/**
 * OpenAI 원문을 짧게 유지하면서, 수학적으로 의미 있는 문장을 우선 선택한다.
 * 구조: 핵심 수학 힌트 1~2문장 + 짧은 응원 1문장 (길이 제한보다 ‘수학 문장 우선’ 기준)
 *
 * @param {string} rawText
 * @param {object} [ctx] newPayloadToContext_ 결과 유사 객체(total 등)
 * @returns {string}
 */
function compactStudentFeedback_(rawText, ctx) {
  ctx = ctx || {};
  var text = stripFeedbackBannedPhrases_(rawText);
  text = stripTrainingStageLabels_(text);
  text = softenAnswerLeakHints_(text, ctx.problemText || '');
  if (!text) return '';

  var chunks = splitFeedbackSentences_(text);
  var scored = [];
  var i;
  var stratBoost = String(ctx.problemStrategy || '').trim();
  var princBoost = String(ctx.problemPrinciple || '').trim();
  for (i = 0; i < chunks.length; i += 1) {
    var c = chunks[i];
    var n = scoreMathHintSentence_(c);
    if (stratBoost && c.indexOf(stratBoost.slice(0, Math.min(12, stratBoost.length))) >= 0) n += 14;
    if (princBoost && c.indexOf(princBoost.slice(0, Math.min(10, princBoost.length))) >= 0) n += 6;
    scored.push({ s: c, n: n, cheer: isGenericCheerSentence_(c) });
  }

  scored.sort(function (a, b) {
    return b.n - a.n;
  });

  var mathPick = [];
  for (i = 0; i < scored.length && mathPick.length < 2; i += 1) {
    if (scored[i].cheer && scored[i].n <= 0) continue;
    if (scored[i].n > 0) mathPick.push(scored[i].s);
  }

  if (mathPick.length === 0) {
    for (i = 0; i < scored.length && mathPick.length < 2; i += 1) {
      if (!scored[i].cheer || scored[i].n > 0) mathPick.push(scored[i].s);
    }
  }

  var core = mathPick.join(' ').replace(/\s+/g, ' ').trim();
  // 가벼운 구어체 (문장 끝만, 수식 부분은 건드리지 않음)
  core = core
    .replace(/해야\s*합니다\s*$/g, '해야 해')
    .replace(/해야\s*합니다(?=\s|$)/g, '해야 해')
    .replace(/\s+/g, ' ')
    .trim();

  var cheerLine = '';
  for (i = chunks.length - 1; i >= 0; i -= 1) {
    var ch = String(chunks[i] || '').trim();
    if (
      isGenericCheerSentence_(ch) &&
      scoreMathHintSentence_(ch) <= 0 &&
      !isUndesirableCheerLine_(ch)
    ) {
      cheerLine = ch;
      break;
    }
  }
  if (!cheerLine) {
    for (i = scored.length - 1; i >= 0; i -= 1) {
      if (scored[i].cheer && !isUndesirableCheerLine_(scored[i].s)) {
        cheerLine = scored[i].s;
        break;
      }
    }
  }
  if (!cheerLine) cheerLine = shortCheerFromCtx_(ctx);

  if (core && /도전|다시\s*한번|화이팅|해보자|해볼까/.test(core)) cheerLine = '';

  var out = core ? core + (cheerLine ? ' ' + cheerLine : '') : cheerLine || '';
  out = out.replace(/\s+/g, ' ').trim();

  if (out.length > AI_FEEDBACK_CELL_MAX_) {
    out = out.slice(0, AI_FEEDBACK_CELL_MAX_ - 1).trim();
    if (!/[.!?…]$/.test(out)) out += '.';
  }
  return out;
}

/**
 * OpenAI 출력 후처리 가드 (레거시 호출명 유지) — 내부는 compactStudentFeedback_ 로 통일
 */
function sanitizeBoriFeedback_(rawText) {
  return compactStudentFeedback_(rawText, null);
}

/**
 * OpenAI 원문이 있으면 compactStudentFeedback_ 으로 수학 문장 우선 병합.
 * 없거나 비면 문제 본문 패턴 기반 템플릿.
 */
function buildStrictBoriFeedback_(ctx, rawText) {
  var base = String((ctx && ctx.problemText) || '').replace(/\s+/g, ' ').trim();
  var text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (text) {
    var compact = compactStudentFeedback_(rawText, ctx);
    if (compact && String(compact).trim().length > 0) return compact;
  }

  var src = (base ? base + ' ' : '') + text;

  var hint1 = '조건을 식으로 한 줄씩 바로 바꿔 써보자';
  var hint2 = '숫자부터 계산하지 말고, 관계식 먼저 적고 정리해보자';
  var csvStrategy = String(ctx.problemStrategy || '').trim();
  var csvPrinciple = String(ctx.problemPrinciple || '').trim();
  var teacherHint = rewriteToTeacherStrategyHintGAS_(csvStrategy, csvPrinciple, null);
  if (teacherHint) {
    hint1 = teacherHint.replace(/\.\s*$/, '');
    hint2 = '한 줄씩 식을 정리해보자';
  } else if (/두\s*자리|자릿수|십의\s*자리|일의\s*자리/.test(src)) {
    hint1 = '두 자리 수는 10x+a 꼴로 먼저 놓고 식을 세워보자';
    hint2 = '예를 들어 십의 자리가 x, 일의 자리가 4면 10x+4처럼 쓰면 돼';
  } else if (/연속|연이어|다음\s*수|연속하는/.test(src)) {
    hint1 = '연속한 수는 x, x+1처럼 먼저 두고 식을 세워보자';
    hint2 = '예를 들어 두 수의 합이면 x+(x+1)처럼 바로 적으면 돼';
  } else if (/배|곱|곱한|배수/.test(src)) {
    hint1 = '몇 배 관계는 a=kb 꼴로 먼저 적고 한쪽으로 모아보자';
    hint2 = '예를 들어 한 수가 다른 수의 3배면 a=3b처럼 쓰면 돼';
  }

  var cheer = /다시 한번 해보자|화이팅/.test(src) ? '다시 한번 해보자' : '화이팅';
  var out = hint1 + '. ' + hint2 + '. ' + cheer;

  out = out
    .replace(/문제 상황을 분석해보면|문제 상황을 살펴보면|우리는|학생이|학생이 틀린 단계는|앞으로의 풀이 전략은|어려움을 겪었을 것입니다|이 문제를 해결하기 위한 전략은|연습을 반복하는 것이 중요합니다/g, '')
    .replace(/중요합니다|것으로 보입니다/g, '')
    .replace(/~+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (out.length > AI_FEEDBACK_CELL_MAX_) {
    out = out.slice(0, AI_FEEDBACK_CELL_MAX_ - 1).trim();
    if (!/[.!?]$/.test(out)) out += '.';
  }
  return out;
}

/**
 * 프론트엔드 aiPayload(problemMeta·steps·total·hint) → 기존 템플릿용 ctx
 */
function newPayloadToContext_(pl) {
  var payload = pl || {};
  var meta = payload.problemMeta || {};
  var stepsIn = payload.steps;
  var steps = [];
  if (Array.isArray(stepsIn)) {
    var i;
    for (i = 0; i < stepsIn.length; i += 1) {
      var s = stepsIn[i] || {};
      var idx = Number(s.index);
      if (!Number.isFinite(idx) || idx < 1 || idx > 6) {
        continue;
      }
      steps.push({
        stepNumber: idx,
        meaning: String(s.meaning != null ? s.meaning : '').trim(),
        success: Boolean(s.isCorrect),
        label: '',
        questionPreview: String(s.question != null ? s.question : '').trim(),
        studentAnswer: String(s.studentAnswer != null ? s.studentAnswer : '').trim(),
        correctAnswer: String(s.correctAnswer != null ? s.correctAnswer : '').trim(),
      });
    }
  }
  steps.sort(function (a, b) {
    return (Number(a.stepNumber) || 0) - (Number(b.stepNumber) || 0);
  });
  var total = Number(payload.total);
  if (!Number.isFinite(total)) total = 0;
  var hint = Number(payload.hint);
  if (!Number.isFinite(hint)) hint = 0;
  return {
    v: 3,
    problem: String(meta.code != null ? meta.code : '').trim(),
    trainingType: String(meta.type != null ? meta.type : '').trim(),
    problemText: String(meta.context != null ? meta.context : '').trim(),
    problemPrinciple: String(
      meta.problemPrinciple != null ? meta.problemPrinciple : payload.problemPrinciple || ''
    ).trim(),
    problemStrategy: String(
      meta.problemStrategy != null ? meta.problemStrategy : payload.problemStrategy || ''
    ).trim(),
    total: total,
    hint: hint,
    steps: steps,
  };
}

var ADMIN_SECTION_MAX_CHARS_GAS_ = 96;

function compactAdminAnalysisLineGAS_(text, maxLen) {
  var max = maxLen != null ? maxLen : ADMIN_SECTION_MAX_CHARS_GAS_;
  var t = String(text || '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  t = t
    .replace(/평균\s*점수는\s*[\d.]+\s*점으로\s*상대적으로/g, '')
    .replace(/해당\s*유형을\s*우선\s*보강할\s*필요가\s*있습니다/g, '보강 필요')
    .replace(/필요가\s*있습니다/g, '필요')
    .replace(/보입니다/g, '확인됨')
    .replace(/보여\s*줍니다/g, '확인됨')
    .replace(/것으로\s*보입니다/g, '')
    .replace(/것을\s*추천합니다/g, '권장')
    .replace(/진행해\s*주세요/g, '권장')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > max) {
    var cut = t.slice(0, max - 1).replace(/\s+\S*$/, '').trim();
    t = cut || t.slice(0, max - 1);
  }
  if (t && !/[.!?]$/.test(t)) t += '.';
  return t;
}

function compactAdminAnalysisSectionsGAS_(sections) {
  var s = sections || {};
  return {
    learningTrend: compactAdminAnalysisLineGAS_(s.learningTrend),
    majorDifficulty: compactAdminAnalysisLineGAS_(s.majorDifficulty),
    misconception: compactAdminAnalysisLineGAS_(s.misconception),
    teachingGuide: compactAdminAnalysisLineGAS_(s.teachingGuide),
    recommendedActivities: compactAdminAnalysisLineGAS_(s.recommendedActivities),
  };
}

/**
 * 관리자 대시보드 — 문제별 통계 payload → OpenAI JSON 5섹션 (React extractAnalysisFromAppsScriptResponse 호환).
 */
function generateAdminProblemAnalysis_(payload) {
  var key = getOpenAiApiKey_();
  if (!key) {
    Logger.log('[admin_problem_analysis] missing OPENAI_API_KEY');
    return { ok: false, message: 'missing_openai_key' };
  }
  var pl = payload || {};
  var problem = String(pl.problem || '').trim();
  var stats = Array.isArray(pl.stats) ? pl.stats : [];
  var summaryLines = Array.isArray(pl.typePatternSummary) ? pl.typePatternSummary : [];
  var records = Array.isArray(pl.records) ? pl.records : [];
  var compact = {
    classCode: String(pl.classCode || '').trim(),
    problem: problem,
    stats: stats.slice(0, 24),
    typePatternSummary: summaryLines.slice(0, 24),
    highFailRateTypes: Array.isArray(pl.highFailRateTypes) ? pl.highFailRateTypes : [],
    lowestAvgTotalType: pl.lowestAvgTotalType || null,
    mostParticipantsType: pl.mostParticipantsType || null,
    recordSample: records.slice(0, 48),
  };

  var userBlock =
    '역할: 중학교 일차방정식 수업 담당 교사의 문제별 분석 메모 작성.\n' +
    '문제 코드 [' +
    problem +
    '] 집계 JSON:\n\n' +
    JSON.stringify(compact, null, 2) +
    '\n\n출력: JSON 객체 하나. 키: learningTrend, majorDifficulty, misconception, teachingGuide, recommendedActivities.\n' +
    '【톤】 교사용 수업 메모. 필드당 1~2문장, 40~80자. 명사형·간결체(~확인됨, ~높음, ~필요, ~권장). 해요체·학생 격려 금지.\n' +
    '장문 설명("평균 점수는 X점으로…") 금지. 수치는 필드당 1개만.\n' +
    'learningTrend: 점수·실패율 흐름. majorDifficulty: 어려운 유형·단계. misconception: 수업 핵심 개념. teachingGuide: 수업 흐름. recommendedActivities: 짧은 활동 쉼표 구분.\n' +
    '데이터 부족 시 한 줄로만.';

  var system =
    'JSON만 반환. 교사용 분석 메모체. 장문·GPT 설명문 금지. 한국어.';

  var body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userBlock },
    ],
    temperature: 0.3,
    max_tokens: 900,
    response_format: { type: 'json_object' },
  };

  try {
    var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + key },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    var httpCode = res.getResponseCode();
    var raw = res.getContentText();
    Logger.log('[admin_problem_analysis] HTTP ' + httpCode);
    if (httpCode !== 200) {
      Logger.log(raw);
      return { ok: false, message: 'openai_http_' + httpCode };
    }
    var outer = JSON.parse(raw);
    var msg =
      outer.choices &&
      outer.choices[0] &&
      outer.choices[0].message &&
      outer.choices[0].message.content;
    var content = msg ? String(msg).trim() : '';
    if (!content) {
      return { ok: false, message: 'empty_content' };
    }
    content = stripJsonFenceForAdmin_(content);
    var obj = JSON.parse(content);
    var a = {
      learningTrend: String(obj.learningTrend || '').trim(),
      majorDifficulty: String(obj.majorDifficulty || '').trim(),
      misconception: String(obj.misconception || '').trim(),
      teachingGuide: String(obj.teachingGuide || '').trim(),
      recommendedActivities: String(obj.recommendedActivities || '').trim(),
    };

    if (
      !a.learningTrend ||
      !a.majorDifficulty ||
      !a.misconception ||
      !a.teachingGuide ||
      !a.recommendedActivities
    ) {
      return { ok: false, message: 'incomplete_analysis_json' };
    }
    return { ok: true, analysis: compactAdminAnalysisSectionsGAS_(a) };
  } catch (e) {
    Logger.log('[admin_problem_analysis] parse/call ' + e);
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

/** 모델이 ```json ... ``` 로 감싼 경우 제거 */
function stripJsonFenceForAdmin_(text) {
  var t = String(text || '').trim();
  if (t.indexOf('```') === 0) {
    t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '');
  }
  return t.trim();
}

/** v4 피드백 — 단계 분석 기반 */
var FEEDBACK_STEP_LABELS_GAS_ = {
  step1: '무엇을 구하는지 파악',
  step2: '미지수 설정',
  step3: '문제 상황을 식으로 표현',
  step4: '방정식 세우기',
  step5_1: '식 정리',
  step5_2: '항 이동',
  step5_3: '계수 나누기',
  step6: '구한 값을 문제 상황에 맞게 해석',
};

var FEEDBACK_STEP_STRATEGY_GAS_ = {
  step1: '구하는 것을 한 줄로 적은 뒤 식으로 옮겨보자.',
  step2: '구하는 양을 x로 정하고 끝까지 같은 문자로 써보자.',
  step3: '문제 속 관계가 식에 모두 들어갔는지 확인해보자.',
  step4: '방정식에 문제 조건이 모두 들어갔는지 다시 확인해보자.',
  step5_1: '괄호 안 모든 항에 숫자가 곱해졌는지 다시 확인해보자.',
  step5_2: '항을 옮긴 뒤 양변에 같은 항만 남았는지 확인해보자.',
  step5_3: 'x 앞 숫자로 나누기 전에 식이 맞는지 확인해보자.',
  step6: '구한 값을 문제 조건에 넣어 맞는지 확인해보자.',
};

var AWKWARD_FEEDBACK_RE_GAS_ =
  /에서\s*한\s*번\s*더\s*확인보면\s*좋아요|확인보면\s*좋아요|확인해\s*보면\s*좋아요|이어가\s*보세요|같은\s*흐름으로\s*풀어보세요|도움이\s*돼|필요합니다|중요합니다|활용하(시|해)\s*바랍|나타났습니다|이해하는\s*것이/;

var STUDENT_FEEDBACK_VOICE_PROMPT_GAS_ =
  '【말투 통일】 중1 수학 선생님이 옆에서 짧게 말하는 톤. 해요체. 행동 중심(해보자·확인해보자·정리해보자·이어가 보자). success·partial·fail 같은 말투. 금지: ~필요합니다, ~중요합니다, ~활용하세요/바랍니다, 설명형, 나타났습니다.';

function unifyStudentFeedbackToneGAS_(sentence) {
  var t = String(sentence || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t
    .replace(/활용하(시|해)\s*바랍니다/g, '먼저 적어보자')
    .replace(/활용해\s*보세요/g, '먼저 적어보자')
    .replace(/공식을\s*활용/g, '공식을 먼저 적어')
    .replace(/관계를\s*이해하는\s*것이\s*중요합니다/g, '관계를 먼저 정리해보자')
    .replace(/[^.!?]{0,40}이\s*중요합니다/g, '먼저 정리해보자')
    .replace(/확인이\s*필요합니다/g, '다시 확인해보자')
    .replace(/나타났습니다/g, '있었어요')
    .replace(/어려움이\s*나타났/g, '어려움이 있었')
    .replace(/연습이\s*필요합니다/g, '다시 연습해보자')
    .replace(/([가-힣·\s]{2,24})\s*필요합니다\.?$/g, '$1 해보자.')
    .replace(/잘했습니다/g, '안정적으로 해결했어요')
    .replace(/점이\s*좋아요/g, '흐름이 안정적이었어요')
    .replace(/흐름이\s*좋았어요/g, '흐름이 자연스럽게 이어졌어요')
    .replace(/확인보면\s*좋아요/g, '확인해보자')
    .replace(/확인해\s*보면\s*좋아요/g, '확인해보자')
    .replace(/도움이\s*돼\.?$/g, '확인해보자.')
    .replace(/해보세요/g, '해보자')
    .replace(/적어보세요/g, '적어보자')
    .replace(/세워보세요/g, '세워보자')
    .replace(/정리하세요/g, '정리해보자');
  if (!/[.!?]$/.test(t)) t += '.';
  return t.replace(/\s+/g, ' ').trim();
}

function finishTeacherHintGAS_(text) {
  var t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length > 58) {
    t = t.slice(0, 57).replace(/\s+\S*$/, '').trim();
  }
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

/** CSV problemStrategy → 짧은 행동 중심 교사 힌트 (프론트 mathStrategyHintTone.js 와 동기화) */
function rewriteToTeacherStrategyHintGAS_(strategy, principle, fail) {
  var s = String(strategy || '').trim().replace(/"/g, '');
  var p = String(principle || '').trim();
  var failKey = fail && fail.key ? String(fail.key) : '';
  var src = (p + ' ' + s).replace(/\s+/g, ' ');

  if (/거리|속력|시간/.test(src)) {
    return finishTeacherHintGAS_('거리·시간·속력은 표에 적고 관계를 먼저 정리해보자');
  }
  if (/비율|전체.*부분|\/\d+\s*×|1\/\d/.test(src)) {
    return finishTeacherHintGAS_('전체와 부분의 관계를 표에 먼저 적어보자');
  }
  if (/분배|괄호|distributive/i.test(s) || failKey === 'step5_1') {
    return finishTeacherHintGAS_('괄호 안 모든 항에 숫자가 곱해졌는지 다시 확인해보자');
  }
  if (/10x\s*\+|10x\+|십의\s*자리|일의\s*자리|두\s*자리/.test(src)) {
    return finishTeacherHintGAS_('두 자리 수는 10x+a 꼴로 적고 조건을 식으로 옮겨보자');
  }
  if (/x\s*\+\s*1|연속|다음\s*(자연수|수)/.test(src)) {
    return finishTeacherHintGAS_('연속한 수는 x와 x+1로 두고 합·차를 식으로 세워보자');
  }
  if (/x\s*\+\s*2|홀수/.test(src)) {
    return finishTeacherHintGAS_('작은 수를 x로 두고 다음 수는 x+2로 적어보자');
  }
  if (/나이|살\s*많|많으면|\+\s*\d+/.test(s) || /많다|적다/.test(p)) {
    var pm = s.match(/\+\s*(\d+)/);
    if (pm) {
      return finishTeacherHintGAS_('많은 쪽은 x+' + pm[1] + ', 적은 쪽은 x로 두고 합·차 식을 세워보자');
    }
    return finishTeacherHintGAS_('많고 적은 쪽을 x와 x+N으로 나눠 식을 세워보자');
  }
  if (/다리|소|닭|양|오리|개.*다리/.test(src)) {
    return finishTeacherHintGAS_('동물마다 다리 수를 표에 적고 다리 합 식을 세워보자');
  }
  if (/둘레|직사각형|가로|세로/.test(src)) {
    return finishTeacherHintGAS_('가로·세로를 표에 적고 둘레나 넓이 식을 세워보자');
  }
  if (/개수\s*×|×\s*1|곱|배/.test(s)) {
    return finishTeacherHintGAS_('개수와 한 개 값을 곱한 식으로 관계를 적어보자');
  }
  if (/미래|몇\s*년\s*후|현재\s*나이/.test(src)) {
    return finishTeacherHintGAS_('지금 나이와 몇 년 뒤 나이를 x와 x+N으로 나눠 적어보자');
  }
  if (/주고\s*받|개수\s*변화/.test(src)) {
    return finishTeacherHintGAS_('주고받기 전·후 개수를 표에 적고 변화를 식으로 세워보자');
  }
  if (/항\s*이동|move_term/i.test(s) || failKey === 'step5_2') {
    return FEEDBACK_STEP_STRATEGY_GAS_.step5_2;
  }
  if (/계수|나누|divide/i.test(s) || failKey === 'step5_3') {
    return FEEDBACK_STEP_STRATEGY_GAS_.step5_3;
  }
  if (failKey && FEEDBACK_STEP_STRATEGY_GAS_[failKey]) {
    return FEEDBACK_STEP_STRATEGY_GAS_[failKey];
  }
  if (s) {
    var out = s
      .replace(/관계를\s*생각하고\s*/g, '')
      .replace(/를\s*떠올리(고|며)?\s*/g, '')
      .replace(/구해보자/g, '적어보자')
      .replace(/나타내(보자|야)/g, '적어보자')
      .replace(/생각해보자/g, '정리해보자')
      .replace(/이다\.?$/g, '로 적어보자')
      .replace(/\s+/g, ' ')
      .trim();
    if (out.length > 8) return finishTeacherHintGAS_(out);
  }
  if (p && /많다|적다|합|차|비/.test(p)) {
    return finishTeacherHintGAS_('조건을 표에 적고 관계를 식으로 옮겨보자');
  }
  return '';
}

function isEmptyStepCell_(raw) {
  return raw === '' || raw === null || raw === undefined;
}

function stepOutcomeFromRaw_(raw, isCorrectHint) {
  if (isEmptyStepCell_(raw)) return 'skipped';
  if (typeof isCorrectHint === 'boolean') {
    return isCorrectHint ? 'success' : 'fail';
  }
  var n = Number(raw);
  if (n === 1) return 'success';
  if (n === 0) return 'fail';
  return 'skipped';
}

function deriveOverallPerformanceLevelGAS_(failCount) {
  var fc = Math.max(0, Math.round(Number(failCount) || 0));
  if (fc <= 1) return 'stable';
  if (fc <= 3) return 'partial_difficulty';
  return 'multi_difficulty';
}

function overallPerformanceSummarySentenceGAS_(level) {
  if (level === 'stable') return '전체 해결 흐름이 안정적이었어요.';
  if (level === 'partial_difficulty') return '이번 문제에서는 일부 단계에서 어려움이 있었어요.';
  return '이번 문제에서는 여러 단계에서 어려움이 있었어요.';
}

function deriveFeedbackTierGAS_(failCount, total) {
  var fc = Math.max(0, Math.round(Number(failCount) || 0));
  var t = Math.max(0, Math.round(Number(total) || 0));
  if (t >= 6 && fc <= 1) return 'success';
  if (t <= 3 || fc >= 4) return 'fail';
  return 'partial';
}

function deriveFeedbackEmphasisGAS_(failCount, total) {
  var tier = deriveFeedbackTierGAS_(failCount, total);
  if (tier === 'success') return 'success';
  if (tier === 'fail') return 'remediation';
  return 'partial';
}

function tierOverallSummarySentenceGAS_(tier) {
  if (tier === 'success') return '전체 해결 흐름이 안정적이었어요.';
  if (tier === 'partial') return '전체 흐름은 자연스럽게 이어졌어요.';
  return '이번 문제에서는 여러 단계에서 어려움이 있었어요.';
}

var REMEDIAL_TONE_RE_GAS_ =
  /표를\s*(먼저\s*)?그려|어려움이\s*있었|특히\s*.+\s*단계에서\s*어려움|다시\s*도전|틀린\s*단계/;

function isRemedialToneSentenceGAS_(sentence) {
  return REMEDIAL_TONE_RE_GAS_.test(String(sentence || ''));
}

function pickSuccessPraiseLineGAS_(analysis) {
  var step = analysis && analysis.primarySuccessStep;
  var key = step && step.key ? String(step.key) : '';
  if (key === 'step3') return '문제 조건을 정리하며 식을 세운 흐름이 안정적이었어요.';
  if (key === 'step4') return '방정식을 차근차근 세운 흐름이 자연스럽게 이어졌어요.';
  if (key === 'step2') return '미지수를 일관되게 두고 푼 흐름이 안정적이었어요.';
  if (step && step.label) {
    return String(step.label).replace(/하기$/, '').trim() + ' 흐름이 자연스럽게 이어졌어요.';
  }
  return '문제 조건을 정리하며 식을 세운 흐름이 안정적이었어요.';
}

function pickSuccessMaintenanceHintGAS_(analysis) {
  var src =
    String((analysis && analysis.problemPrinciple) || '') +
    ' ' +
    String((analysis && analysis.problemStrategy) || '');
  if (/거리|속력|시간/.test(src)) {
    return finishTeacherHintGAS_('다음 문제에서도 거리·시간·속력 관계를 정리하며 풀어보자');
  }
  if (/비율|전체|부분/.test(src)) {
    return finishTeacherHintGAS_('다음 문제에서도 전체와 부분 관계를 먼저 정리해보자');
  }
  return finishTeacherHintGAS_('다음 문제에서도 조건을 먼저 정리하는 습관을 이어가 보자');
}

function pickPartialWeakStepLineGAS_(analysis) {
  var fail = analysis && analysis.primaryFailStep;
  if (!fail || !fail.label) return '';
  if (fail.key === 'step4') {
    return finishTeacherHintGAS_('방정식을 세울 때 문제 조건이 모두 들어갔는지 확인해보자');
  }
  if (fail.key === 'step3') {
    return finishTeacherHintGAS_('문제 속 관계가 식에 모두 들어갔는지 확인해보자');
  }
  return finishTeacherHintGAS_(
    String(fail.label).replace(/하기$/, '').trim() + '에서 한 번 더 확인해보자'
  );
}

function pickPartialCoachingHintGAS_(analysis) {
  var out = rewriteToTeacherStrategyHintGAS_(
    analysis && analysis.problemStrategy,
    analysis && analysis.problemPrinciple,
    analysis && analysis.primaryFailStep
  );
  if (out) return out;
  var fail = analysis && analysis.primaryFailStep;
  if (fail && fail.key && FEEDBACK_STEP_STRATEGY_GAS_[fail.key]) {
    return FEEDBACK_STEP_STRATEGY_GAS_[fail.key];
  }
  return finishTeacherHintGAS_('문제 조건을 하나씩 식으로 바꿔보자');
}

function pickFailRemediationHintGAS_(analysis) {
  return pickPartialCoachingHintGAS_(analysis);
}

function isSuccessPraiseSentenceGAS_(sentence, successSteps) {
  var t = String(sentence || '');
  if (/안정적으로 해결|잘 마쳤|잘 이어졌|훌륭|완벽|단계는 잘/.test(t)) return true;
  var i;
  for (i = 0; i < (successSteps || []).length; i += 1) {
    var label = successSteps[i].label;
    if (label && t.indexOf(label) >= 0 && /안정|잘|해결했|이어졌/.test(t)) return true;
  }
  return false;
}

function attachOverallPerformanceToAnalysis_(a) {
  var base = normalizeFeedbackAnalysisCore_(a);
  var level =
    String(base.overallPerformanceLevel || '').trim() ||
    deriveOverallPerformanceLevelGAS_(base.fail_count);
  var feedbackTier =
    String(base.feedbackTier || '').trim() ||
    deriveFeedbackTierGAS_(base.fail_count, base.total);
  var emphasis =
    String(base.feedbackEmphasis || '').trim() ||
    deriveFeedbackEmphasisGAS_(base.fail_count, base.total);
  return {
    successSteps: base.successSteps,
    failSteps: base.failSteps,
    skippedSteps: base.skippedSteps,
    total: base.total,
    fail_count: base.fail_count,
    type: base.type,
    status: base.status,
    primarySuccessStep: base.primarySuccessStep,
    primaryFailStep: base.primaryFailStep,
    problemPrinciple: base.problemPrinciple,
    problemStrategy: base.problemStrategy,
    overallPerformanceLevel: level,
    overallPerformanceSummary:
      String(base.overallPerformanceSummary || '').trim() ||
      tierOverallSummarySentenceGAS_(feedbackTier) ||
      overallPerformanceSummarySentenceGAS_(level),
    feedbackTier: feedbackTier,
    feedbackEmphasis: emphasis,
  };
}

function normalizeFeedbackAnalysisCore_(a) {
  var src = a || {};
  return {
    successSteps: Array.isArray(src.successSteps) ? src.successSteps : [],
    failSteps: Array.isArray(src.failSteps) ? src.failSteps : [],
    skippedSteps: Array.isArray(src.skippedSteps) ? src.skippedSteps : [],
    total: Number(src.total) || 0,
    fail_count: Number(src.fail_count) || 0,
    type: String(src.type || '').trim(),
    status: String(src.status || '').trim(),
    primarySuccessStep: src.primarySuccessStep || null,
    primaryFailStep: src.primaryFailStep || null,
    problemPrinciple: String(src.problemPrinciple || '').trim(),
    problemStrategy: String(src.problemStrategy || '').trim(),
    overallPerformanceLevel: String(src.overallPerformanceLevel || '').trim(),
    overallPerformanceSummary: String(src.overallPerformanceSummary || '').trim(),
    feedbackTier: String(src.feedbackTier || '').trim(),
    feedbackEmphasis: String(src.feedbackEmphasis || '').trim(),
  };
}

function normalizeFeedbackAnalysis_(a) {
  return attachOverallPerformanceToAnalysis_(a);
}

function analysisFromLegacyAiPayload_(pl) {
  var keys = ['step1', 'step2', 'step3', 'step4', 'step5_1', 'step5_2', 'step5_3', 'step6'];
  var successSteps = [];
  var failSteps = [];
  var skippedSteps = [];
  var ki;
  var hasSheet = false;
  for (ki = 0; ki < keys.length; ki += 1) {
    if (!isEmptyStepCell_(pl[keys[ki]])) hasSheet = true;
  }
  if (hasSheet) {
    for (ki = 0; ki < keys.length; ki += 1) {
      var key = keys[ki];
      var label = FEEDBACK_STEP_LABELS_GAS_[key] || key;
      var outcome = stepOutcomeFromRaw_(pl[key]);
      if (outcome === 'success') successSteps.push({ key: key, label: label });
      else if (outcome === 'fail') failSteps.push({ key: key, label: label });
      else skippedSteps.push({ key: key, label: label });
    }
  } else if (Array.isArray(pl.steps)) {
    for (ki = 0; ki < pl.steps.length; ki += 1) {
      var s = pl.steps[ki] || {};
      var key2 = keys[ki] || 'step' + (ki + 1);
      var label2 =
        FEEDBACK_STEP_LABELS_GAS_[key2] ||
        String(s.meaning != null ? s.meaning : '').trim() ||
        key2;
      var outcome2 = stepOutcomeFromRaw_('', Boolean(s.isCorrect));
      if (outcome2 === 'success') successSteps.push({ key: key2, label: label2 });
      else if (outcome2 === 'fail') failSteps.push({ key: key2, label: label2 });
      else skippedSteps.push({ key: key2, label: label2 });
    }
  }
  var total = Number(pl.total);
  if (!Number.isFinite(total)) total = successSteps.length;
  var failCount = Number(pl.fail_count != null ? pl.fail_count : pl.failCount);
  if (!Number.isFinite(failCount)) failCount = failSteps.length;
  var meta = pl.problemMeta || {};
  return {
    successSteps: successSteps,
    failSteps: failSteps,
    skippedSteps: skippedSteps,
    total: total,
    fail_count: failCount,
    type: String(pl.type != null ? pl.type : meta.type || '').trim(),
    status: String(pl.status || '').trim(),
    primarySuccessStep: successSteps.length ? successSteps[successSteps.length - 1] : null,
    primaryFailStep: failSteps.length ? failSteps[0] : null,
    problemPrinciple: String(meta.problemPrinciple || pl.problemPrinciple || '').trim(),
    problemStrategy: String(meta.problemStrategy || pl.problemStrategy || '').trim(),
  };
}

function pickMathStrategyHintGAS_(analysis) {
  var tier =
    (analysis && analysis.feedbackTier) ||
    deriveFeedbackTierGAS_(analysis && analysis.fail_count, analysis && analysis.total);
  if (tier === 'success') return pickSuccessMaintenanceHintGAS_(analysis);
  if (tier === 'partial') return pickPartialCoachingHintGAS_(analysis);
  return pickFailRemediationHintGAS_(analysis);
}

function pickContextStrategyHintGAS_(analysis, options) {
  var a = analysis || {};
  var tier = a.feedbackTier || deriveFeedbackTierGAS_(a.fail_count, a.total);
  if (tier === 'success') return pickSuccessMaintenanceHintGAS_(a);
  if (tier === 'partial') return pickPartialCoachingHintGAS_(a);
  if (tier === 'fail') return pickFailRemediationHintGAS_(a);
  var opts = options || {};
  var fail = a.primaryFailStep;
  var useFail = opts.forFailStep !== false && fail && fail.key;
  var out = rewriteToTeacherStrategyHintGAS_(
    a.problemStrategy,
    a.problemPrinciple,
    useFail ? fail : null
  );
  if (out) return out;
  if (useFail && fail.key && FEEDBACK_STEP_STRATEGY_GAS_[fail.key]) {
    return FEEDBACK_STEP_STRATEGY_GAS_[fail.key];
  }
  return finishTeacherHintGAS_('다음 문제에서도 조건을 표에 적고 식으로 옮겨보자');
}

function replaceAwkwardFeedbackSentenceGAS_(sentence, analysis) {
  var t = String(sentence || '').trim();
  if (!t || !analysis) return t;
  var tier = analysis.feedbackTier || deriveFeedbackTierGAS_(analysis.fail_count, analysis.total);
  if (tier === 'success' && (AWKWARD_FEEDBACK_RE_GAS_.test(t) || isRemedialToneSentenceGAS_(t))) {
    return pickSuccessMaintenanceHintGAS_(analysis);
  }
  if (!AWKWARD_FEEDBACK_RE_GAS_.test(t)) return unifyStudentFeedbackToneGAS_(t);
  if (tier === 'partial') return pickPartialCoachingHintGAS_(analysis);
  if (tier === 'fail') return pickFailRemediationHintGAS_(analysis);
  var hasFail = Boolean(analysis.primaryFailStep && analysis.primaryFailStep.key);
  return pickContextStrategyHintGAS_(analysis, { forFailStep: hasFail });
}

function resolveFeedbackAnalysis_(pl) {
  var payload = pl || {};
  if (payload.analysis && typeof payload.analysis === 'object') {
    return normalizeFeedbackAnalysis_(payload.analysis);
  }
  return analysisFromLegacyAiPayload_(payload);
}

function buildFeedbackPromptInstructionsGAS_(tier) {
  if (tier === 'success') {
    return (
      '【출력】 한국어 2~3문장. 번호·목록 금지.\n' +
      '1문장: 흐름 안정. 2문장: 잘 이어진 단계. 3문장: 습관·전략 유지(이어가 보자). 실패·보완 힌트 금지.'
    );
  }
  if (tier === 'partial') {
    return (
      '【출력】 한국어 2~3문장. 번호·목록 금지.\n' +
      '1문장: 흐름 인정. 2문장: 약한 단계(확인해보자). 3문장: 행동 전략 1개.'
    );
  }
  return (
    '【출력】 한국어 2~3문장. 번호·목록 금지.\n' +
    '1문장: 어려움이 있었어요. 2문장: 가장 어려운 단계. 3문장: 핵심 전략(해보자).'
  );
}

function tierPromptBlockGAS_(tier) {
  if (tier === 'success') {
    return '【성공】 유지·강화 톤. 잘했어요만 쓰지 말 것. 실패·표 보완 금지.';
  }
  if (tier === 'partial') {
    return '【부분 성공】 같은 교사 말투. 전략 1개.';
  }
  return '【실패】 행동 힌트만. 격려 최소화.';
}

function buildAiFeedbackPromptFromAnalysis_(analysis) {
  var a = attachOverallPerformanceToAnalysis_(analysis);
  var tier = a.feedbackTier || deriveFeedbackTierGAS_(a.fail_count, a.total);
  var data = {
    feedbackTier: tier,
    overallPerformanceLevel: a.overallPerformanceLevel,
    overallPerformanceSummary: a.overallPerformanceSummary,
    feedbackEmphasis: a.feedbackEmphasis,
    successSteps: [],
    failSteps: [],
    primarySuccessStep: a.primarySuccessStep && a.primarySuccessStep.label ? a.primarySuccessStep.label : null,
    primaryFailStep: a.primaryFailStep && a.primaryFailStep.label ? a.primaryFailStep.label : null,
    problemPrinciple: a.problemPrinciple || '—',
    problemStrategy: a.problemStrategy || '—',
    total: a.total,
    fail_count: a.fail_count,
    type: a.type || '—',
    status: a.status || '—',
  };
  var i;
  for (i = 0; i < a.successSteps.length; i += 1) {
    data.successSteps.push(a.successSteps[i].label);
  }
  for (i = 0; i < a.failSteps.length; i += 1) {
    data.failSteps.push(a.failSteps[i].label);
  }
  var extraFail = tier === 'fail' ? '\n【중요】 feedbackTier=fail이면 성공 단계 칭찬 금지.\n' : '';
  var extraSuccess =
    tier === 'success' ? '\n【중요】 feedbackTier=success이면 실패·보완 힌트 금지.\n' : '';
  return (
    '중1 일차방정식 수련 결과를 바탕으로, 옆에서 짧게 말하는 수학 선생님 톤의 학습 피드백만 작성하세요.\n\n' +
    STUDENT_FEEDBACK_VOICE_PROMPT_GAS_ +
    '\n\n' +
    buildFeedbackPromptInstructionsGAS_(tier) +
    '\n\n【수학 전략】 짧은 행동 힌트. "~를 떠올려" 금지. problemStrategy 35~55자.\n' +
    tierPromptBlockGAS_(tier) +
    '\n【금지】 문제 지문 인용·과한 응원·MATH-CARD·단계없음.' +
    extraFail +
    extraSuccess +
    '\n【분석 데이터】\n' +
    JSON.stringify(data, null, 2)
  );
}

function sanitizeFeedbackTextFromAnalysis_(rawText, analysis) {
  var text = String(rawText != null ? rawText : '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/힘내요|응원해요|MATH-MASTER|MATH-CARD|아자아자|화이팅|보리도사/gi, '');
  text = text
    .replace(/[^.!?]{1,48}를\s*떠올리고,\s*/g, '')
    .replace(/관계를\s*생각하고\s*/g, '')
    .replace(/관계를\s*생각해\s*/g, '');
  text = text.replace(/,\s*,+/g, ', ').replace(/\s+,/g, ',');
  var parts = text.split(/(?<=[.!?…])\s+/);
  var out = [];
  var pi;
  var a = analysis ? attachOverallPerformanceToAnalysis_(analysis) : null;
  var mathCardLineRe =
    /MATH-?CARD|매쓰\s*카드|math\s*card|카드\s*(를\s*)?(획득|얻|받)|획득(하지|하지\s*못|못)\s*(했|하였)|다음\s*카드에\s*도전/i;
  for (pi = 0; pi < parts.length; pi += 1) {
    var s = String(parts[pi] || '').trim();
    if (s.length <= 2) continue;
    if (mathCardLineRe.test(s)) continue;
    if (a) s = unifyStudentFeedbackToneGAS_(replaceAwkwardFeedbackSentenceGAS_(s, a));
    else s = unifyStudentFeedbackToneGAS_(s);
    var tier = a.feedbackTier || deriveFeedbackTierGAS_(a.fail_count, a.total);
    if ((tier === 'fail' || a.feedbackEmphasis === 'remediation') && isSuccessPraiseSentenceGAS_(s, a.successSteps)) {
      continue;
    }
    if (tier === 'success' && isRemedialToneSentenceGAS_(s)) continue;
    if (/^(전체 해결 흐름|전체 흐름|이번 문제에서는)/.test(s)) {
      out.push(s);
      if (out.length >= 3) break;
      continue;
    }
    out.push(s);
    if (out.length >= 3) break;
  }
  text = out.join(' ').trim();
  if (text.length > 520) text = text.slice(0, 520).trim();
  return text;
}

function templateFeedbackFromAnalysis_(analysis) {
  var a = attachOverallPerformanceToAnalysis_(analysis);
  var tier = a.feedbackTier || deriveFeedbackTierGAS_(a.fail_count, a.total);
  var sentences = [
    tierOverallSummarySentenceGAS_(tier) || a.overallPerformanceSummary,
  ];
  if (tier === 'success') {
    sentences.push(pickSuccessPraiseLineGAS_(a));
    sentences.push(pickSuccessMaintenanceHintGAS_(a));
  } else if (tier === 'partial') {
    if (!a.primaryFailStep && a.primarySuccessStep && a.primarySuccessStep.label) {
      sentences.push(
        String(a.primarySuccessStep.label).replace(/하기$/, '').trim() + '까지는 자연스럽게 이어졌어요.'
      );
    }
    var weakLine = pickPartialWeakStepLineGAS_(a);
    if (weakLine) sentences.push(weakLine);
    sentences.push(pickPartialCoachingHintGAS_(a));
  } else {
    if (a.primaryFailStep && a.primaryFailStep.label) {
      sentences.push(
        String(a.primaryFailStep.label).replace(/하기$/, '').trim() + ' 단계에서 어려움이 있었어요.'
      );
    } else if (a.fail_count > 0 && !/어려움이\s*있었/.test(sentences[0] || '')) {
      sentences.push('이번 문제의 주요 단계에서 어려움이 있었어요.');
    }
    sentences.push(pickFailRemediationHintGAS_(a));
  }
  return sanitizeFeedbackTextFromAnalysis_(sentences.join(' '), a);
}

/**
 * 단계 분석 기반 피드백 (doPost generate_ai_feedback). OPENAI_API_KEY 사용.
 */
function generateAIFeedback_(payload) {
  Logger.log('[AI] generateAIFeedback_ called (v4 analysis)');
  var pl = payload || {};
  var analysis = resolveFeedbackAnalysis_(pl);
  var analysisFull = attachOverallPerformanceToAnalysis_(analysis);
  var key = getOpenAiApiKey_();

  if (!key) {
    Logger.log('[AI] fallback: missing API key');
    return templateFeedbackFromAnalysis_(analysis);
  }

  var userBlock = pl.prompt
    ? String(pl.prompt)
    : buildAiFeedbackPromptFromAnalysis_(analysis);
  var system =
    '너는 중1 수학 선생님이 옆에서 짧게 말한다. success/partial/fail 모두 같은 해요체·행동 중심 말투(해보자·확인해보자·정리해보자). 2~3문장. success면 보완 힌트 금지, fail이면 칭찬 금지. ~필요합니다·~중요합니다·설명형 금지.';

  var body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userBlock },
    ],
    temperature: 0.55,
    max_tokens: 320,
  };

  var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  var code = res.getResponseCode();
  var raw = res.getContentText();
  Logger.log('[AI] OpenAI response code: ' + code);

  if (code !== 200) {
    Logger.log('generateAIFeedback OpenAI HTTP ' + code + ' ' + raw);
    return templateFeedbackFromAnalysis_(analysis);
  }
  try {
    var parsed = JSON.parse(raw);
    var msg =
      parsed.choices &&
      parsed.choices[0] &&
      parsed.choices[0].message &&
      parsed.choices[0].message.content;
    var content = msg ? String(msg).trim() : '';
    if (!content) {
      return templateFeedbackFromAnalysis_(analysis);
    }
    var cleaned = sanitizeFeedbackTextFromAnalysis_(content, analysisFull);
    if (cleaned) {
      var ctxFb = {
        problemPrinciple: analysisFull.problemPrinciple,
        problemStrategy: analysisFull.problemStrategy,
        total: analysisFull.total,
      };
      var compacted = compactStudentFeedback_(cleaned, ctxFb);
      if (compacted) cleaned = compacted;
    }
    return cleaned || templateFeedbackFromAnalysis_(analysis);
  } catch (e2) {
    Logger.log('generateAIFeedback parse: ' + e2);
    return templateFeedbackFromAnalysis_(analysis);
  }
}


function generateTrainingAiFeedback_(ctx) {
  var key = getOpenAiApiKey_();
  var fallback = buildStrictBoriFeedback_(ctx, templateTrainingAiFeedbackFromContext_(ctx));
  if (!key) {
    return fallback;
  }
  var userContent = buildOpenAiUserContent_(ctx);
  var openAi = callOpenAiTrainingFeedback_(userContent);
  if (openAi.ok && openAi.text) {
    return openAi.text;
  }
  Logger.log('OpenAI fallback: ' + (openAi.error || ''));
  return fallback;
}

function callOpenAiTrainingFeedback_(userContent) {
  var key = getOpenAiApiKey_();
  if (!key) {
    return { ok: false, error: 'missing_openai_key' };
  }
  var system =
    '역할: 보리도사. 중1(약 13세) 친구에게 반말로 일차방정식 문장제 수련 직후 짧은 코칭만.\n' +
    '형식: 한국어 2~3문장, 번호/목록 금지. 존댓말 금지.\n' +
    '순서: (1) 수학 핵심 힌트 1줄 — 정답 식·최종 값 금지, 질문형·유사 예시만 (2) 마지막 한 줄은 매번 다른 짧은 응원·칭찬.\n' +
    '금지: 단계 번호·비계명·"미지수 설정" 같은 단계 라벨, 문제 분석, 틀린 부분 지적, 단계별 해설, 다음 문제 풀이 절차·전략 나열.\n' +
    '금지 표현: "문제 상황을 분석해보면", "우리는", "학생이", "틀린 단계", "~하는 것이 중요합니다" 등.\n' +
    '응원 마지막 줄은 화이팅만 반복하지 말고 매번 다른 표현으로. 최고/대단해/아자아자/MATH MASTER 느낌도 가끔 섞어도 됨.\n' +
    '필요하면 충분히 쓰되 장문·중복만 줄인다.';

  var body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    temperature: 0.88,
    max_tokens: 2048,
  };

  var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  var code = res.getResponseCode();
  var raw = res.getContentText();
  if (code !== 200) {
    Logger.log('OpenAI HTTP ' + code + ' ' + raw);
    return { ok: false, error: 'http_' + code };
  }
  try {
    var parsed = JSON.parse(raw);
    var msg =
      parsed.choices &&
      parsed.choices[0] &&
      parsed.choices[0].message &&
      parsed.choices[0].message.content;
    var content = msg ? String(msg).trim() : '';
    if (!content) return { ok: false, error: 'empty_content' };
    return { ok: true, text: sanitizeBoriFeedback_(content) };
  } catch (e2) {
    return { ok: false, error: 'parse_error' };
  }
}

/** OpenAI 없을 때도 단계·유형·문항별로 문구가 달라지도록 */
function templateTrainingAiFeedbackFromContext_(ctx) {
  var t = Number(ctx.total);
  if (!Number.isFinite(t)) t = 0;
  var h = Number(ctx.hint);
  if (!Number.isFinite(h)) h = 0;
  var prob = String(ctx.problem || '').trim();
  var tt = String(ctx.trainingType || '').trim();
  var body = String(ctx.problemText || '').trim().replace(/\s+/g, ' ');
  var steps = ctx.steps && ctx.steps.length ? ctx.steps : legacyAiFeedbackContextFromQuery_({}).steps;

  var salt = 0;
  var si;
  for (si = 0; si < prob.length; si += 1) {
    salt += prob.charCodeAt(si);
  }
  salt += (tt.length % 7) * 13;
  salt += t * 3 + h;

  var okNames = [];
  var failNames = [];
  var failNums = [];
  for (si = 0; si < steps.length; si += 1) {
    var st = steps[si];
    var name = st.meaning ? st.meaning : '단계 ' + st.stepNumber;
    if (st.success) {
      okNames.push(name);
    } else {
      failNames.push(name);
      failNums.push(Number(st.stepNumber) || 0);
    }
  }

  var parts = [];

  var headVariantsHi = [
    '[' + prob + ' · ' + tt + '] 이번 시도에서 방정식까지 세우는 흐름이 꽤 안정적이었어요.',
    '문항 ' + prob + '(' + tt + ')에서는 식을 문제 말과 연결하려는 태도가 좋았어요.',
    prob + ' ' + tt + ' 연습에서 단계별로 차근차근 적어 간 점이 보였어요.',
  ];
  var headVariantsLo = [
    '[' + prob + ' · ' + tt + '] 이번 문제는 어려운 부분이 있었지만, 시도한 만큼 분명히 배운 게 있어요.',
    prob + '(' + tt + ')에서는 아직 헷갈리는 단계가 있었지만, 그걸 끝까지 밟아 본 게 중요해요.',
    tt + ' 유형의 ' + prob + '에서 부담이 컸을 텐데도 끝까지 진행했네요.',
  ];

  parts.push((t >= 5 ? headVariantsHi : headVariantsLo)[salt % (t >= 5 ? headVariantsHi.length : headVariantsLo.length)]);

  if (okNames.length) {
    var praisePick = salt % 3;
    if (praisePick === 0) {
      parts.push(
        '특히 ' +
          okNames.slice(0, 3).join(', ') +
          (okNames.length > 3 ? ' 등' : '') +
          '에서는 생각을 잘 이어갔어요.'
      );
    } else if (praisePick === 1) {
      parts.push('앞쪽에서 ' + okNames[0] + '을(를) 잘 살렸고, 그걸 바탕으로 더 다듬으면 돼요.');
    } else {
      parts.push('잘한 점은 ' + okNames.join(', ') + '에서 생각을 정리한 부분이에요.');
    }
  } else {
    parts.push('오늘은 모든 단계가 쉽지만은 않았지만, 시도 자체가 연습이 돼요.');
  }

  if (failNames.length) {
    var fn = failNums.length ? failNums[salt % failNums.length] : 0;
    var focusPhrase = '';
    if (fn === 1 || fn === 2) {
      focusPhrase =
        '무엇을 구해야 하는지와 미지수를 정하는 부분을 문제 본문과 한 번 더 대조해보면 좋아요.';
    } else if (fn === 3 || fn === 4) {
      focusPhrase =
        '문장 속 관계를 식이나 방정식으로 옮기는 연습을 조금만 더 하면 좋겠어요.' +
        (body ? ' 문제 속 숫자 관계를 한 줄로 말로 설명해보는 것도 도움이 돼요.' : '');
    } else if (fn === 5) {
      focusPhrase =
        '방정식을 푸는 계산 과정에서 등호 양변을 같은 순서로 정리하는 습관을 들이면 실수가 줄어요.';
    } else if (fn === 6) {
      focusPhrase =
        '구한 값이 문제가 묻는 양과 같은 단위·의미인지 마지막에 점검해보면 좋아요.';
    } else {
      focusPhrase =
        failNames.join(', ') +
        '에서 생각을 한 번 더 곱씹어보면 다음엔 훨씬 수월해져요.';
    }
    parts.push('보완하면 좋은 점은 ' + focusPhrase);
  } else if (t < 5) {
    parts.push('전체적으로는 아직 손이 더 가면 좋은 단계가 있어요. 같은 유형을 한 번 더 풀며 감을 쌓아봐요.');
  }

  if (body.length >= 12) {
    var snippet = body.length > 90 ? body.slice(0, 90) + '…' : body;
    var ctxPick = salt % 2;
    if (ctxPick === 0) {
      parts.push('문제 말 속 상황(예: 「' + snippet + '」)을 떠올리며 식을 세우면 더 잘 맞아요.');
    } else {
      parts.push('이 문맥에서는 관계식을 글로 한 번 말해본 뒤 식으로 옮기면 실수가 줄어요.');
    }
  }

  if (h >= 3) {
    parts.push('힌트를 여러 번 쓴 건 괜찮아요. 다음에는 한 칸만 스스로 채워보고 힌트를 열어보면 더 오래 남아요.');
  }

  var endings = [
    '오늘도 한 걸음 나아갔어요, 화이팅!',
    '천천히 가도 괜찮아요. 다음 수련도 응원할게요!',
    '연습이 쌓이면 분명 달라져요. 힘내요!',
    '스스로를 믿고 한 번 더 도전해봐요, 응원해요!',
  ];
  parts.push(endings[salt % endings.length]);

  return parts.join(' ').trim();
}

/** 스프레드시트·시트 이름은 환경에 맞게 수정 */
/** 학습자 진단·수련 기록 (신규 사용자는 Sheet2만 사용) */
var LEARNER_DATA_SHEET_NAME_ = 'Sheet2';

function getTargetSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LEARNER_DATA_SHEET_NAME_);
  if (!sheet) {
    sheet = ss.getSheetByName('Sheet1');
  }
  if (!sheet) {
    sheet = ss.getSheets()[0];
  }
  return sheet;
}

/**
 * D열 diag_score: 진단 완료 행만 숫자 기록(0 포함). 그 외 행은 빈칸.
 * data.diag_score || "" 같은 패턴 금지 — 0이 빈칸으로 바뀜.
 */
function buildRowFromPayload_(data) {
  var nick = String(data.nickname || data['닉네임'] || '');
  var classCode = String(data.classCode || data['클래스코드'] || '');
  var level = String(data.level || '');

  var status = String(data.status || '');
  var diagCell = '';
  if (status === 'diagnostic_completed' || status === '진단완료') {
    if (
      Object.prototype.hasOwnProperty.call(data, 'diag_score') &&
      Number.isFinite(Number(data.diag_score))
    ) {
      diagCell = Number(data.diag_score);
    } else {
      var fbDiag = firstFiniteNumber_(data.totalScore, data.score, data.total);
      diagCell = fbDiag != null && Number.isFinite(fbDiag) ? fbDiag : '';
    }
  }

  var diagTimeRaw = String(data.diag_time || '').trim();
  var diagTime = diagTimeRaw ? formatLastActivity_(data.diag_time) : '';
  var problem = String(data.problem || data.item || '');
  var type = String(data.type || '');
  var timestampRaw = String(
    data.timestamp || data.completionDate || data.completedAt || ''
  ).trim();
  var timestamp = timestampRaw ? formatLastActivity_(timestampRaw) : '';

  var steps = normalizeSteps_(data);

  var isDiagnostic = status === 'diagnostic_completed' || status === '진단완료';
  var totalCell = '';
  var failCell = '';
  if (!isDiagnostic) {
    totalCell = firstFiniteNumber_(data.total, data.successCount);
    if (totalCell == null) totalCell = '';
    failCell = firstFiniteNumber_(data.fail_count, data.failCount);
    if (failCell == null) failCell = '';
  }

  var hintNum = firstFiniteNumber_(data.hint, data.totalHint);
  var hint = hintNum != null ? hintNum : '';

  var ai = String(data.ai || data.aiFeedback || '');
  var statusCell = isDiagnostic ? status : status || '';

  return [
    nick,
    classCode,
    level,
    diagCell,
    diagTime,
    problem,
    type,
    timestamp,
    steps[0],
    steps[1],
    steps[2],
    steps[3],
    steps[4],
    steps[5],
    steps[6],
    steps[7],
    totalCell,
    failCell,
    hint,
    statusCell,
    ai,
  ];
}

/** 첫 번째로 유한한 숫자를 반환; 없으면 null */
function firstFiniteNumber_() {
  for (var i = 0; i < arguments.length; i++) {
    var n = Number(arguments[i]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeSteps_(data) {
  var keys = [
    'step1',
    'step2',
    'step3',
    'step4',
    'step5_1',
    'step5_2',
    'step5_3',
    'step6',
  ];
  var out = ['', '', '', '', '', '', '', ''];
  var j;
  for (j = 0; j < 8; j++) {
    if (data && Object.prototype.hasOwnProperty.call(data, keys[j])) {
      var direct = data[keys[j]];
      if (direct === 0) {
        out[j] = 0;
      } else if (direct !== '' && direct != null) {
        var nDirect = Number(direct);
        out[j] = Number.isFinite(nDirect) ? nDirect : '';
      }
    }
  }
  if (data && data.step5 !== undefined && data.step5 !== '' && out[4] === '') {
    var legacy5 = Number(data.step5);
    if (data.step5 === 0) out[4] = 0;
    else if (Number.isFinite(legacy5)) out[4] = legacy5;
  }
  var arr = data.scores;
  if (Array.isArray(arr)) {
    for (j = 0; j < 8 && j < arr.length; j++) {
      var v = arr[j];
      if (v === '' || v == null) {
        continue;
      }
      var n = Number(v);
      out[j] = Number.isFinite(n) ? n : '';
    }
  }
  return out;
}
