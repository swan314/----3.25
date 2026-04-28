import { getStagesByLevel } from './config/curriculumConfig'; // 경로가 다르면 맞게 수정해주세요
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { updateSupplement } from './sheets'
import {
  blanksAllCorrect,
  hasBlanks,
  matchesScaffoldExpected,
  splitByParentheses,
} from './training/scaffoldUtils'
import { loadGroupedTrainingData } from './utils/dataLoader'

const DEFAULT_CSV_PATH = '/data/training_problems_with_similar_v2.csv'

const STAGE_DEF = [
  { qKey: '비계1(구하고자 하는 것은 무엇인가요?)', aKey: null },
  { qKey: '비계2(미지수를 정해보자)', aKey: null },
  { qKey: '비계3(수학적 의미 찾기)', aKey: '비계3 정답' },
  { qKey: '비계4(방정식 세우기)', aKey: '비계4 정답' },
  { qKey: '비계5(방정식 풀기)', aKey: '비계5 정답' },
  { qKey: '비계6(답 구하기)', aKey: '비계6 정답' },
]

function hintColumnsFromFlags(flags) {
  /** @type {Record<string, 'Y' | 'N'>} */
  const o = {}
  for (let i = 0; i < 6; i += 1) {
    o[`비계단계_${i + 1}_힌트여부`] = flags[i] ? 'Y' : 'N'
  }
  return o
}

/**
 * @typedef {{
 *   nickname?: string,
 *   diagnosticTier?: string,
 *   characterName?: string,
 *   stages?: number[],
 *   source?: string,
 *   launchedAt?: string,
 *   resultHeadline?: string,
 *   diagnosticTotalScore?: number,
 *   diagnosticMaxScore?: number,
 * }} TrainingPlan
 */

