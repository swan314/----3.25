import { normalizeClassCode } from './classCode.js'
import { MM_TRAINING_LAUNCH_KEY } from './levelConfig.js'

const KEY_NICK = 'mm_learner_nickname'
const KEY_CLASS = 'mm_learner_class_code'

/** 학생 접속 보조 키(프로젝트·확장에서 쓸 수 있는 이름 — 있으면 제거) */
const EXTRA_LEARNER_KEYS = ['savedNickname', 'savedClassCode', 'studentName']

/**
 * @returns {{ nickname: string, classCode: string } | null}
 */
export function readStoredLearner() {
  try {
    const nickname = (localStorage.getItem(KEY_NICK) || '').trim()
    const classRaw = (localStorage.getItem(KEY_CLASS) || '').trim()
    if (!nickname || !classRaw) return null
    return { nickname, classCode: normalizeClassCode(classRaw) }
  } catch {
    return null
  }
}

/**
 * @param {string} nickname
 * @param {string} classCode
 */
export function writeStoredLearner(nickname, classCode) {
  const nick = (nickname || '').toString().trim()
  const cc = normalizeClassCode(classCode)
  if (!nick || !cc) return
  try {
    localStorage.setItem(KEY_NICK, nick)
    localStorage.setItem(KEY_CLASS, cc)
  } catch {
    // ignore quota / private mode
  }
}

export function clearStoredLearner() {
  try {
    localStorage.removeItem(KEY_NICK)
    localStorage.removeItem(KEY_CLASS)
  } catch {
    // noop
  }
}

/**
 * 학생 세션에 쓰는 localStorage·관련 sessionStorage를 모두 비웁니다.
 * (나가기 / 다른 사용자로 접속 공통)
 */
export function clearAllStudentLocalSession() {
  try {
    const toRemove = new Set(EXTRA_LEARNER_KEYS)
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (!k) continue
      // 이 앱 학생 세션은 mm_ 접두사를 씁니다. (교사용 teacher 문자열은 제외)
      if (k.startsWith('mm_') && !/teacher/i.test(k)) toRemove.add(k)
    }
    toRemove.forEach((k) => {
      try {
        localStorage.removeItem(k)
      } catch {
        // noop
      }
    })
    try {
      sessionStorage.removeItem(MM_TRAINING_LAUNCH_KEY)
    } catch {
      // noop
    }
  } catch (e) {
    console.warn('[logout] clear session failed', e)
  }
  console.log('[logout] student session cleared')
}
