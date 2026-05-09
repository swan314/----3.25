/**
 * 클래스(반) 단위로 학습자를 구분하기 위한 코드.
 * 시트·API·URL 쿼리에서 동일한 정규화 규칙을 쓰도록 한곳에 둡니다.
 * 향후 여러 클래스: 코드 문자열만 늘리면 되고, 관리자/조회 API는 classCode로 필터합니다.
 */
export const DEFAULT_CLASS_CODE = 'DEFAULT-CLASS'

/**
 * @param {unknown} raw
 * @returns {string} 비어 있으면 {@link DEFAULT_CLASS_CODE}
 */
export function normalizeClassCode(raw) {
  const t = (raw ?? '').toString().trim()
  return t || DEFAULT_CLASS_CODE
}

/** 교사 이메일 비교용: 공백·제로폭 제거, 소문자, Gmail 로컬부 점 무시 */
export function normalizeTeacherEmailForCompare(raw) {
  let s = (raw ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00a0/g, '')
    .trim()
  const at = s.indexOf('@')
  if (at > 0 && s.slice(at + 1) === 'gmail.com') {
    const local = s.slice(0, at).replace(/\./g, '')
    s = `${local}@gmail.com`
  }
  return s
}

/**
 * legacy.html 해시 쿼리에서 닉네임·클래스 코드를 읽습니다.
 * @returns {{ nickname: string, classCode: string }}
 */
export function readStudentQueryParams() {
  try {
    const hashRaw = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '')
    const queryIndex = hashRaw.indexOf('?')
    if (queryIndex === -1) {
      return { nickname: '', classCode: DEFAULT_CLASS_CODE }
    }
    const params = new URLSearchParams(hashRaw.slice(queryIndex + 1))
    const nickname = (params.get('nickname') || '').trim()
    const classCode = normalizeClassCode(params.get('classCode'))
    return { nickname, classCode }
  } catch {
    return { nickname: '', classCode: DEFAULT_CLASS_CODE }
  }
}

/**
 * @param {{ nickname?: string, classCode?: string }} p
 * @returns {string} `?nickname=...&classCode=...` (nickname 없으면 classCode만)
 */
export function buildStudentHashQuery(p = {}) {
  const nickname = (p.nickname ?? '').toString().trim()
  const classCode = normalizeClassCode(p.classCode)
  const q = new URLSearchParams()
  if (nickname) q.set('nickname', nickname)
  q.set('classCode', classCode)
  const s = q.toString()
  return s ? `?${s}` : ''
}

/**
 * 시트/JSON 레코드에서 클래스 코드 필드를 꺼냅니다.
 * @param {Record<string, unknown>} record
 */
export function readClassCodeFromRecord(record) {
  if (!record || typeof record !== 'object') return DEFAULT_CLASS_CODE
  const raw =
    record.classCode ??
    record.클래스코드 ??
    record['클래스 코드'] ??
    record.class_code ??
    ''
  return normalizeClassCode(raw)
}

/**
 * @param {Record<string, unknown>} record
 */
export function readNicknameFromRecord(record) {
  if (!record || typeof record !== 'object') return ''
  const raw = record.nickname ?? record.닉네임 ?? record.Nickname ?? ''
  return (raw ?? '').toString().trim()
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} targetNickname
 * @param {string} targetClassCode
 */
export function recordMatchesLearner(record, targetNickname, targetClassCode, opts = {}) {
  const nick = (targetNickname || '').toString().trim()
  const cc = normalizeClassCode(targetClassCode)
  if (!nick) return true
  if (readNicknameFromRecord(record) !== nick) return false
  // 닉네임만으로 시트 전체에서 해당 학습자 행을 모을 때 (클래스 코드 필터 생략)
  if (opts?.classOptional === true) return true
  return readClassCodeFromRecord(record) === cc
}
