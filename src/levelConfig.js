import { normalizeClassCode } from './classCode.js'

/**
 * 진단평가 레벨(최상/상/중/하)에 연결할 [학습 문제 데이터] 단계 번호.
 * `public/data/수준{n}단계.csv` 파일을 순서대로 불러옵니다.
 */
export const LEARNING_DATA_STAGES_BY_TIER = {
  /** 최상: 손오공 */
  최상: [4, 5, 6],
  /** 상: 샤오 */
  상: [3, 4, 5],
  /** 중: 삼장 */
  중: [2, 3, 4],
  /** 하: 옥동자 */
  하: [1, 2, 3],
}

/**
 * 티어별 단계 내 문제 유형 필터.
 * 키: 단계 번호, 값: 허용할 유형 배열
 */
export const LEARNING_STAGE_TYPE_FILTERS_BY_TIER = {
  최상: {
    4: ['C', 'D', 'E'],
  },
}

/** 진단 결과 티어 → 캐릭터 이름 (표시: `이름(티어)` 예: 손오공(최상)) */
export const DIAGNOSTIC_TIER_CHARACTER_NAME = {
  최상: '손오공',
  상: '샤오',
  중: '삼장',
  하: '옥동자',
}

/**
 * 시트·세션의 표시용 레벨 문자열을 최상|상|중|하 로 통일.
 * (예: legacy 진단 저장 `손오공(최상)`, `샤오(상)` — React 쪽 이미지 키와 불일치하던 원인)
 */
export function resolveCanonicalDiagnosticTier(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return '하'

  const paren = text.match(/\(\s*(최상|상|중|하)\s*\)/)
  if (paren?.[1]) return paren[1]

  if (text === '최상' || text === '상' || text === '중' || text === '하') return text

  if (/손오공|방정\s*대마법사/.test(text)) return '최상'
  if (/샤오|수식\s*현자/.test(text)) return '상'
  if (/삼장|탐구\s*마법사/.test(text)) return '중'
  if (/옥동자|입문\s*마법사/.test(text)) return '하'

  if (text.includes('최상')) return '최상'
  if (text.includes('중')) return '중'
  if (text.includes('상')) return '상'
  return '하'
}

export const MM_TRAINING_LAUNCH_KEY = 'mm_training_launch'

/**
 * @param {'최상' | '상' | '중' | '하'} tierKey
 * @returns {number[]} 단계 번호 목록 (중복 없이 설정 순서 유지)
 */
export function getLearningStagesForTier(tierKey) {
  const stages = LEARNING_DATA_STAGES_BY_TIER[tierKey]
  return stages ? [...stages] : [...LEARNING_DATA_STAGES_BY_TIER.하]
}

/**
 * @param {'최상' | '상' | '중' | '하'} tierKey
 */
export function getCharacterNameForTier(tierKey) {
  return DIAGNOSTIC_TIER_CHARACTER_NAME[tierKey] ?? DIAGNOSTIC_TIER_CHARACTER_NAME.하
}

/** 진단 완료 등에서 시트와 동일한 라벨: `손오공(최상)`, `샤오(상)` … */
export function formatDiagnosticCharacterLabel(tierKeyOrRaw) {
  const key = resolveCanonicalDiagnosticTier(tierKeyOrRaw)
  return `${DIAGNOSTIC_TIER_CHARACTER_NAME[key]}(${key})`
}

/**
 * @param {number} stageNumber 학습 데이터 단계(파일 접미사)
 */
export function getTrainingCsvPathForStage(stageNumber) {
  return `/data/수준${stageNumber}단계.csv`
}

/**
 * 진단 최종 결과 화면에서 수련 모드로 넘길 세션 페이로드.
 * @param {'최상' | '상' | '중' | '하'} tierKey
 * @param {string} nickname
 * @param {string} [classCode] 반·클래스 식별자(비우면 기본 클래스)
 */
export function createTrainingLaunchFromDiagnostic(tierKeyRaw, nickname, classCode) {
  const tierKey = resolveCanonicalDiagnosticTier(tierKeyRaw)
  const stageTypeFilters = LEARNING_STAGE_TYPE_FILTERS_BY_TIER[tierKey]
  return {
    nickname: (nickname || '').trim() || '익명',
    classCode: normalizeClassCode(classCode),
    diagnosticTier: tierKey,
    diagnosticRecord: { level: tierKey },
    characterName: getCharacterNameForTier(tierKey),
    stages: getLearningStagesForTier(tierKey),
    stageTypeFilters: stageTypeFilters ? structuredClone(stageTypeFilters) : null,
    source: 'diagnostic_final',
    launchedAt: new Date().toISOString(),
  }
}
