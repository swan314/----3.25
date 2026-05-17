import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  formatStepTrainingContentHtml,
  pairExampleContentAndAnswer,
  pickRandomStepPractice,
} from '../training/stepTrainingContent'
import { getTrainingKeyDisplayLabel } from '../training/trainingKeyLabels'
import { choiceAnswerTextMatch } from '../training/trainingChoiceUtils'
import StepPracticeMathInput from './StepPracticeMathInput'

const PRACTICE_WRONG_MESSAGE =
  '설명과 예시를 다시 살펴보고 한 번 더 시도해보세요.'

function StepPracticeWrongAlert({ onDismiss }) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-slate-900/35 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="step-practice-wrong-title"
        aria-describedby="step-practice-wrong-message"
        className="w-full max-w-xs overflow-hidden rounded-xl border-2 border-orange-200 bg-white shadow-xl sm:max-w-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-orange-100 bg-orange-50/80 px-4 py-3 text-center sm:px-5">
          <span className="text-2xl leading-none" aria-hidden="true">
            💡
          </span>
          <h4
            id="step-practice-wrong-title"
            className="mt-1.5 text-base font-extrabold text-orange-800 sm:text-lg"
          >
            다시 시도해보세요
          </h4>
        </div>
        <div className="px-4 py-4 sm:px-5 sm:py-5">
          <p
            id="step-practice-wrong-message"
            className="text-center text-sm font-medium leading-relaxed text-slate-700 sm:text-base"
          >
            {PRACTICE_WRONG_MESSAGE}
          </p>
          <button
            type="button"
            onClick={onDismiss}
            className="mt-4 w-full rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:from-orange-600 hover:to-orange-700"
          >
            다시 시도
          </button>
        </div>
      </div>
    </div>
  )
}

