/** 중1 방정식 수련 전용 MathLive 가상 키보드 (숫자 5×2 + 수식 2×9, 가로 배치) */
export const TRAINING_M1_EQUATION_KEYBOARD_LAYOUT = {
  id: 'training-m1-equations',
  label: '중1 방정식',
  displayEditToolbar: false,
  displayShiftedKeycaps: false,
  layers: [
    {
      style: `
        .training-vk-letter-key {
          background: #eef2ff;
          border-color: #c7d2fe;
          font-style: italic;
        }
        .training-vk-letter-key:hover {
          background: #e0e7ff;
        }
        .training-vk-op-key {
          background: #f8fafc;
          border-color: #cbd5e1;
          font-weight: 700;
        }
        .training-vk-op-key:hover {
          background: #f1f5f9;
        }
        .MLK__rows > .MLK__row > div:nth-child(5) {
          margin-right: 5px;
        }
        .MLK__rows > .MLK__row > div.tex.training-vk-hangul-label {
          font-family: KaTeX_Math, KaTeX_Main, 'Cambria Math', 'Asana Math', OpenSymbol, Symbola, STIX, Times, serif !important;
          font-weight: 600 !important;
          line-height: 1.15;
        }
      `,
      rows: [
        [
          '[1]',
          '[2]',
          '[3]',
          '[4]',
          '[5]',
          { latex: 'x', class: 'tex training-vk-letter-key' },
          { latex: 'y', class: 'tex training-vk-letter-key' },
          '(',
          ')',
          '\\{',
          '\\}',
          {
            latex: '\\frac{#@}{#?}',
            label: '분수',
            class: 'tex training-vk-hangul-label',
          },
          '[backspace]',
          {
            label: '닫기',
            class: 'tex training-vk-hangul-label',
            command: 'hideVirtualKeyboard',
          },
        ],
        [
          '[6]',
          '[7]',
          '[8]',
          '[9]',
          '[0]',
          '[+]',
          { label: '−', latex: '-' },
          { latex: '\\times', class: 'tex training-vk-op-key' },
          { label: '÷', latex: '/' },
          '[=]',
          { label: '<', latex: '<', class: 'tex' },
          { label: '>', latex: '>', class: 'tex' },
          { label: '.', latex: '.' },
          { label: ',', latex: ',' },
        ],
      ],
    },
  ],
}

const TRAINING_VK_BODY_CLASS = 'training-m1-math-keyboard-active'

/** MathLive 전역 키보드에 중1 전용 레이아웃·크기 적용 */
export function applyTrainingMathVirtualKeyboard() {
  const vk = window.mathVirtualKeyboard
  if (!vk) return false

  vk.layouts = TRAINING_M1_EQUATION_KEYBOARD_LAYOUT
  vk.editToolbar = 'none'
  document.body.classList.add(TRAINING_VK_BODY_CLASS)
  return true
}

export function clearTrainingMathVirtualKeyboardBodyClass() {
  document.body.classList.remove(TRAINING_VK_BODY_CLASS)
}
