import Papa from 'papaparse'
import { normalizeTrainingKind } from './trainingRowSelect'

export const SCAFFOLDING_TEST_CSV_PATH = '/data/scaffolding_test_with_concept_key.csv'

/** @typedef {{
 *   stage: number,
 *   typeLetter: string,
 *   trainingType: string,
 *   scaffoldType: string,
 *   scaffoldStep: number,
 *   conceptKey: string,
 *   question: string,
 *   choices: string[],
 *   correctChoice: number,
 *   correctText: string,
 *   remember: string,
 * }} ScaffoldingTestStep */

let scaffoldingStepsCache = []
let scaffoldingLoaded = false

function normalizeScaffoldingRow(raw) {
  const stage = Number(raw?.['단계'] ?? raw?.stage)
  const scaffoldStep = Number(raw?.scaffold_step)
  return {
    stage: Number.isFinite(stage) ? stage : NaN,
    typeLetter: String(raw?.['유형'] ?? '').trim().toUpperCase(),
    trainingType: normalizeTrainingKind(raw?.type),
    scaffoldType: String(raw?.scaffold_type ?? '').trim(),
    scaffoldStep: Number.isFinite(scaffoldStep) ? scaffoldStep : NaN,
    conceptKey: String(raw?.concept_key ?? '').trim(),
    question: String(raw?.question ?? '').trim(),
    choice1: String(raw?.choice1 ?? '').trim(),
    choice2: String(raw?.choice2 ?? '').trim(),
    choice3: String(raw?.choice3 ?? '').trim(),
    correctChoice: Number(raw?.correct_choice),
    correctText: String(raw?.correct_text ?? '').trim(),
    remember: String(raw?.remember ?? '').trim(),
  }
}

function toScaffoldingStep(row) {
  const choices = [row.choice1, row.choice2, row.choice3].filter(Boolean)
  return {
    stage: row.stage,
    typeLetter: row.typeLetter,
    trainingType: row.trainingType,
    scaffoldType: row.scaffoldType,
    scaffoldStep: row.scaffoldStep,
    conceptKey: row.conceptKey,
    question: row.question,
    choices,
    correctChoice: row.correctChoice,
    correctText: row.correctText,
    remember: row.remember,
  }
}

function resolveProblemKeys(row) {
  if (!row) return null
  const stage = Number(row.__poolStage ?? row['학습단계'] ?? row['단계'])
  const typeLetter = String(row['유형'] ?? '').trim().toUpperCase()
  const trainingType = normalizeTrainingKind(row?.type)
  if (!Number.isFinite(stage) || !typeLetter || !trainingType) return null
  return { stage, typeLetter, trainingType }
}

export function isScaffoldingTestDataLoaded() {
  return scaffoldingLoaded
}

export async function loadScaffoldingTestData(
  csvPath = SCAFFOLDING_TEST_CSV_PATH,
) {
  try {
    const res = await fetch(csvPath)
    if (!res.ok) {
      throw new Error(`scaffolding test CSV load failed (${res.status}): ${csvPath}`)
    }
    const text = await res.text()
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: 'greedy',
    })
    if (parsed.errors?.length) {
      throw new Error(parsed.errors[0]?.message || 'scaffolding test CSV parse error')
    }
    scaffoldingStepsCache = (parsed.data || [])
      .map(normalizeScaffoldingRow)
      .filter(
        (row) =>
          Number.isFinite(row.stage) &&
          row.typeLetter &&
          row.trainingType &&
          Number.isFinite(row.scaffoldStep) &&
          row.question,
      )
      .map(toScaffoldingStep)
    console.log('[scaffolding-test] loaded rows:', scaffoldingStepsCache.length)
  } catch (err) {
    console.warn('[scaffolding-test] load failed:', err)
    scaffoldingStepsCache = []
  } finally {
    scaffoldingLoaded = true
  }
  return scaffoldingStepsCache
}

/** @returns {ScaffoldingTestStep[]} */
export function getScaffoldingStepsForRow(row) {
  if (!scaffoldingLoaded || !row) return []
  const keys = resolveProblemKeys(row)
  if (!keys) return []

  return scaffoldingStepsCache
    .filter(
      (step) =>
        step.stage === keys.stage &&
        step.typeLetter === keys.typeLetter &&
        step.trainingType === keys.trainingType,
    )
    .sort((a, b) => a.scaffoldStep - b.scaffoldStep)
}

export function hasScaffoldingForRow(row) {
  return getScaffoldingStepsForRow(row).length > 0
}
