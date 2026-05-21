/** CSV·aiPayload·분석 객체에 problemPrinciple / problemStrategy 정규화 */

export function normalizeTrainingPedagogyFields(row) {
  if (!row || typeof row !== 'object') return row
  return {
    ...row,
    problemPrinciple: String(row.problemPrinciple ?? '').trim(),
    problemStrategy: String(row.problemStrategy ?? '').trim(),
  }
}

export function getTrainingPedagogyFromRecord(record) {
  const input = record || {}
  const meta = input.problemMeta || {}
  return {
    problemPrinciple: String(input.problemPrinciple ?? meta.problemPrinciple ?? '').trim(),
    problemStrategy: String(input.problemStrategy ?? meta.problemStrategy ?? '').trim(),
  }
}
