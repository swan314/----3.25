import { nextProblemLogic } from './nextProblemLogic'

export function normalizeTrainingKind(raw) {
  const text = String(raw ?? '').trim().replace(/\s+/g, '')
  if (text === '본문제') return '본문제'
  if (text === '유사문제1') return '유사문제1'
  if (text === '유사문제2') return '유사문제2'
  return text
}

/**
 * 단계 + 유형(문제코드 문자) + type(본문제|유사문제*)로 정확히 한 행을 찾습니다.
 */
export function findMatchingTrainingRowIndex(rows, stage, typeCode, trainingType, quiet = false) {
  const st = Number(stage)
  const code = String(typeCode || '').trim().toUpperCase()
  const tk = normalizeTrainingKind(trainingType)

  if (!quiet) {
    console.log('[training-select] 단계:', st)
    console.log('[training-select] 유형:', code)
    console.log('[training-select] type:', tk)
  }

  const matchedRow =
    rows.find(
      (r) =>
        Number(r.__poolStage ?? r['단계']) === st &&
        String(r?.['유형'] || '').trim().toUpperCase() === code &&
        normalizeTrainingKind(r?.type) === tk
    ) || null

  if (!quiet) console.log('[training-select] matched row:', matchedRow)

  if (!matchedRow) return -1
  return rows.indexOf(matchedRow)
}

/**
 * 수련 완료 직후, 총점(total)과 유사문제 규칙으로 다음 행 인덱스를 구합니다.
 * 정확한 행이 없으면 그 뒤 순서에서 첫 본문제로 폴백합니다.
 */
export function resolveNextTrainingRowIndex(rows, currentRow, totalScore, quiet = false) {
  if (!currentRow || !rows?.length) return -1

  const stage = Number(currentRow.__poolStage ?? currentRow['단계'])
  const letter = String(currentRow?.['유형'] || '').trim().toUpperCase()
  const kind = normalizeTrainingKind(currentRow?.type)
  const problemCode = `${stage}-${letter}`

  const { nextType, nextProblem } = nextProblemLogic(kind, totalScore, problemCode, {
    useSimilarProblems: true,
  })

  const m = String(nextProblem || '')
    .trim()
    .toUpperCase()
    .match(/^(\d+)-([A-Z])$/)
  if (!m) return -1

  const ns = Number(m[1])
  const nl = m[2]

  let idx = findMatchingTrainingRowIndex(rows, ns, nl, nextType, quiet)
  if (idx >= 0) return idx

  const cur = rows.indexOf(currentRow)
  for (let i = cur + 1; i < rows.length; i += 1) {
    if (normalizeTrainingKind(rows[i]?.type) === '본문제') return i
  }
  return -1
}
