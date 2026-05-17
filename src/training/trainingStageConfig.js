/** 수련 문제 CSV 8단계 정의 (1/6 ~ 6/6, 5/6은 5-1~5-3 분할) */
export const TRAINING_STAGE_COUNT = 8

/** 시트·저장 payload 단계 키 (TRAINING_STAGES 순서와 동일) */
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
    id: 'step5_1',
    qKey: '5/6-step1문제',
    gradeKey: '5/6-step1정답',
    trainingKeyCol: 'step5_1_training',
    displayLabel: '5-1단계',
    isChoice: false,
    hintOrder: '5_1',
  },
  {
    id: 'step5_2',
    qKey: '5/6-step2문제',
    gradeKey: '5/6-step2정답',
    trainingKeyCol: 'step5_2_training',
    displayLabel: '5-2단계',
    isChoice: false,
    hintOrder: '5_2',
  },
  {
    id: 'step5_3',
    qKey: '5/6-step3문제',
    gradeKey: '5/6-step3정답',
    trainingKeyCol: 'step5_3_training',
    displayLabel: '5-3단계',
    isChoice: false,
    hintOrder: '5_3',
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

/** AI·결과 화면용 단계 의미 (표시 라벨과 별개) */
export const TRAINING_STEP_MEANINGS = [
  '무엇을 구하는지 파악',
  '미지수 설정',
  '문제 상황을 식으로 표현',
  '방정식 세우기',
  '방정식 풀기 (식 정리)',
  '방정식 풀기 (항 이동)',
  '방정식 풀기 (계수 나누기)',
  '구한 값을 문제 상황에 맞게 해석',
]

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

export function getStageTrainingKey(row, stage) {
  if (!row || !stage?.trainingKeyCol) return ''
  return String(row[stage.trainingKeyCol] ?? '').trim()
}

/** CSV training_key: 빈칸·skip이면 false */
export function isStageTrainingKeyVisible(trainingKeyRaw) {
  const key = String(trainingKeyRaw ?? '').trim()
  if (!key) return false
  return key.toLowerCase() !== 'skip'
}

/** step5_1~5_3이고 training_key가 유효할 때만 단계 집중 학습 버튼 표시 */
export function shouldShowStepFocusedLearningButton(row, stepIdx) {
  const stage = getTrainingStage(stepIdx)
  if (!stage?.trainingKeyCol) return false
  return isStageTrainingKeyVisible(getStageTrainingKey(row, stage))
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
 * 현재 문제 행 기준 실제 진행할 단계 인덱스(0~7, TRAINING_STAGES 순서).
 * @returns {number[]}
 */
export function getActiveTrainingStageIndices(row) {
  if (!row) return []
  return TRAINING_STAGES.map((stage, index) => ({ stage, index }))
    .filter(({ stage }) => isTrainingStageActive(row, stage))
    .map(({ index }) => index)
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
  if (!indices.length) return true
  return indices[indices.length - 1] === currentIndex
}

/** 정답이 x=숫자 형태면 계수 나누기(숫자만 입력) 단계 */
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
