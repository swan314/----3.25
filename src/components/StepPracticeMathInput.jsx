import { useRef } from 'react'

export default function StepPracticeMathInput({
  value,
  onChange,
  disabled = false,
  inputId,
  compact = false,
  feedbackState = 'idle',
}) {
  const inputRef = useRef(null)

  const stopBubble = (event) => {
    event.stopPropagation()
  }

  const feedbackBorderClass =
    feedbackState === 'correct'
      ? 'border-2 border-emerald-400 focus:border-emerald-500 focus:ring-emerald-200'
      : feedbackState === 'wrong'
        ? 'border-2 border-orange-400 focus:border-orange-500 focus:ring-orange-200'
        : 'border-2 border-violet-400 focus:border-violet-600 focus:ring-violet-300'

  return (
    <div onClick={stopBubble} onPointerDown={stopBubble}>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        onClick={stopBubble}
        onPointerDown={stopBubble}
        autoComplete="off"
        spellCheck={false}
        className={[
          'w-full bg-white text-slate-900 shadow-sm outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
          feedbackBorderClass,
          compact
            ? 'rounded-lg px-2.5 py-3 text-sm'
            : 'rounded-xl px-3 py-4 text-base',
        ].join(' ')}
        placeholder="답을 입력하세요"
      />
    </div>
  )
}
