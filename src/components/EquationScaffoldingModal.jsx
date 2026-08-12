import { getTrainingKeyDisplayLabel } from '../training/trainingKeyLabels'

export default function EquationScaffoldingModal({
  open,
  step,
  stepIndex = 0,
  totalSteps = 0,
  showRemember = false,
  wrongPickCount = 0,
  rememberText = '',
  isFinished = false,
  onSelectChoice,
  onLearnConcept,
  onExitAlone,
  onReturnToProblem,
}) {
  if (!open) return null

  const stepNumber = stepIndex + 1

  return (
    <div
      className="fixed inset-0 z-[107] flex items-end justify-center bg-slate-900/40 p-2 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="equation-scaffolding-title"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <img
              src="/boridosa.png"
              alt="보리도사"
              width={36}
              height={36}
              className="h-9 w-9 shrink-0 object-contain"
            />
            <h3
              id="equation-scaffolding-title"
              className="text-base font-black text-indigo-950 sm:text-lg"
            >
              보리도사와 함께 방정식 풀기
            </h3>
          </div>
          {!isFinished && totalSteps > 0 ? (
            <p className="mt-1 text-sm font-semibold text-indigo-800">
              {stepNumber} / {totalSteps} 단계
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          {isFinished ? (
            <div className="space-y-4 text-center">
              <p className="text-base font-bold leading-relaxed text-slate-800 sm:text-lg">
                방정식 풀기 연습을 모두 마쳤어요.
              </p>
              <p className="rounded-xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 to-indigo-50 px-4 py-4 text-lg font-black leading-snug text-violet-900 sm:text-xl">
                이제 원래 5단계 문제에서 구한 x값을 직접 입력해 보세요.
              </p>
              <button
                type="button"
                onClick={onReturnToProblem}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-bold text-white shadow-md transition hover:brightness-105"
              >
                5단계로 돌아가기
              </button>
            </div>
          ) : step ? (
            <div className="space-y-4">
              <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-800 sm:text-lg">
                {step.question}
              </p>
              <div className="grid gap-2">
                {step.choices.map((choice, index) => (
                  <button
                    key={`scaffold-choice-${step.scaffoldStep}-${index}`}
                    type="button"
                    onClick={() => onSelectChoice?.(index + 1)}
                    className="rounded-xl border-2 border-indigo-200 bg-white px-3 py-3 text-left text-sm font-semibold text-slate-800 transition hover:border-indigo-400 hover:bg-indigo-50 sm:text-base"
                  >
                    <span className="mr-2 font-black text-indigo-700">{index + 1}.</span>
                    {choice}
                  </button>
                ))}
              </div>
              {wrongPickCount >= 1 ? (
                <div
                  className="rounded-xl border-2 border-rose-200 bg-rose-50 px-3 py-3 sm:px-4"
                  role="alert"
                  aria-live="polite"
                >
                  <p className="text-sm font-bold leading-relaxed text-rose-900 sm:text-base">
                    {wrongPickCount === 1
                      ? '다시 생각해 보세요. 필요하면 이 개념을 다시 배워볼 수 있어요.'
                      : '아직 정답이 아니에요. 기억해요를 다시 확인해 보세요.'}
                  </p>
                </div>
              ) : null}
              {showRemember && rememberText ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-3 sm:px-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
                    기억해요
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-amber-950 sm:text-base">
                    {rememberText}
                  </p>
                  {step.conceptKey ? (
                    <button
                      type="button"
                      onClick={() => onLearnConcept?.(step.conceptKey)}
                      className="mt-3 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-bold text-violet-800 transition hover:bg-violet-100"
                    >
                      이 개념 다시 배우기 ({getTrainingKeyDisplayLabel(step.conceptKey)})
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {!isFinished ? (
          <div className="shrink-0 border-t border-slate-200 bg-slate-50/90 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={onExitAlone}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
            >
              이제 혼자 풀어볼래요
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
