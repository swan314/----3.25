/**
 * 진단평가 레벨(최상/상/중/하)에 연결할 [학습 문제 데이터] 단계 번호.
 * `public/data/수준{n}단계.csv` 파일을 순서대로 불러옵니다.
 */
export const LEARNING_DATA_STAGES_BY_TIER = {
  /** 최상(손오공) */
  최상: [4, 5, 6],
  /** 상(샤오) */
  상: [3, 4, 5],
  /** 중(삼장) */
  중: [2, 3, 4],
  /** 하(옥동자) */
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

/** 진단 결과 티어 → 캐릭터 이름(버튼 문구 등) */
export const DIAGNOSTIC_TIER_CHARACTER_NAME = {
  최상: '손오공',
  상: '샤오',
  중: '삼장',
  하: '옥동자',
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
 */
export function createTrainingLaunchFromDiagnostic(tierKey, nickname) {
  const stageTypeFilters = LEARNING_STAGE_TYPE_FILTERS_BY_TIER[tierKey]
  return {
    nickname: (nickname || '').trim() || '익명',
    diagnosticTier: tierKey,
    diagnosticRecord: { level: tierKey },
    characterName: getCharacterNameForTier(tierKey),
    stages: getLearningStagesForTier(tierKey),
    stageTypeFilters: stageTypeFilters ? structuredClone(stageTypeFilters) : null,
    source: 'diagnostic_final',
    launchedAt: new Date().toISOString(),
  }
}