export default function TrainingMode({ nickname, onExit, trainingPlan = null }) {
  const [rows, setRows] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [problemIdx, setProblemIdx] = useState(0)
  const [stepIdx, setStepIdx] = useState(0)
  /** @type {[boolean[], function]} */
  const [hintFlags, setHintFlags] = useState(() => Array(6).fill(false))
  /** 진단·수련 세션 동안 힌트 버튼을 누른 횟수 */
  const [hintUsageCount, setHintUsageCount] = useState(0)
  /** 괄호 빈칸 값: 키 `${stepIdx}-${blankIdx}` */
  const [blankValues, setBlankValues] = useState({})
  const [textAnswer, setTextAnswer] = useState('')
  const blankLogTimer = useRef(null)

  useEffect(() => {
    setHintUsageCount(0)
    setHintFlags(Array(6).fill(false))
    setProblemIdx(0)
    setStepIdx(0)
    setBlankValues({})
    setTextAnswer('')
  }, [trainingPlan?.launchedAt])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setIsLoading(true)
      setRows([])
      setLoadError('')
      try {
        const grouped = await loadGroupedTrainingData(DEFAULT_CSV_PATH)
        if (cancelled) return

        const targetLevels = trainingPlan?.stages?.length
          ? trainingPlan.stages.map((n) => String(n))
          : Object.keys(grouped).sort((a, b) => Number(a) - Number(b))

        const merged = targetLevels.flatMap((level) =>
          (grouped[level] || []).map((row) => ({
            ...row,
            __poolStage: Number(level),
          }))
        )

        setRows(merged)
        setProblemIdx(0)
        setStepIdx(0)
        if (!merged.length) {
          setLoadError('수련문제 데이터를 찾지 못했습니다.')
        }
        console.log('[TrainingMode] loaded rows', merged)
      } catch (e) {
        if (!cancelled) setLoadError(e?.message || 'CSV를 불러오지 못했습니다.')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [trainingPlan])

  useEffect(() => {
    if (!rows.length) return
    const resumeStage = Number(trainingPlan?.resumeStage)
    const resumeProblemNumber = Number(trainingPlan?.resumeProblemNumber)
    if (!Number.isFinite(resumeStage) || !Number.isFinite(resumeProblemNumber)) return
    if (resumeStage <= 0 || resumeProblemNumber <= 0) return

    const indices = rows
      .map((r, idx) => ({ stage: Number(r.__poolStage), idx }))
      .filter((r) => r.stage === resumeStage)
      .map((r) => r.idx)
    if (!indices.length) return

    const stageStartIndex = indices[0]
    const boundedOffset = Math.min(Math.max(Math.floor(resumeProblemNumber) - 1, 0), indices.length - 1)
    setProblemIdx(stageStartIndex + boundedOffset)
    setStepIdx(0)
  }, [rows, trainingPlan?.resumeStage, trainingPlan?.resumeProblemNumber])

  const row = rows[problemIdx] || null

  const currentDef = STAGE_DEF[stepIdx]
  const questionText = row && currentDef ? row[currentDef.qKey] ?? '' : ''
  const expectedAnswer = row && currentDef?.aKey ? row[currentDef.aKey] ?? '' : ''

  const blankParts = useMemo(() => splitByParentheses(questionText), [questionText])
  const stageUsesBlanks = stepIdx <= 1 && hasBlanks(questionText)

  const sendTrainingLog = useCallback(
    async (eventSubType, extra = {}, hintFlagOverride = null) => {
      if (!row) return
      const flags = hintFlagOverride ?? hintFlags
      const base = {
        eventType: 'training_mode_log',
        eventSubType,
        mode: '수련',
        닉네임: nickname,
        문제번호: problemIdx + 1,
        수준단계: row['단계'] ?? '',
        유형: row['유형'] ?? '',
        학습데이터_단계: row.__poolStage ?? '',
        비계질문_순서: stepIdx + 1,
        문제_요지: row['문제 텍스트'] ?? '',
        힌트_사용_누적_횟수: hintUsageCount,
        ...hintColumnsFromFlags(flags),
        completionDate: new Date().toISOString(),
        ...extra,
      }
      return updateSupplement(base)
    },
    [nickname, row, stepIdx, hintFlags, hintUsageCount, problemIdx]
  )

  useEffect(() => {
    if (!trainingPlan?.launchedAt || !rows.length) return
    const gateKey = `mm_training_entry_${trainingPlan.launchedAt}`
    if (sessionStorage.getItem(gateKey)) return
    sessionStorage.setItem(gateKey, '1')
    updateSupplement({
      eventType: 'training_mode_log',
      eventSubType: '수련 모드 진입',
      mode: '수련',
      닉네임: nickname,
      진단_레벨: trainingPlan.diagnosticTier ?? '',
      캐릭터: trainingPlan.characterName ?? '',
      매핑_학습단계: (trainingPlan.stages || []).join(','),
      이어하기_단계: trainingPlan.resumeStage ?? '',
      이어하기_문제번호: trainingPlan.resumeProblemNumber ?? '',
      진단_결과_헤드라인: trainingPlan.resultHeadline ?? '',
      completionDate: new Date().toISOString(),
    }).catch(() => {})
  }, [trainingPlan, rows.length, nickname])

  const queueBlankSupplement = useCallback(
    (detail) => {
      if (blankLogTimer.current) window.clearTimeout(blankLogTimer.current)
      blankLogTimer.current = window.setTimeout(() => {
        sendTrainingLog('blank_input', {
          ...detail,
          힌트_사용_누적_횟수: hintUsageCount,
        }).catch(() => {})
      }, 280)
    },
    [sendTrainingLog, hintUsageCount]
  )

  useEffect(
    () => () => {
      if (blankLogTimer.current) window.clearTimeout(blankLogTimer.current)
    },
    []
  )

  const canAdvance = useMemo(() => {
    if (!row || !questionText) return false
    if (stepIdx <= 1 && stageUsesBlanks) {
      return blanksAllCorrect(questionText, blankValues, stepIdx)
    }
    if (stepIdx <= 1 && !stageUsesBlanks) {
      return Boolean((textAnswer || '').trim())
    }
    return matchesScaffoldExpected(textAnswer, expectedAnswer)
  }, [row, questionText, stepIdx, stageUsesBlanks, blankValues, textAnswer, expectedAnswer])

  useEffect(() => {
    setBlankValues({})
    setTextAnswer('')
  }, [problemIdx, stepIdx])

  const handleBlankChange = (key, expectedInner, value) => {
    setBlankValues((prev) => ({ ...prev, [key]: value }))
    queueBlankSupplement({
      빈칸_키: key,
      빈칸_기대값: expectedInner,
      빈칸_입력값: value,
      비계_단계_라벨: `비계${stepIdx + 1}`,
    })
  }

  const renderQuestionBody = () => {
    if (!row) return null
    if (stepIdx <= 1 && stageUsesBlanks) {
      let bi = 0
      return (
        <p className="text-lg leading-relaxed text-slate-800">
          {blankParts.map((part, pi) => {
            if (part.type === 'text') {
              return <span key={`t-${pi}`}>{part.value}</span>
            }
            const idx = bi
            bi += 1
            const key = `${stepIdx}-${idx}`
            const expected = (part.expected ?? '').trim()
            const val = blankValues[key] ?? ''
            const correct = val.trim() !== '' && val.trim() === expected
            const wrong = val.trim() !== '' && val.trim() !== expected
            return (
              <input
                key={`b-${stepIdx}-${pi}`}
                type="text"
                value={val}
                onChange={(e) => handleBlankChange(key, expected, e.target.value)}
                aria-label={`빈칸 ${idx + 1}`}
                autoComplete="off"
                className={[
                  'mx-0.5 inline-block min-w-[5.5rem] max-w-[14rem] rounded-md border-2 border-dashed bg-white px-2 py-0.5 align-middle text-base font-semibold outline-none transition',
                  correct ? 'border-emerald-500 text-emerald-800' : '',
                  wrong ? 'border-red-500 text-red-700' : '',
                  !correct && !wrong ? 'border-amber-400 text-slate-800' : '',
                ].join(' ')}
              />
            )
          })}
        </p>
      )
    }

    return (
      <div className="space-y-3">
        <p className="whitespace-pre-wrap text-lg leading-relaxed text-slate-800">{questionText}</p>
        <label className="block text-sm font-semibold text-slate-700" htmlFor="training-free-text">
          답 입력
        </label>
        <input
          id="training-free-text"
          type="text"
          value={textAnswer}
          onChange={(e) => setTextAnswer(e.target.value)}
          placeholder="답을 입력하세요"
          className="w-full rounded-xl border border-yellow-300 bg-white px-4 py-3 text-base outline-none ring-yellow-300 transition focus:ring-2"
        />
      </div>
    )
  }

  const handleHint = async () => {
    const nextFlags = [...hintFlags]
    nextFlags[stepIdx] = true
    setHintFlags(nextFlags)

    const nextHintCount = hintUsageCount + 1
    setHintUsageCount(nextHintCount)

    let hintBody = expectedAnswer || questionText
    if (stepIdx <= 1 && stageUsesBlanks) {
      const blanks = blankParts.filter((p) => p.type === 'blank').map((p) => p.expected)
      hintBody = blanks.length ? blanks.join(', ') : hintBody
    }

    await sendTrainingLog(
      'hint',
      {
        힌트_요지: hintBody,
        힌트_사용_누적_횟수: nextHintCount,
      },
      nextFlags
    )
    window.alert(`힌트\n${hintBody}`)
  }

  const handleNext = async () => {
    if (!canAdvance) return
    const answerSnapshot =
      stepIdx <= 1 && stageUsesBlanks
        ? Object.entries(blankValues)
            .filter(([k]) => k.startsWith(`${stepIdx}-`))
            .map(([k, v]) => `${k}=${v}`)
            .join('|')
        : textAnswer.trim()

    await sendTrainingLog('answer', {
      제출_유형: stepIdx <= 1 && stageUsesBlanks ? '빈칸' : '텍스트',
      비계_답변: answerSnapshot,
      비계_정답지: expectedAnswer || '(빈칸 일치)',
      힌트_사용_누적_횟수: hintUsageCount,
    })

    if (stepIdx < STAGE_DEF.length - 1) {
      setStepIdx((s) => s + 1)
      return
    }
    if (problemIdx < rows.length - 1) {
      setProblemIdx((p) => p + 1)
      setStepIdx(0)
      setHintFlags(Array(6).fill(false))
      return
    }
    window.alert('이번 단계의 모든 문제를 완료했습니다. 수고했어요!')
    onExit?.()
  }

  const headerKicker = trainingPlan?.characterName
    ? `${trainingPlan.characterName} 추천 학습 · 파일 단계 ${(trainingPlan.stages || []).join(', ')}`
    : '수련 모드 · 수준 1단계'

  if (loadError) {
    return (
      <section className="rounded-3xl border border-red-200 bg-white/90 p-6 shadow-xl">
        <p className="font-bold text-red-700">{loadError}</p>
        <button
          type="button"
          onClick={onExit}
          className="mt-4 rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white"
        >
          돌아가기
        </button>
      </section>
    )
  }

  if (isLoading) {
    return (
      <section className="rounded-3xl border border-blue-200 bg-white/90 p-8 text-center shadow-xl">
        <p className="text-slate-600">데이터를 불러오는 중...</p>
      </section>
    )
  }

  return (
    <section className="rounded-3xl border border-blue-200/80 bg-white/90 p-6 shadow-2xl backdrop-blur-md sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-blue-700">{headerKicker}</p>
          <h2 className="mt-1 text-2xl font-black text-blue-950 sm:text-3xl">비계 질문 순서 연습</h2>
          <p className="mt-2 text-sm text-slate-600">
            비계 1·2에서는 괄호 안을 빈칸으로 채우고, 모두 맞춰야 다음 단계로 갈 수 있어요.
          </p>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          나가기
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-slate-700" htmlFor="training-problem">
          문항
        </label>
        <select
          id="training-problem"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          value={problemIdx}
          onChange={(e) => {
            setProblemIdx(Number(e.target.value))
            setStepIdx(0)
            setHintFlags(Array(6).fill(false))
          }}
        >
          {rows.map((r, i) => (
            <option key={`${r['유형']}-${r.__poolStage ?? 'x'}-${i}`} value={i}>
              유형 {r['유형'] ?? i + 1}
              {r.__poolStage != null ? ` · 학습단계 ${r.__poolStage}` : ''}
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-500">
          ({problemIdx + 1} / {rows.length})
        </span>
        <span className="text-sm font-semibold text-slate-600">힌트 사용 {hintUsageCount}회</span>
      </div>

      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
        <p className="text-xs font-semibold uppercase text-amber-800">문제 텍스트</p>
        <p className="mt-2 whitespace-pre-wrap text-base text-slate-800">{row['문제 텍스트']}</p>
      </div>

      <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
            비계 {stepIdx + 1} / 6
          </span>
          <span className="text-xs font-semibold text-slate-500">{currentDef.qKey}</span>
        </div>
        <div className="mt-4">{renderQuestionBody()}</div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleHint}
            className="rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-800 hover:bg-blue-50"
          >
            힌트 받기
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={!canAdvance}
            className="rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-yellow-500/30 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {stepIdx < STAGE_DEF.length - 1 ? '다음 비계 질문' : problemIdx < rows.length - 1 ? '다음 문항' : '완료'}
          </button>
        </div>
        {!canAdvance && (
          <p className="mt-3 text-sm text-slate-500">
            {stepIdx <= 1 && stageUsesBlanks
              ? '괄호 빈칸을 모두 정답과 같게 채우면 다음으로 넘어갈 수 있어요.'
              : '정답 형태로 입력하면 다음으로 넘어갈 수 있어요.'}
          </p>
        )}
      </div>
    </section>
  )
}
