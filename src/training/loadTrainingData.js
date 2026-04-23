import { getTrainingCsvPathForStage } from '../levelConfig'
import { parseLevel1Csv } from './scaffoldUtils'

/**
 * 레벨 매핑에 따라 각 단계 CSV를 순서대로 불러와 한 배열로 합칩니다.
 * 각 행에 `__poolStage`(학습 문제 풀 단계 번호)가 붙습니다.
 * @param {number[]} stageNumbers 예: [5, 6]
 */
export async function loadTrainingRowsForStages(stageNumbers) {
  const merged = []

  for (const sn of stageNumbers) {
    const url = getTrainingCsvPathForStage(sn)
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`${url} 로드 실패 (${res.status})`)
    }
    const text = await res.text()
    const rows = parseLevel1Csv(text)
    for (const r of rows) merged.push({ ...r, __poolStage: sn })
  }

  return merged
}
