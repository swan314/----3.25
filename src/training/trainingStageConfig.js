/** 학생 본 진행 6단계 (1/6 ~ 6/6) */
export const TRAINING_STAGE_COUNT = 6

/** Google Sheet 물리 슬롯 8칸 (step5_2·step5_3 열 유지, 신규 기록은 빈칸) */
export const TRAINING_SHEET_SLOT_COUNT = 8

/** 시트·저장 payload 단계 키 (열 위치 고정 — 변경하지 않음) */
export const TRAINING_SHEET_STEP_KEYS = [
  'step1',
  'step2',
  'step3',
  'step4',
  'step5_1',
  'step5_2',
  'step5_3',
  'step6',
]

/** 본 진행 index(0~5) → Sheet 키 */
export const PROGRESS_INDEX_TO_SHEET_KEY = {
  0: 'step1',
  1: 'step2',
  2: 'step3',
  3: 'step4',
  4: 'step5_1',
  5: 'step6',
}

export const TRAINING_STAGES = [
  {
    id: 'step1',
    qKey: '1/6문제',
    gradeKey: '1/6정답',
    choiceGradeKey: '1/6선택정답',
    displayLabel: '1단계',
    isChoice: true,
    hintOrder: '1',
  },
  {
    id: 'step2',
    qKey: '2/6문제',
    gradeKey: '2/6정답',
    displayLabel: '2단계',
    isChoice: false,
    hintOrder: '2',
  },
  {
    id: 'step3',
    qKey: '3/6문제',
    gradeKey: '3/6정답',
    displayLabel: '3단계',
    isChoice: false,
    hintOrder: '3',
  },
  {
    id: 'step4',
    qKey: '4/6문제',
    gradeKey: '4/6정답',
    displayLabel: '4단계',
    isChoice: false,
    hintOrder: '4',
  },
  {
    id: 'step5',
    qKey: '5/6문제',
    gradeKey: '5/6정답',
    displayLabel: '5단계',
    isChoice: false,
    hintOrder: '5',
  },
  {
    id: 'step6',
    qKey: '6/6문제',
    gradeKey: '6/6정답',
    displayLabel: '6단계',
    isChoice: false,
    hintOrder: '6',
  },
]

/** AI·결과 화면용 단계 의미 */
export const TRAINING_STEP_MEANINGS = [
  '문제에서 구하려는 것 확인',
  '미지수 설정',
  '필요한 양을 식으로 표현',
  '방정식 세우기',
  '방정식 풀기',
  '문제에서 요구하는 답 구하기',
]

export function getSheetKeyForProgressIndex(progressIndex) {
  return PROGRESS_INDEX_TO_SHEET_KEY[progressIndex] ?? null
}

export function getTrainingStage(stepIdx) {
  return TRAINING_STAGES[stepIdx] ?? null
}

export function getTrainingStageDisplayLabel(stepIdx) {
  return getTrainingStage(stepIdx)?.displayLabel ?? `${stepIdx + 1}단계`
}

export function getTrainingStageHintOrder(stepIdx) {
  return getTrainingStage(stepIdx)?.hintOrder ?? String(stepIdx + 1)
}

export function getStageQuestionText(row, stage) {
  if (!row || !stage) return ''
  return String(row[stage.qKey] ?? '').trim()
}

export function getStageGradeAnswer(row, stage) {
  if (!row || !stage) return ''
  return String(row[stage.gradeKey] ?? '').trim()
}

export function getStageChoiceGradeAnswer(row, stage) {
  if (!row || !stage?.choiceGradeKey) return ''
  return String(row[stage.choiceGradeKey] ?? '').trim()
}

/** CSV training_key: 빈칸·skip이면 false (레거시 참고용) */
export function isStageTrainingKeyVisible(trainingKeyRaw) {
  const key = String(trainingKeyRaw ?? '').trim()
  if (!key) return false
  return key.toLowerCase() !== 'skip'
}

/** 1차: 집중학습·스캐폴딩 UI 비활성 (추후 STEP5_SUPPORT_ENABLED 등으로 연결) */
export function shouldShowStepFocusedLearningButton(/* row, stepIdx */) {
  return false
}

/** CSV 셀의 training_key 목록 (쉼표 구분, 빈칸·skip 제외) */
export function parseTrainingKeysFromCsvCell(trainingKeyRaw) {
  return String(trainingKeyRaw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((key) => isStageTrainingKeyVisible(key))
}

/** 문제 텍스트 없음 또는 "skip"이면 해당 단계 제외 */
export function isTrainingStageSkipped(row, stage) {
  const text = getStageQuestionText(row, stage)
  if (!text) return true
  return text.toLowerCase() === 'skip'
}

export function isTrainingStageActive(row, stage) {
  return !isTrainingStageSkipped(row, stage)
}

/**
 * 모든 문항 6단계 고정 진행 index [0..5].
 * @returns {number[]}
 */
export function getActiveTrainingStageIndices(row) {
  if (!row) return []
  const indices = []
  for (let i = 0; i < TRAINING_STAGE_COUNT; i += 1) {
    const stage = TRAINING_STAGES[i]
    if (stage && isTrainingStageActive(row, stage)) {
      indices.push(i)
    }
  }
  return indices.length ? indices : [0, 1, 2, 3, 4, 5]
}

export function getFirstActiveTrainingStageIndex(row) {
  const indices = getActiveTrainingStageIndices(row)
  return indices.length ? indices[0] : 0
}

/** @returns {number|null} 다음 활성 단계 인덱스, 없으면 null */
export function getNextActiveTrainingStageIndex(row, currentIndex) {
  const indices = getActiveTrainingStageIndices(row)
  const pos = indices.indexOf(currentIndex)
  if (pos < 0) return indices[0] ?? null
  return pos < indices.length - 1 ? indices[pos + 1] : null
}

export function isLastActiveTrainingStageIndex(row, currentIndex) {
  const indices = getActiveTrainingStageIndices(row)
  if (!indices.length) return currentIndex === TRAINING_STAGE_COUNT - 1
  return indices[indices.length - 1] === currentIndex
}

export function isSecondToLastActiveTrainingStageIndex(row, currentIndex) {
  const indices = getActiveTrainingStageIndices(row)
  if (indices.length < 2) return false
  return indices[indices.length - 2] === currentIndex
}

/** 정답이 x=숫자 형태면 숫자만 입력 UI (5단계) */
export function isXValueNumericAnswer(expectedRaw) {
  const compact = String(expectedRaw ?? '')
    .trim()
    .replace(/\s+/g, '')
  if (!compact) return false
  return /^x=-?\d+(?:\.\d+)?$/i.test(compact)
}

/** UI에 x= 접두, 채점 시 x=4 형태로 맞춤 */
export function formatStudentXValueAnswer(studentRaw) {
  const value = String(studentRaw ?? '').trim()
  if (!value) return ''
  const compact = value.replace(/\s+/g, '')
  if (/^x=/i.test(compact)) return compact
  return `x=${value}`
}
