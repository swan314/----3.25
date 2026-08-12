/**
 * 2단계(x 정하기) 채점 회귀 테스트
 * Run: node scripts/verify-step2-variable-grading.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'
import {
  matchesStep2VariableAnswer,
  classifyStep2Expected,
} from '../src/training/step2VariableGrading.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const csvPath = path.join(root, 'public/data/training_problems_question_final_0810.csv')

/** @type {Array<{ expected: string, accept: string[], reject: string[] }>} */
const MANUAL_CASES = [
  {
    expected: '두 홀수 중 작은 수',
    accept: ['두 홀수 중 작은 수', '작은 홀수', '더 작은 홀수'],
    reject: ['홀수', '작은 수', '수'],
  },
  {
    expected: '동생의 나이',
    accept: ['동생의 나이', '동생 나이'],
    reject: ['동생', '나이'],
  },
  {
    expected: '집에서 학교까지 거리',
    accept: ['집에서 학교까지 거리', '학교까지 거리', '학교까지의 거리'],
    reject: ['거리', '학교', '집'],
  },
  {
    expected: '전체 학생 수',
    accept: ['전체 학생 수', '전체 학생의 수'],
    reject: ['학생', '전체', '수'],
  },
  {
    expected: '시속 6km로 달린 거리',
    accept: ['시속 6km로 달린 거리', '6km로 달린 거리', '시속 6km 거리'],
    reject: ['거리', '6km', 'km'],
  },
  {
    expected: '연속하는 두 자연수 중 작은 자연수',
    accept: ['연속하는 두 자연수 중 작은 자연수', '작은 자연수', '더 작은 자연수'],
    reject: ['자연수', '작은 수', '연속'],
  },
  {
    expected: '형이 동생에게 주는 우표 개수',
    accept: ['형이 동생에게 주는 우표 개수', '형이 동생에게 주는 우표 수'],
    reject: ['개수', '우표', '동생'],
  },
  {
    expected: '상품의 원가',
    accept: ['상품의 원가', '상품 원가', '원가'],
    reject: ['상품'],
  },
  {
    expected: '직사각형의 세로의 길이',
    accept: ['직사각형의 세로의 길이', '직사각형 세로', '세로의 길이'],
    reject: ['세로', '길이', '직사각형'],
  },
  {
    expected: '은지가 일한 날 수',
    accept: ['은지가 일한 날 수', '은지가 일한 일수', '은지 일한 날 수'],
    reject: ['은지', '날', '수'],
  },
  {
    expected: '일의 자리가 8인 두 자리 자연수의 십의 자리 숫자',
    accept: [
      '일의 자리가 8인 두 자리 자연수의 십의 자리 숫자',
      '일의 자리 8인 수의 십의 자리',
      '십의 자리 숫자',
    ],
    reject: ['8', '자연수', '일의 자리'],
  },
  {
    expected: '형이 출발 후 동생과 만날 때까지 걸린 시간',
    accept: [
      '형이 출발 후 동생과 만날 때까지 걸린 시간',
      '형이 걸린 시간',
      '형이 동생을 만날 때까지 걸린 시간',
      '형이 출발해서 만날 때까지 걸린 시간',
    ],
    reject: ['시간', '동생이 걸린 시간'],
  },
  {
    expected: '두 사람이 출발 후 처음으로 다시 만날 때까지 걸린 시간',
    accept: [
      '두 사람이 출발 후 처음으로 다시 만날 때까지 걸린 시간',
      '두 사람이 만날 때까지 걸린 시간',
      '만날 때까지 걸린 시간',
      '다시 만날 때까지 걸린 시간',
    ],
    reject: ['시간'],
  },
  {
    expected: '어머니의 나이가 아들의 나이의 세 배가 되는 데 걸리는 기간',
    accept: ['어머니의 나이가 아들의 나이의 세 배가 되는 데 걸리는 기간'],
    reject: ['기간', '아들', '시간'],
  },
  {
    expected: '형의 저금액이 동생의 저금액의 2배가 되는데 걸리는 개월 수',
    accept: ['형의 저금액이 동생의 저금액의 2배가 되는데 걸리는 개월 수'],
    reject: ['개월', '저금', '시간'],
  },
]

function loadCsvAnswers() {
  const text = fs.readFileSync(csvPath, 'utf8')
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
  return parsed.data.map((row) => ({
    stage: row['단계'],
    type: row['유형'],
    kind: row.type,
    answer: String(row['2/6정답'] ?? '').replace(/\n/g, ' ').trim(),
  }))
}

function assertCase(label, expected, student, shouldPass) {
  const got = matchesStep2VariableAnswer(student, expected)
  if (got !== shouldPass) {
    return {
      ok: false,
      label,
      expected,
      student,
      shouldPass,
      got,
      type: classifyStep2Expected(expected),
    }
  }
  return { ok: true }
}

function main() {
  const failures = []
  const csvRows = loadCsvAnswers()

  for (const row of csvRows) {
    const label = `${row.stage}-${row.type} ${row.kind}`
    const result = assertCase(label, row.answer, row.answer, true)
    if (!result.ok) failures.push(result)
  }

  const uniqueAnswers = [...new Set(csvRows.map((r) => r.answer))]
  console.log(`CSV 2단계 정답: ${csvRows.length}행, 고유 ${uniqueAnswers.length}개`)

  for (const manual of MANUAL_CASES) {
    for (const student of manual.accept) {
      const result = assertCase(`accept:${manual.expected}`, manual.expected, student, true)
      if (!result.ok) failures.push(result)
    }
    for (const student of manual.reject) {
      const result = assertCase(`reject:${manual.expected}`, manual.expected, student, false)
      if (!result.ok) failures.push(result)
    }
  }

  const partialRejectByType = {
    T7_odd: ['홀수', '작은 수'],
    T9_distance: ['거리'],
    T1: ['나이'],
    T2: ['개수', '학생'],
    T5: ['시간'],
  }

  for (const answer of uniqueAnswers) {
    const type = classifyStep2Expected(answer)
    const partials = partialRejectByType[type] ?? ['수']
    for (const partial of partials) {
      const result = assertCase(`partial-reject:${type}`, answer, partial, false)
      if (!result.ok) failures.push(result)
    }
  }

  if (failures.length) {
    console.error(`FAILED ${failures.length} case(s):`)
    for (const f of failures) {
      console.error(
        `- [${f.label}] type=${f.type} student="${f.student}" want=${f.shouldPass} got=${f.got} expected="${f.expected}"`,
      )
    }
    process.exit(1)
  }

  console.log('All step2 variable grading checks passed.')
}

main()