function StepTrainingHtmlBlock({ html, className = '', compact = false }) {
  return (
    <div
      className={[
        compact
          ? 'rounded-md border border-violet-100 bg-white px-2 py-1 text-xs leading-snug text-slate-800 sm:text-sm [&_.mm-inline-math]:align-middle'
          : 'rounded-lg border border-violet-100 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-800 sm:text-base [&_.mm-inline-math]:align-middle',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** 예제·연습 문제 본문 — text-sm(0.875rem)·sm:text-base(1rem) 대비 1.3배 */
const STEP_TRAINING_MATH_TEXT_CLASS =
  'text-[1.1375rem] leading-tight text-slate-800 sm:text-[1.3rem] [&_.mm-inline-math]:align-middle [&_br]:hidden'

/** 2열 모드 예제·연습 — 기존 compact 대비 약간 축소 */
const STEP_TRAINING_MATH_TEXT_CLASS_COMPACT =
  'text-[0.9rem] leading-tight text-slate-800 sm:text-[1.025rem] [&_.mm-inline-math]:align-middle [&_br]:hidden'

const STEP_ANSWER_LABEL_CLASS = 'font-semibold text-slate-600'
const STEP_ANSWER_VALUE_CLASS =
  'font-semibold text-violet-700 [&_.mm-inline-math]:align-middle'

function StepAnswerInline({ answer, textClass = '', compact = false }) {
  if (!answer || answer === 'skip') return null
  return (
    <div
      className={[
        'shrink-0 whitespace-nowrap text-right',
        textClass,
        compact ? 'ml-1' : 'ml-0 self-end',
      ].join(' ')}
    >
      <span className={STEP_ANSWER_LABEL_CLASS}>정답: </span>
      <span
        className={`inline ${STEP_ANSWER_VALUE_CLASS}`}
        dangerouslySetInnerHTML={{
          __html: formatStepTrainingContentHtml(answer),
        }}
      />
    </div>
  )
}

function StepExamplePairs({ content, answer, compact = false }) {
  const pairs = pairExampleContentAndAnswer(content, answer)
  const textClass = compact ? STEP_TRAINING_MATH_TEXT_CLASS_COMPACT : STEP_TRAINING_MATH_TEXT_CLASS

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {pairs.map((pair, pairIndex) => (
        <div
          key={`pair-${pairIndex}`}
          className={[
            'flex items-start justify-between gap-2 rounded-lg border border-violet-100 bg-white',
            compact
              ? 'flex-nowrap overflow-x-auto px-2 py-0.5'
              : 'flex-wrap px-3 py-2 sm:gap-3',
          ].join(' ')}
        >
          <div
            className={[
              'font-medium',
              textClass,
              compact ? 'shrink-0 whitespace-nowrap' : 'min-w-0 flex-1 leading-snug',
            ].join(' ')}
            dangerouslySetInnerHTML={{
              __html: formatStepTrainingContentHtml(pair.problem),
            }}
          />
          <StepAnswerInline answer={pair.answer} textClass={textClass} compact={compact} />
        </div>
      ))}
    </div>
  )
}

function ConceptFocusedLearningCard({
  bundle,
  practiceItem,
  practiceInput,
  practiceResult,
  onPracticeInputChange,
  onCheckAnswer,
  layoutMode = 'single',
}) {
  const isCorrect = practiceResult === 'correct'
  const isWrong = practiceResult === 'wrong'
  const canCheck = Boolean(practiceItem) && !isCorrect
  const compact = layoutMode === 'multi'
  const mathTextClass = compact ? STEP_TRAINING_MATH_TEXT_CLASS_COMPACT : STEP_TRAINING_MATH_TEXT_CLASS
  const sectionGap = compact ? 'space-y-2' : 'space-y-5'
  const cardPadding = compact ? 'px-2.5 py-2' : 'p-4'
  const sectionLabelClass = compact
    ? 'mb-0.5 shrink-0 text-[10px] font-bold tracking-wide text-violet-700'
    : 'mb-2 text-xs font-bold tracking-wide text-violet-700'
  const practiceSectionLabelClass = compact
    ? 'mb-1.5 shrink-0 text-[11px] font-extrabold tracking-wide text-violet-900 sm:text-xs'
    : 'mb-2 text-sm font-extrabold tracking-wide text-violet-900'
  const sectionBodyClass = compact ? 'space-y-1' : 'space-y-3'

  const practiceBoxBorderClass = isCorrect
    ? 'border-2 border-emerald-400 bg-emerald-50/30 ring-1 ring-emerald-100'
    : isWrong
      ? 'border-2 border-orange-400 bg-orange-50/20 ring-1 ring-orange-100'
      : 'border border-violet-200'

  const practiceFeedbackState = isCorrect ? 'correct' : isWrong ? 'wrong' : 'idle'

  return (
    <article
      className={[
        'flex h-full flex-col rounded-xl border border-violet-200 bg-violet-50/50',
        cardPadding,
        layoutMode === 'single' ? 'mx-auto w-full' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <h4
        className={[
          'shrink-0 font-extrabold text-violet-900',
          compact
            ? 'mb-1 text-center text-[1.05rem] leading-tight'
            : 'mb-3 text-base',
        ].join(' ')}
      >
        {getTrainingKeyDisplayLabel(bundle.trainingKey)}
      </h4>

      <div className={['flex flex-1 flex-col', sectionGap].join(' ')}>
        {bundle.explanations?.length ? (
          <section>
            <p className={sectionLabelClass}>설명</p>
            <div className={sectionBodyClass}>
              {bundle.explanations.map((row, rowIndex) => (
                <StepTrainingHtmlBlock
                  key={`exp-${bundle.trainingKey}-${rowIndex}`}
                  html={formatStepTrainingContentHtml(row.content)}
                  compact={compact}
                />
              ))}
            </div>
          </section>
        ) : null}

        {bundle.examples?.length ? (
          <section>
            <p className={sectionLabelClass}>예제</p>
            <div className={sectionBodyClass}>
              {bundle.examples.map((row, rowIndex) => (
                <StepExamplePairs
                  key={`ex-${bundle.trainingKey}-${rowIndex}`}
                  content={row.content}
                  answer={row.answer}
                  compact={compact}
                />
              ))}
            </div>
          </section>
        ) : null}

        {practiceItem ? (
          <section
            className={[
              'mt-auto flex flex-col rounded-lg bg-violet-100/50 px-2 pb-2 pt-2',
              compact ? 'mt-2' : 'mt-3',
            ].join(' ')}
          >
            <p className={practiceSectionLabelClass}>연습문제를 직접 풀어보아요</p>
            <div
              className={[
                'rounded-lg bg-white transition-colors',
                practiceBoxBorderClass,
                compact
                  ? 'flex flex-col gap-2 px-2 py-1.5'
                  : 'space-y-3 px-3 py-3',
              ].join(' ')}
            >
              <div
                className={
                  isCorrect
                    ? 'flex shrink-0 flex-nowrap items-center justify-between gap-2 overflow-x-auto'
                    : undefined
                }
              >
                <div
                  className={[
                    mathTextClass,
                    'font-medium',
                    isCorrect ? 'shrink-0 whitespace-nowrap' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  dangerouslySetInnerHTML={{
                    __html: formatStepTrainingContentHtml(practiceItem.content),
                  }}
                />
                {isCorrect ? (
                  <StepAnswerInline answer={practiceItem.answer} textClass={mathTextClass} />
                ) : null}
              </div>

              {!isCorrect ? (
                <div className={compact ? 'flex shrink-0 flex-col gap-1' : 'contents'}>
                  <StepPracticeMathInput
                    inputId={`step-practice-${bundle.trainingKey}`}
                    value={practiceInput}
                    onChange={onPracticeInputChange}
                    disabled={false}
                    compact={compact}
                    feedbackState={practiceFeedbackState}
                  />
                  <button
                    type="button"
                    disabled={!canCheck || !String(practiceInput || '').trim()}
                    onClick={onCheckAnswer}
                    className={[
                      'w-full rounded-lg bg-violet-600 font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50',
                      compact
                        ? 'px-3 py-0.5 text-xs leading-tight sm:text-sm'
                        : 'rounded-xl px-4 py-1.5 text-sm sm:text-base',
                    ].join(' ')}
                  >
                    정답 확인
                  </button>
                </div>
              ) : null}

              {isCorrect ? (
                <p
                  className={[
                    'shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 font-semibold text-emerald-900',
                    compact ? 'px-2 py-1.5 text-[11px] leading-snug' : 'px-3 py-2.5 text-sm',
                  ].join(' ')}
                >
                  {layoutMode === 'multi'
                    ? '잘했어요! 이제 원래 문제에 적용해봅시다.'
                    : '잘했어요! 아래 버튼으로 원래 문제로 돌아가서 다시 해결해봅시다.'}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </article>
  )
}

export default function StepFocusedLearningModal({
  open,
  onClose,
  stageLabel = '',
  conceptBundles = [],
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [practicePickByKey, setPracticePickByKey] = useState({})
  const [practiceInputByKey, setPracticeInputByKey] = useState({})
  const [practiceResultByKey, setPracticeResultByKey] = useState({})
  const [wrongAlertKey, setWrongAlertKey] = useState(null)

  const dragRef = useRef({
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  })

  const bundleKey = useMemo(
    () => conceptBundles.map((b) => b.trainingKey).join('|'),
    [conceptBundles],
  )

  const layoutMode = conceptBundles.length > 1 ? 'multi' : 'single'

  useEffect(() => {
    if (open) setOffset({ x: 0, y: 0 })
  }, [open])

  useEffect(() => {
    if (!open) {
      setPracticePickByKey({})
      setPracticeInputByKey({})
      setPracticeResultByKey({})
      setWrongAlertKey(null)
      return
    }

    const picks = {}
    for (const bundle of conceptBundles) {
      const picked = pickRandomStepPractice(bundle.practices)
      if (picked) picks[bundle.trainingKey] = picked
    }
    setPracticePickByKey(picks)
    setPracticeInputByKey({})
    setPracticeResultByKey({})
  }, [open, bundleKey, conceptBundles])

  const dismissWrongAlert = useCallback(() => {
    setWrongAlertKey(null)
  }, [])

  const handlePracticeInputChange = useCallback((trainingKey, value) => {
    setPracticeInputByKey((prev) => ({ ...prev, [trainingKey]: value }))
    setPracticeResultByKey((prev) =>
      prev[trainingKey] === 'wrong' ? { ...prev, [trainingKey]: 'idle' } : prev,
    )
    setWrongAlertKey((prev) => (prev === trainingKey ? null : prev))
  }, [])

  const handleCheckAnswer = useCallback(
    (trainingKey) => {
      const pick = practicePickByKey[trainingKey]
      const student = practiceInputByKey[trainingKey]
      if (!pick?.answer || pick.answer === 'skip') return
      if (choiceAnswerTextMatch(student, pick.answer)) {
        setPracticeResultByKey((prev) => ({ ...prev, [trainingKey]: 'correct' }))
      } else {
        setPracticeResultByKey((prev) => ({ ...prev, [trainingKey]: 'wrong' }))
        setWrongAlertKey(trainingKey)
      }
    },
    [practicePickByKey, practiceInputByKey],
  )

  if (!open) return null

  const handleDragStart = (event) => {
    if (event.target instanceof Element && event.target.closest('button')) return
    if (event.button !== 0 && event.pointerType !== 'touch' && event.pointerType !== 'pen') return
    dragRef.current = {
      dragging: true,
      pointerId: event.pointerId ?? null,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    }
  }

  const handleDragMove = (event) => {
    const state = dragRef.current
    if (!state.dragging) return
    if (state.pointerId != null && event.pointerId !== state.pointerId) return
    setOffset({
      x: state.originX + (event.clientX - state.startX),
      y: state.originY + (event.clientY - state.startY),
    })
  }

  const handleDragEnd = (event) => {
    const state = dragRef.current
    if (!state.dragging) return
    if (state.pointerId != null && event.pointerId !== state.pointerId) return
    dragRef.current.dragging = false
    dragRef.current.pointerId = null
  }

  const dialogMaxWidth =
    layoutMode === 'multi'
      ? 'max-w-[min(98vw,1200px)]'
      : 'max-w-[min(96vw,920px)]'
  const dialogMaxHeight = 'max-h-[96vh]'

  return (
    <div
      className="fixed inset-0 z-[9999] bg-slate-900/35 p-2 sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-focused-learning-title"
        className={[
          'pointer-events-auto fixed left-1/2 top-1/2 flex w-full max-h-[96vh] flex-col overflow-y-auto rounded-2xl bg-white shadow-2xl relative',
          dialogMaxWidth,
          dialogMaxHeight,
        ].join(' ')}
        style={{
          transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <div
          className="shrink-0 cursor-grab border-b border-violet-100 bg-violet-50/80 px-3 py-1.5 active:cursor-grabbing sm:px-4"
          onPointerDown={handleDragStart}
        >
          <div className="flex flex-col gap-0.5">
            <h3
              id="step-focused-learning-title"
              className="text-base font-extrabold leading-tight text-slate-900 sm:text-lg"
            >
              단계 집중 학습
            </h3>
            {stageLabel ? (
              <p className="text-sm font-semibold leading-tight text-violet-700">{stageLabel}</p>
            ) : null}
          </div>
        </div>

        <div
          className={[
            'shrink-0 px-2.5 py-2 sm:px-3 sm:py-2',
            layoutMode === 'single' ? 'flex justify-center' : '',
          ].join(' ')}
        >
          {conceptBundles.length === 0 ? (
            <p className="text-sm text-slate-600">학습 내용을 찾을 수 없습니다.</p>
          ) : (
            <div
              className={[
                layoutMode === 'multi'
                  ? 'grid grid-cols-1 items-stretch gap-2 md:grid-cols-2'
                  : 'w-full',
              ].join(' ')}
            >
              {conceptBundles.map((bundle) => (
                <ConceptFocusedLearningCard
                  key={bundle.trainingKey}
                  bundle={bundle}
                  layoutMode={layoutMode}
                  practiceItem={practicePickByKey[bundle.trainingKey] ?? null}
                  practiceInput={practiceInputByKey[bundle.trainingKey] ?? ''}
                  practiceResult={practiceResultByKey[bundle.trainingKey] ?? 'idle'}
                  onPracticeInputChange={(value) =>
                    handlePracticeInputChange(bundle.trainingKey, value)
                  }
                  onCheckAnswer={() => handleCheckAnswer(bundle.trainingKey)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-violet-100 px-3 py-2 sm:px-4">
          <div className="flex justify-center">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex w-auto rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 sm:px-6"
            >
              원래 문제로 돌아가기
            </button>
          </div>
        </div>

        {wrongAlertKey ? <StepPracticeWrongAlert onDismiss={dismissWrongAlert} /> : null}
      </div>
    </div>
  )
}
