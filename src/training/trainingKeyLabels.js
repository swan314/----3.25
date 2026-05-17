/** step_training.csv training_key → 학생 화면용 한글 개념명 (내부 조회 키는 영문 그대로) */
export const TRAINING_KEY_DISPLAY_LABELS = {
  distributive: '분배법칙',
  combine_like_terms: '동류항 계산하기',
  move_term: '이항하기',
  clear_fraction: '분수 또는 소수를 정수로 만들기',
  divide_coefficient: 'x의 계수로 나누기',
}

/**
 * @param {string} trainingKey
 * @returns {string}
 */
export function getTrainingKeyDisplayLabel(trainingKey) {
  const key = String(trainingKey ?? '').trim()
  if (!key) return ''
  return TRAINING_KEY_DISPLAY_LABELS[key] ?? key
}
