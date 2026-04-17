import './style.css'
import magicMainIllustration from './assets/magic-main-illustration.png'
import sonGokuImg from './assets/son-goku.png'
import shaoImg from './assets/shao.png'
import samjangImg from './assets/samjang.png'
import okdongjaImg from './assets/okdongja.png'
import 'mathlive'

const app = document.querySelector('#app')
const directSheetsWebhookUrl =
  'https://script.google.com/macros/s/AKfycbxS6jJolgQuiHPwn5s6i_DHekp6bt-Ac-bppWxFQN6hKTEd8BMLsdpCgWNDDNam0ujzvA/exec'

function getStudentNicknameFromHash() {
  const hashRaw = (location.hash || '').replace(/^#/, '')
  const queryIndex = hashRaw.indexOf('?')
  if (queryIndex === -1) return ''
  const query = hashRaw.slice(queryIndex + 1)
  const params = new URLSearchParams(query)
  return (params.get('nickname') || '').trim()
}

async function saveDataToSheets(payload) {
  try {
    await fetch(directSheetsWebhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify(payload),
      keepalive: true,
    })
    // no-cors 모드에서는 응답 확인이 불가하므로 throw 없으면 성공으로 간주
    return { ok: true, reason: 'no_cors_assumed_success' }
  } catch (error) {
    console.error('[Sheets] saveDataToSheets:error', error)
    return { ok: false, reason: 'network_error', message: error?.message || 'unknown_error' }
  }
}

async function sendLearningResultToSheet(payload) {
  return saveDataToSheets(payload)
}

function renderWelcome() {
  app.innerHTML = `
  <div class="mm-shell" role="application" aria-label="math-master">
    <header class="mm-header">
      <div class="mm-brand">
        <div class="mm-logo" aria-hidden="true">=</div>
        <div class="mm-brand-text">
          <div class="mm-title-top">MAGIC MATH WORLD</div>
          <div class="mm-title-sub">MAGIC MATH ADVENTURE</div>
        </div>
      </div>
      <div class="mm-badge" id="mm-progress-badge">Lv. 진단 준비</div>
    </header>

    <main class="mm-main">
      <section class="mm-welcome-card" aria-labelledby="mm-welcome-heading">
        <div class="mm-hero-row" aria-hidden="true">
          <div class="mm-hero-card">
            <img src="${sonGokuImg}" alt="" class="mm-hero-img" />
          </div>
          <div class="mm-hero-card">
            <img src="${shaoImg}" alt="" class="mm-hero-img" />
          </div>
          <div class="mm-hero-card">
            <img src="${samjangImg}" alt="" class="mm-hero-img" />
          </div>
          <div class="mm-hero-card">
            <img src="${okdongjaImg}" alt="" class="mm-hero-img" />
          </div>
        </div>

        <h1 class="mm-welcome-heading" id="mm-welcome-heading">
          일차방정식 문장제, 시작해볼까요?
        </h1>

        <p class="mm-welcome-desc">
          수업 참여를 환영해요. 다음 화면에서 5개의 문제로 수준을 파악한 뒤,
          맞춤 연습과 피드백까지 이어집니다.
        </p>

        <div class="mm-cta-row">
          <button id="mm-start" type="button" class="mm-btn-primary">
            시작하기
          </button>
        </div>

        <div class="mm-mini-panel" role="note" aria-label="학습 안내">
          <div class="mm-mini-title">학습 안내</div>
          <div class="mm-mini-items">
            <div class="mm-mini-item">1) 5문항으로 현재 수준을 확인해요.</div>
            <div class="mm-mini-item">2) 수준에 맞게 연습문제를 드려요.</div>
            <div class="mm-mini-item">3) 답을 체크하고 격려 또는 피드백을 받습니다.</div>
          </div>
        </div>
      </section>
    </main>

    <footer class="mm-footer">
      <a class="mm-link" href="#" id="mm-privacy-link">개인정보 보호 안내</a>
    </footer>
  </div>
  `

  app.querySelector('#mm-start')?.addEventListener('click', () => {
    location.hash = '#level-check'
  })

  app.querySelector('#mm-privacy-link')?.addEventListener('click', (e) => {
    e.preventDefault()
    alert('개인정보 보호 안내는 다음 단계에서 상세 화면으로 연결하겠습니다.')
  })
}

function renderLevelCheckPlaceholder(problemIdx = 0) {
  if (!window.__mmAssessment) {
    window.__mmAssessment = { answersByProblem: {}, scoresByProblem: {} }
  }
  if (!window.__mmAssessment.reportedPasses) {
    window.__mmAssessment.reportedPasses = {}
  }
  if (window.__mmAssessment.reportedFinalCompletion == null) {
    window.__mmAssessment.reportedFinalCompletion = false
  }
  const problems = [
    {
      id: 'p1',
      title: '문제 1',
      prompt:
        '어느 놀이공원의 성인 한 명의 입장료는 청소년 한 명의 입장료보다 3000원 더 비싸다. 청소년 3명과 성인 2명의 입장료를 합한 금액이 31000원일 때, 청소년 한 명의 입장료를 구하시오.',
      stages: [
        {
          id: 1,
          title: '미지수 정하기',
          points: 2,
          type: 'text',
          prompt: '질문 1. 상황에 맞게 미지수(x)를 정하시오.',
          expectedDisplay:
            'x: 청소년 한 명의 입장료 / x: 청소년 입장료 / 청소년 한 명의 입장료는 x이다 / 청소년의 입장료는 x이다 / 청소년 한 명의 입장료는 x원이다 / 청소년의 입장료는 x원이다',
          acceptedTexts: [
            'x: 청소년 한 명의 입장료',
            'x: 청소년 입장료',
            '청소년 한 명의 입장료는 x이다.',
            '청소년의 입장료는 x이다.',
            '청소년 한 명의 입장료는 x원이다.',
            '청소년의 입장료는 x원이다.',
          ],
          hint:
            'x: 청소년 한 명의 입장료 / x: 청소년 입장료 / 청소년 한 명의 입장료는 x이다 / 청소년의 입장료는 x이다 / 청소년 한 명의 입장료는 x원이다 / 청소년의 입장료는 x원이다',
        },
        {
          id: 2,
          title: '방정식 세우기',
          points: 3,
          type: 'equation',
          prompt: '질문 2. 주어진 조건을 이용하여 일차방정식을 만들어보시오.',
          expectedDisplay: '3x+2(x+3000)=31000',
          hint: '3x+2(x+3000)=31000',
        },
        {
          id: 3,
          title: '방정식 풀기',
          points: 3,
          type: 'numeric',
          prompt: '질문 3. 일차방정식을 풀어보시오.',
          expectedDisplay: 'x=5000',
          expectedNumber: 5000,
          hint: 'x=5000',
        },
        {
          id: 4,
          title: '문제 해결하기',
          points: 2,
          type: 'numeric',
          prompt: '질문 4. 청소년 한 명의 입장료는 얼마인가요?',
          expectedDisplay: '5000 / 5000원',
          expectedNumber: 5000,
          hint: '5000 / 5000원',
        },
      ],
    },
    {
      id: 'p2',
      title: '문제 2',
      prompt:
        '올해 아버지의 나이는 40세이고 딸의 나이는 8세이다. 아버지의 나이가 딸의 나이의 3배가 되는 때는 몇 년 후인지 구하시오.',
      stages: [
        {
          id: 1,
          title: '미지수 정하기',
          points: 2,
          type: 'text',
          prompt: '질문 1. 상황에 맞게 미지수(x)를 정하시오.',
          expectedDisplay:
            'x: 아버지 나이가 딸 나이의 3배가 되는데 걸린 시간 / x: 아버지 나이가 딸 나이의 3배가 되는 시간 / x: 아버지 나이가 딸 나이의 3배가 되는데 걸린 년 수 / x: 아버지 나이가 딸 나이의 3배가 되는 년 수 / 아버지 나이가 딸 나이의 3배가 되는데 x년 걸린다 / 아버지 나이가 딸 나이의 3배가 되는 것은 x년 후이다 / 걸린 시간은 x년이다 / 걸린 시간은 x이다 등 (정답지 1~8과 같은 의미)',
          hint:
            'x: 아버지 나이가 딸 나이의 3배가 되는데 걸린 시간 / x: 아버지 나이가 딸 나이의 3배가 되는 시간 / x: 아버지 나이가 딸 나이의 3배가 되는데 걸린 년 수 / x: 아버지 나이가 딸 나이의 3배가 되는 년 수 등 (정답지 1~8과 같은 의미)',
        },
        {
          id: 2,
          title: '방정식 세우기',
          points: 3,
          type: 'equation',
          prompt: '질문 2. 주어진 조건을 이용하여 일차방정식을 만들어보시오.',
          expectedDisplay: '40+x=3(8+x)',
          hint: '40+x=3(8+x)',
        },
        {
          id: 3,
          title: '방정식 풀기',
          points: 3,
          type: 'numeric',
          prompt: '질문 3. 일차방정식을 풀어보시오.',
          expectedDisplay: 'x=8',
          expectedNumber: 8,
          hint: 'x=8',
        },
        {
          id: 4,
          title: '문제 해결하기',
          points: 2,
          type: 'numeric',
          prompt: '질문 4. 아버지의 나이가 딸의 나이의 3배가 되는 때는 몇 년 후 인가요?',
          expectedDisplay: '8 / 8년',
          expectedNumber: 8,
          hint: '8 / 8년',
        },
      ],
    },
    {
      id: 'p3',
      title: '문제 3',
      prompt:
        '일의 자리의 숫자가 6인 두 자리의 자연수가 있다. 이 자연수는 각 자리의 숫자의 합의 4배와 같다고 할 때, 이 자연수를 구하시오.',
      stages: [
        {
          id: 1,
          title: '미지수 정하기',
          points: 2,
          type: 'text',
          prompt: '질문 1. 상황에 맞게 미지수(x)를 정하시오.',
          expectedDisplay:
            'x: 십의 자리 숫자 / x: 자연수의 십의 자리 숫자 / x: 두 자리 자연수의 십의 자리 숫자 / x: 일의 자리가 6인 두 자리 자연수의 십의 자리 숫자 / 십의 자리 숫자를 x라 하자 / 자연수의 십의 자리 숫자는 x이다 등 (정답지 1~12와 같은 의미)',
          hint:
            'x: 십의 자리 숫자 / x: 자연수의 십의 자리 숫자 / 두 자리 자연수의 십의 자리 숫자를 x라 하자 등 (정답지 1~12와 같은 의미)',
        },
        {
          id: 2,
          title: '방정식 세우기',
          points: 3,
          type: 'equation',
          prompt: '질문 2. 주어진 조건을 이용하여 일차방정식을 만들어보시오.',
          expectedDisplay: '10x+6=4(6+x)',
          hint: '10x+6=4(6+x)',
        },
        {
          id: 3,
          title: '방정식 풀기',
          points: 3,
          type: 'numeric',
          prompt: '질문 3. 일차방정식을 풀어보시오.',
          expectedDisplay: 'x=3',
          expectedNumber: 3,
          hint: 'x=3',
        },
        {
          id: 4,
          title: '문제 해결하기',
          points: 2,
          type: 'numeric',
          prompt: '질문 4. 자연수는 무엇인가요?',
          expectedDisplay: '36',
          expectedNumber: 36,
          hint: '36',
        },
      ],
    },
    {
      id: 'p4',
      title: '문제 4',
      prompt:
        '광진이가 자전거를 타고 집에서 도서관까지 다녀오는 데 갈 때는 시속 10km로, 올 때는 같은 길을 시속 15km로 달려서 총 2시간이 걸렸다. 이때 집에서 도서관까지의 거리를 구하시오.',
      stages: [
        {
          id: 1,
          title: '미지수 정하기',
          points: 2,
          type: 'text',
          prompt: '질문 1. 상황에 맞게 미지수(x)를 정하시오.',
          expectedDisplay:
            'x: 도서관까지 거리 / x: 집에서 도서관까지 거리 / x: 집과 도서관 사이의 거리 / x: 집과 도서관의 거리 / 도서관까지 거리는 x이다 / 집에서 도서관까지 거리는 x이다 등 (정답지 1~12와 같은 의미)',
          hint:
            'x: 도서관까지 거리 / x: 집에서 도서관까지 거리 / x: 집과 도서관 사이의 거리 등 (정답지 1~12와 같은 의미)',
        },
        {
          id: 2,
          title: '방정식 세우기',
          points: 3,
          type: 'equation',
          prompt: '질문 2. 주어진 조건을 이용하여 일차방정식을 만들어보시오.',
          expectedDisplay: 'x/10+x/15=2',
          expectedLatex: '\\frac{x}{10}+\\frac{x}{15}=2',
          hint: 'x/10+x/15=2',
        },
        {
          id: 3,
          title: '방정식 풀기',
          points: 3,
          type: 'numeric',
          prompt: '질문 3. 일차방정식을 풀어보시오.',
          expectedDisplay: 'x=12',
          expectedNumber: 12,
          hint: 'x=12',
        },
        {
          id: 4,
          title: '문제 해결하기',
          points: 2,
          type: 'numeric',
          prompt: '질문 4. 집에서 도서관까지의 거리는 얼마인가요?',
          expectedDisplay: '12',
          expectedNumber: 12,
          hint: '12',
        },
      ],
    },
    {
      id: 'p5',
      title: '문제 5',
      prompt:
        '어떤 물통에 물을 가득 채우는 데 A호스로는 4시간, B호스로는 3시간이 걸린다. 또, 이 물통에 가득 찬 물을 C호스로 빼는 데 6시간이 걸린다고 한다. 두 호스 A, B로 물을 넣는 동시에 C호스로 물을 뺀다면, 이 물통에 물을 가득 채우기 위해서는 최소한 몇 시간이 필요한지 구하시오.',
      stages: [
        {
          id: 1,
          title: '미지수 정하기',
          points: 2,
          type: 'text',
          prompt: '질문 1. 상황에 맞게 미지수(x)를 정하시오.',
          expectedDisplay:
            'x: 물통에 물을 가득 채우는데 걸리는 시간 / x: 물통을 가득 채우는데 걸리는 시간 / 물통에 물을 가득 채우는데 걸리는 시간은 x이다 / 물통을 가득 채우는데 걸리는 시간은 x이다 / 물통에 물을 가득 채우는데 x시간 걸린다 / 물통을 가득 채우는데 x시간 걸린다 등 (정답지 1~6과 같은 의미)',
          hint:
            'x: 물통에 물을 가득 채우는데 걸리는 시간 / x: 물통을 가득 채우는데 걸리는 시간 등 (정답지 1~6과 같은 의미)',
        },
        {
          id: 2,
          title: '방정식 세우기',
          points: 3,
          type: 'equation',
          prompt:
            '질문 2. 주어진 조건을 이용하여 일차방정식을 만들어보시오.\n단, 물통에 물을 가득 채웠을 때 물의 양은 1 이다.',
          expectedDisplay: '(1/4)x+(1/3)x-(1/6)x=1',
          expectedLatex: '\\frac{1}{4}x+\\frac{1}{3}x-\\frac{1}{6}x=1',
          hint: '(1/4)x+(1/3)x-(1/6)x=1',
        },
        {
          id: 3,
          title: '방정식 풀기',
          points: 3,
          type: 'numeric',
          prompt: '질문 3. 일차방정식을 풀어보시오.',
          expectedDisplay: 'x=12/5 또는 x=2.4',
          expectedLatex: 'x=\\frac{12}{5}\\ \\text{또는}\\ x=2.4',
          expectedNumber: 2.4,
          hint: 'x=12/5 또는 x=2.4',
        },
        {
          id: 4,
          title: '문제 해결하기',
          points: 2,
          type: 'numeric',
          prompt: '질문 4. 물통에 물을 가득 채우는데 필요한 시간은 최소 몇 시간인가요?',
          expectedDisplay: '12/5시간 / 2.4시간 / 2시간 24분',
          expectedLatex:
            '\\frac{12}{5}\\text{시간} \\mid 2.4\\text{시간} \\mid 2\\text{시간 }24\\text{분}',
          expectedNumber: 2.4,
          hint: '12/5시간 / 2.4시간 / 2시간 24분',
        },
      ],
    },
  ]

  const problem = problems[problemIdx]

  const stages = problem.stages
  let stageIndex = 0
  let answers = window.__mmAssessment.answersByProblem[problem.id]
  if (!answers || answers.length !== stages.length) answers = new Array(stages.length).fill(null)
  let latexAnswers = window.__mmAssessment.latexByProblem?.[problem.id]
  if (!latexAnswers || latexAnswers.length !== stages.length) latexAnswers = new Array(stages.length).fill('')
  let scores = window.__mmAssessment.scoresByProblem[problem.id]
  if (!scores || scores.length !== stages.length) scores = new Array(stages.length).fill(0)
  if (!window.__mmAssessment.latexByProblem) window.__mmAssessment.latexByProblem = {}
  window.__mmAssessment.answersByProblem[problem.id] = answers
  window.__mmAssessment.latexByProblem[problem.id] = latexAnswers
  window.__mmAssessment.scoresByProblem[problem.id] = scores

  function getCurrentTotalScore() {
    return problems.reduce((sum, p) => {
      const scored = window.__mmAssessment.scoresByProblem[p.id] || []
      return sum + scored.reduce((acc, value) => acc + (value || 0), 0)
    }, 0)
  }

  async function reportStagePass(stage, stageScore) {
    if (!stageScore?.ok) return
    const passKey = `${problem.id}-stage-${stage.id}`
    if (window.__mmAssessment.reportedPasses[passKey]) return
    window.__mmAssessment.reportedPasses[passKey] = true

    const payload = {
      nickname: getStudentNicknameFromHash() || '익명',
      userLevel: `${problem.title}-${stage.title} 통과`,
      problemNumber: problemIdx + 1,
      stageNumber: stage.id,
      stageTitle: stage.title,
      score: getCurrentTotalScore(),
      completionDate: new Date().toISOString(),
    }

    return sendLearningResultToSheet(payload)
  }

  async function reportFinalCompletion(level, totalScore) {
    if (window.__mmAssessment.reportedFinalCompletion) return
    window.__mmAssessment.reportedFinalCompletion = true
    const diagnosticLevelByTier = {
      최상: '최상(손오공)',
      상: '상(샤오)',
      중: '중(삼장)',
      하: '하(옥동자)',
    }
    const diagnosticLevel = diagnosticLevelByTier[level] || '하(옥동자)'

    const payload = {
      eventType: 'diagnostic',
      nickname: getStudentNicknameFromHash() || '익명',
      diagnosticLevel,
      diagnosticScore: totalScore,
      userLevel: `진단평가 완료 (${level})`,
      problemNumber: 'final',
      stageNumber: 'final',
      stageTitle: '최종 성취',
      score: totalScore,
      completionDate: new Date().toISOString(),
    }

    return sendLearningResultToSheet(payload)
  }

  function normalizeForText(s) {
    return (s || '')
      .toString()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/,/g, '')
      .replace(/[−–]/g, '-')
      .toLowerCase()
  }

  function normalizeKoreanLoose(s) {
    // Allow variations in spacing and Korean particles (조사).
    // Example: "청소년의 입장료" ~ "청소년 입장료"
    let t = normalizeForText(s)
      .replace(/[.?!~]/g, '')
      .replace(/\s+/g, '')

    // Remove common particles/postpositions conservatively.
    t = t.replace(
      /([가-힣0-9]+?)(은|는|이|가|을|를|의|에|에서|에게|께|께서|한테|로|으로|와|과|랑|이랑|도|만|보다|처럼|까지|부터)/g,
      '$1'
    )

    return t
  }

  function parseFlexibleNumber(input) {
    const raw = (input || '').toString().trim()
    if (!raw) return NaN

    // 시간-분 표현 특수 처리 (예: 2시간 24분 = 2.4시간) — 띄어쓰기 무시
    const rawNoSpace = raw.replace(/\s+/g, '')
    const hourMinute = rawNoSpace.match(/^(\d+(?:\.\d+)?)시간(\d+(?:\.\d+)?)분$/)
    if (hourMinute) {
      const h = Number(hourMinute[1])
      const m = Number(hourMinute[2])
      if (Number.isFinite(h) && Number.isFinite(m)) {
        return h + m / 60
      }
    }

    // normalize unicode minus and remove currency/commas
    // also broaden numeric expressions to support: ×, ÷, x=5000, 5,000원, etc.
    const s = rawNoSpace
      .replace(/[−–]/g, '-')
      .replace(/,/g, '')
      .replace(/원/g, '')
      .replace(/년/g, '')
      .replace(/시간/g, '')
      .replace(/분/g, '')
      .replace(/×/g, '*')
      .replace(/[xX]/g, '')
      .replace(/÷/g, '/')
      .replace(/=/g, '')
      // collapse thousands-separated digits: "5 000" -> "5000"
      .replace(/(\d)\s+(?=\d)/g, '$1')
      .trim()
    if (!s) return NaN

    // Allow arithmetic expressions for numeric answers:
    // digits, '.', '+', '-', '*', '/', parentheses and whitespace.
    if (!/^[0-9+\-*/().\s]+$/.test(s)) return NaN

    // Simple recursive descent parser (no eval).
    let i = 0
    const str = s

    function skipSpaces() {
      while (i < str.length && /\s/.test(str[i])) i += 1
    }

    function parseNumber() {
      skipSpaces()
      const start = i
      let hasDot = false

      while (i < str.length) {
        const ch = str[i]
        if (ch === '.') {
          if (hasDot) break
          hasDot = true
          i += 1
          continue
        }
        if (!/[0-9]/.test(ch)) break
        i += 1
      }

      if (i === start) return NaN
      const token = str.slice(start, i)
      const n = Number(token)
      return Number.isFinite(n) ? n : NaN
    }

    function parseFactor() {
      skipSpaces()

      // unary +/-
      if (str[i] === '+') {
        i += 1
        return parseFactor()
      }
      if (str[i] === '-') {
        i += 1
        const v = parseFactor()
        return Number.isFinite(v) ? -v : NaN
      }

      if (str[i] === '(') {
        i += 1
        const v = parseExpression()
        skipSpaces()
        if (str[i] !== ')') return NaN
        i += 1
        return v
      }

      return parseNumber()
    }

    function parseTerm() {
      let v = parseFactor()
      if (!Number.isFinite(v)) return NaN

      while (true) {
        skipSpaces()
        const op = str[i]
        if (op !== '*' && op !== '/') break
        i += 1
        const rhs = parseFactor()
        if (!Number.isFinite(rhs)) return NaN
        if (op === '/') {
          if (rhs === 0) return NaN
          v = v / rhs
        } else {
          v = v * rhs
        }
      }
      return v
    }

    function parseExpression() {
      let v = parseTerm()
      if (!Number.isFinite(v)) return NaN

      while (true) {
        skipSpaces()
        const op = str[i]
        if (op !== '+' && op !== '-') break
        i += 1
        const rhs = parseTerm()
        if (!Number.isFinite(rhs)) return NaN
        v = op === '+' ? v + rhs : v - rhs
      }
      return v
    }

    const value = parseExpression()
    skipSpaces()
    if (!Number.isFinite(value)) return NaN
    if (i !== str.length) return NaN // leftover junk
    return value
  }

  function hasStandaloneDigits(ns, digits) {
    return new RegExp(`(^|[^0-9])${digits}([^0-9]|$)`).test(ns)
  }

  function scoreFinalAnswerText(pid, raw) {
    const loose = normalizeKoreanLoose(raw)
    const ns = normalizeForText(raw).replace(/\s+/g, '')
    if (pid === 'p1') {
      return hasStandaloneDigits(ns, '5000')
    }
    if (pid === 'p2') {
      const n = raw
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[−–]/g, '-')
        .replace(/년/g, '')
      return (
        /^x=8(?:\.0+)?$/.test(n) ||
        /^8(?:\.0+)?$/.test(n) ||
        /x=8(?:\.0+)?/.test(n) ||
        loose.includes('x=8') ||
        loose.endsWith('8년') ||
        loose === '8' ||
        (hasStandaloneDigits(ns, '8') && (raw.includes('년') || loose.includes('년')))
      )
    }
    if (pid === 'p3') {
      return hasStandaloneDigits(ns, '36')
    }
    if (pid === 'p4') {
      const n = parseFlexibleNumber(raw)
      if (Number.isFinite(n)) {
        return Math.abs(n - 12) <= 1e-9
      }
      const compact = normalizeForText(raw).replace(/\s+/g, '')
      const fracMatch = compact.match(/\d+\/\d+/)
      if (fracMatch) {
        const fv = parseFlexibleNumber(fracMatch[0])
        if (Number.isFinite(fv)) return Math.abs(fv - 12) <= 1e-9
      }
      return hasStandaloneDigits(ns, '12')
    }
    if (pid === 'p5') {
      const n = parseFlexibleNumber(raw)
      if (Number.isFinite(n) && Math.abs(n - 2.4) <= 1e-9) return true
      return (
        (loose.includes('12') && loose.includes('5') && (loose.includes('시간') || loose.includes('/'))) ||
        ns.includes('2.4') ||
        (loose.includes('2') && loose.includes('24') && loose.includes('분')) ||
        (ns.includes('12/5') && ns.includes('시간'))
      )
    }
    return false
  }

  /** 미지수 x — LaTeX 명령 이름(\\frac, \\xi 등) 안의 x는 제외. \\text{…} 가 plain 에 남은 `text`의 x는 제외 */
  function answerContainsVariableX(bundle) {
    const t = (bundle || '').toString()
    if (t.includes('\u{1D465}')) return true
    let stripped = t.replace(/\\[a-zA-Z]+/g, '')
    stripped = stripped.replace(/text(?=[\uAC00-\uD7A3a-zA-Z])/gi, '')
    stripped = stripped.replace(/\btext\b/gi, '')
    return /[xX]/.test(stripped)
  }

  function scoreStage(stage, studentInput) {
    const raw = (studentInput || '').toString()
    if (stage.type === 'numeric') {
      // 문제2 방정식 풀기: x=8, x = 8 형태를 명시적으로 정답 처리
      if (problem.id === 'p2' && stage.id === 3) {
        const n = raw
          .toString()
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '')
          .replace(/[−–]/g, '-')
          .replace(/년/g, '')
        const loose = normalizeKoreanLoose(raw)
        if (
          /^x=8(?:\.0+)?$/.test(n) ||
          /^8(?:\.0+)?$/.test(n) ||
          /x=8(?:\.0+)?/.test(n) ||
          loose.includes('x=8') ||
          loose.endsWith('8년') ||
          loose === '8'
        ) {
          return { score: stage.points, ok: true }
        }
      }

      const expected = stage.expectedNumber
      const studentN = parseFlexibleNumber(raw)
      if (Number.isFinite(studentN)) {
        const eps = 1e-9
        if (Math.abs(studentN - expected) <= eps) {
          return { score: stage.points, ok: true }
        }
      }
      // [4단계] 문제 해결: 숫자·한글·영어 혼합 정답 허용
      if (stage.id === 4 && scoreFinalAnswerText(problem.id, raw)) {
        return { score: stage.points, ok: true }
      }
      return { score: 0, ok: false }
    }

    if (stage.type === 'text') {
      const n = normalizeForText(raw)
      const ns = n.replace(/\s+/g, '')
      const loose = normalizeKoreanLoose(raw)
      const accepted = stage.acceptedTexts || []

      // [1단계] 미지수 정하기 — 문제별
      if (problem.id === 'p1') {
        const hasX = loose.includes('x') || loose.includes('미지수')
        const hasYouth = loose.includes('청소년')
        const hasEntryFee = loose.includes('입장료')
        const hasOne = loose.includes('1명의') || loose.includes('1명') || loose.includes('한명')
        const isYouthFee = hasYouth && hasEntryFee && (hasOne || loose.includes('청소년'))
        if ((hasX && isYouthFee) || isYouthFee) return { score: stage.points, ok: true }
        const looseInput = normalizeKoreanLoose(raw)
        const acceptedHit = accepted.some((a) => {
          const looseAnswer = normalizeKoreanLoose(a)
          return (
            looseAnswer === looseInput ||
            looseInput.includes(looseAnswer) ||
            looseAnswer.includes(looseInput)
          )
        })
        return { score: acceptedHit ? stage.points : 0, ok: acceptedHit }
      }

      if (problem.id === 'p2') {
        const acceptedP2 = [
          '아버지 나이가 딸 나이의 3배가 되는데 걸린 시간',
          '몇 년후 아버지 나이가 딸 나이의 3배가 되는가',
          '아버지 나이가 딸 나이의 3배가 되는데 걸린 년 수',
          '아버지 나이가 딸 나이의 3배가 되는데 걸린 년수',
        ].map((t) => normalizeKoreanLoose(t))
        const matchByKey = acceptedP2.some((ans) => loose.includes(ans) || ans.includes(loose))
        const hasFather = loose.includes('아버지')
        const hasDaughter = loose.includes('딸')
        const has3x = loose.includes('3배') || loose.includes('세배')
        const hasYear =
          loose.includes('년') ||
          loose.includes('시간') ||
          loose.includes('몇년') ||
          loose.includes('년수') ||
          loose.includes('몇년후') ||
          loose.includes('걸린년수')
        const matchByMeaning = hasFather && hasDaughter && has3x && hasYear
        const ok = matchByKey || matchByMeaning
        return { score: ok ? stage.points : 0, ok }
      }

      if (problem.id === 'p3') {
        const hasX = loose.includes('x') || ns.includes('x') || answerContainsVariableX(raw)
        const hasDigit = ns.includes('십의자리') || ns.includes('10의자리')
        const ok = hasX && hasDigit
        return { score: ok ? stage.points : 0, ok }
      }

      if (problem.id === 'p4') {
        const hasX = loose.includes('x') || ns.includes('x') || answerContainsVariableX(raw)
        const t = ns
        if (t.includes('km')) return { score: hasX ? stage.points : 0, ok: hasX }
        const has거리 = t.includes('거리')
        const hasLib = t.includes('도서관')
        const has집 = t.includes('집')
        const has사이 = t.includes('사이')
        if (has거리 && (hasLib || has집 || has사이)) {
          return { score: hasX ? stage.points : 0, ok: hasX }
        }
        if (has거리 && (t.includes('왕복') || t.includes('가고') || t.includes('다녀'))) {
          return { score: hasX ? stage.points : 0, ok: hasX }
        }
        return { score: 0, ok: false }
      }

      if (problem.id === 'p5') {
        const hasX = loose.includes('x') || ns.includes('x') || answerContainsVariableX(raw)
        const ok = hasX && ns.includes('시간') && (ns.includes('가득') || ns.includes('채우'))
        return { score: ok ? stage.points : 0, ok }
      }

      return { score: 0, ok: false }
    }

    if (stage.type === 'equation') {
      const n = raw
        .toString()
        .trim()
        .replace(/\s+/g, '')
        .replace(/[−–]/g, '-')
        .toLowerCase()

      const compact = n.replace(/\*/g, '')

      if (problem.id === 'p2') {
        const hasEq = compact.includes('=')
        const has40 = compact.includes('40')
        const has8 = compact.includes('8')
        const hasX = compact.includes('x')
        const has3 = compact.includes('3(') || compact.includes('*3') || compact.includes('x3') || compact.includes('3*')
        const ok = hasEq && has40 && has8 && hasX && has3
        return { score: ok ? stage.points : 0, ok }
      } else if (problem.id === 'p3') {
        const ok = compact.includes('10x+6') && (compact.includes('4(6+x)') || compact.includes('4(x+6)'))
        return { score: ok ? stage.points : 0, ok }
      } else if (problem.id === 'p4') {
        // 정답지: x/10 + x/15 = 2
        // 분수 입력(LaTeX \frac) → (x)/(10) 형태이므로 x/n · (1/n)x 와 동치로 정규화
        let c = compact
        c = c.replace(/\((x)\)\/\((\d+)\)/g, 'x/$2')
        c = c.replace(/\((\d+)\)\/\((\d+)\)/g, '($1/$2)')
        const hasEq2 = c.includes('=2')
        const hasTerm = (den) => {
          const d = String(den)
          return (
            c.includes(`x/${d}`) ||
            c.includes(`x÷${d}`) ||
            c.includes(`(1/${d})x`) ||
            c.includes(`1/${d}x`) ||
            c.includes(`x*(1/${d})`) ||
            c.includes(`(1/${d})*x`)
          )
        }
        const ok = hasEq2 && hasTerm(10) && hasTerm(15)
        return { score: ok ? stage.points : 0, ok }
      } else if (problem.id === 'p5') {
        let c = compact
        c = c.replace(/[·⋅∙]/g, '')
        c = c.replace(/\((x)\)\/\((\d+)\)/g, 'x/$2')
        c = c.replace(/\((\d+)\)\/\((\d+)\)/g, '($1/$2)')
        const hasTerm = (den) => {
          const d = String(den)
          return (
            c.includes(`x/${d}`) ||
            c.includes(`x÷${d}`) ||
            c.includes(`(1/${d})x`) ||
            c.includes(`1/${d}x`) ||
            c.includes(`1/${d}(x)`) ||
            c.includes(`x*(1/${d})`) ||
            c.includes(`(1/${d})*x`)
          )
        }
        const ok = hasTerm(4) && hasTerm(3) && hasTerm(6) && c.includes('=1')
        return { score: ok ? stage.points : 0, ok }
      } else {
        // PDF 기준: 3x + 2(x + 3000) = 31000
        const hasEq = compact.includes('=')
        const hasTotal = compact.includes('31000')
        const has3x = compact.includes('3x')
        const has3000 = compact.includes('3000')
        const has6000 = compact.includes('6000')
        const has5x = compact.includes('5x')

        const hasXplus = compact.includes('x+3000')
        const hasFactored =
          compact.includes('2(x+3000)') ||
          compact.includes('2*(x+3000)') ||
          /2\(?x\+3000\)?/.test(compact) // 2(x+3000) 계열

        // 전개형 일부 허용: 2x+6000, 5x+6000 등
        const hasExpanded =
          compact.includes('2x+6000') ||
          compact.includes('5x+6000') ||
          compact.includes('3x+2x+6000') ||
          (compact.includes('2x') && has3x && has6000)

        // factorized: 3x + 2(x+3000) = 31000
        // expanded: 5x + 6000 = 31000 (등)
        const ok =
          hasEq &&
          hasTotal &&
          ((hasXplus && hasFactored && has3x) || (hasExpanded && (has5x || has3x)))
        return { score: ok ? stage.points : 0, ok }
      }
    }

    return { score: 0, ok: false }
  }

  function renderHeaderBadge() {
    const totalPoints = stages.reduce((acc, s) => acc + s.points, 0)
    const currentScore = scores.reduce((acc, s) => acc + s, 0)
    const progressText = `Lv. 진단 ${currentScore}/${totalPoints}`
    const badge = app.querySelector('#mm-progress-badge')
    if (badge) badge.textContent = progressText
  }

  function escapeHtml(str) {
    return (str || '')
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function latexToDisplay(latex) {
    const src = (latex || '').toString().trim()
    if (!src) return ''
    return src
      .replace(/\\left|\\right/g, '')
      .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1/$2')
      .replace(/\\frac\s*([0-9a-zA-Z]+)\s*([0-9a-zA-Z]+)/g, '$1/$2')
      .replace(/\\times|\\cdot/g, '×')
      .replace(/[{}]/g, '')
      .trim()
  }

  function formatExpectedAnswerHtml(stage) {
    const raw = (stage.expectedDisplay || stage.hint || '').toString().trim()
    const latex = stage.expectedLatex
    if (latex && typeof latex === 'string') {
      return `<math-field read-only class="mm-inline-math mm-expected-math" value="${escapeHtml(latex)}"></math-field>`
    }
    return escapeHtml(raw)
  }

  function formatStudentAnswerHtml(stage, answerText, stageIdx, emptyText = '미제출') {
    const raw = (answerText || '').toString().trim()
    if (!raw) return `<span class="mm-muted">${escapeHtml(emptyText)}</span>`

    // multiInput 단계는 답 2개를 (1), (2)로 분리해서 표시
    if (stage.multiInput) {
      const parts = raw.split('\n')
      const first = (parts[0] || '').trim()
      const second = (parts[1] || '').trim()
      const latexRaw = (typeof stageIdx === 'number' ? latexAnswers[stageIdx] : '') || ''
      const latexParts = latexRaw.split('\n')
      const firstView = (latexParts[0] || first || '미입력').trim()
      const secondView = (latexParts[1] || second || '미입력').trim()
      return `
        <span class="mm-answer-part"><span class="mm-answer-part-no">(1)</span> <math-field read-only class="mm-inline-math" value="${escapeHtml(firstView)}"></math-field></span>
        <span class="mm-answer-part"><span class="mm-answer-part-no">(2)</span> <math-field read-only class="mm-inline-math" value="${escapeHtml(secondView)}"></math-field></span>
      `
    }

    const latexRaw = (typeof stageIdx === 'number' ? latexAnswers[stageIdx] : '') || ''
    if (latexRaw) {
      return `<math-field read-only class="mm-inline-math" value="${escapeHtml(latexRaw)}"></math-field>`
    }
    return escapeHtml(raw)
  }

  app.innerHTML = `
  <div class="mm-shell" role="application" aria-label="math-master">
    <header class="mm-header">
      <div class="mm-brand">
        <div class="mm-logo" aria-hidden="true">=</div>
        <div class="mm-brand-text">
          <div class="mm-title-top">MAGIC MATH WORLD</div>
          <div class="mm-title-sub">MAGIC MATH ADVENTURE</div>
        </div>
      </div>
      <div class="mm-badge" id="mm-progress-badge">Lv. 진단 0/${problems[0].stages.reduce((a, s) => a + s.points, 0)}</div>
    </header>

    <main class="mm-main mm-main-steps">
      <section class="mm-steps-card" aria-labelledby="mm-problem-title">
        <div class="mm-steps-top">
          <div class="mm-steps-title-wrap">
            <div class="mm-steps-kicker">${problem.title}</div>
            <h1 class="mm-steps-title" id="mm-problem-title">단계별 풀이 입력</h1>
          </div>
          <button type="button" class="mm-ghost-btn" id="mm-back">첫 화면</button>
        </div>

        <div class="mm-problem-block" role="region" aria-label="문제">
          <div class="mm-problem-prompt">${problem.prompt}</div>
        </div>

        <div class="mm-history-block" id="mm-history-block" role="region" aria-label="단계별 기록"></div>

        <div class="mm-step-block" role="region" aria-label="현재 단계">
          <div class="mm-step-meta">
            <div class="mm-step-pill">Step ${stageIndex + 1} / ${stages.length}</div>
            <div class="mm-step-points">배점: ${stages[stageIndex].points}점</div>
          </div>

          <div class="mm-step-question">${stages[stageIndex].prompt}</div>

          <div class="mm-input-label-row">
            <label class="mm-input-label" for="mm-answer-input">
              답 입력
            </label>
            <button type="button" class="mm-mode-toggle" id="mm-input-mode-toggle">수식 입력</button>
            <div class="mm-step-feedback mm-step-feedback-inline" id="mm-step-feedback" aria-live="polite"></div>
          </div>
          <div class="mm-answer-single" id="mm-answer-single">
            <div class="mm-answer-row">
              <span class="mm-eq-prefix" id="mm-eq-prefix" hidden>x=</span>
            <input
              id="mm-answer-input"
              class="mm-input"
              type="text"
              spellcheck="false"
              autocomplete="off"
              inputmode="text"
              placeholder="답을 입력하세요"
            />
            <math-field
              id="mm-answer-mathfield"
              class="mm-input mm-mathfield"
              hidden
            ></math-field>
            </div>
          </div>
          <div class="mm-answer-double" id="mm-answer-double" hidden>
            <div class="mm-answer-row">
              <span class="mm-answer-no">(1)</span>
              <input
                id="mm-answer-input-1"
                class="mm-input"
                type="text"
                spellcheck="false"
                autocomplete="off"
                inputmode="text"
                placeholder="첫 번째 답을 입력하세요"
              />
              <math-field
                id="mm-answer-mathfield-1"
                class="mm-input mm-mathfield"
                hidden
              ></math-field>
            </div>
            <div class="mm-answer-row">
              <span class="mm-answer-no">(2)</span>
              <input
                id="mm-answer-input-2"
                class="mm-input"
                type="text"
                spellcheck="false"
                autocomplete="off"
                inputmode="text"
                placeholder="두 번째 답을 입력하세요"
              />
              <math-field
                id="mm-answer-mathfield-2"
                class="mm-input mm-mathfield"
                hidden
              ></math-field>
            </div>
          </div>

          <div class="mm-math-tools" id="mm-math-tools" hidden>
            <button type="button" class="mm-tool-btn" data-token="=">=</button>
            <button type="button" class="mm-tool-btn" data-token="+">+</button>
            <button type="button" class="mm-tool-btn" data-token="-">-</button>
            <button type="button" class="mm-tool-btn" data-token="×">×</button>
            <button type="button" class="mm-tool-btn" data-token="/">/</button>
            <button type="button" class="mm-tool-btn" data-token="(">(</button>
            <button type="button" class="mm-tool-btn" data-token=")">)</button>
            <button type="button" class="mm-tool-btn" data-token="{">{</button>
            <button type="button" class="mm-tool-btn" data-token="}">}</button>
          </div>

          <div class="mm-step-actions">
            <button type="button" class="mm-btn-secondary mm-btn-w100" id="mm-prev-step">
              이전 단계로 돌아가기
            </button>
            <button type="button" class="mm-btn-primary mm-btn-w100" id="mm-submit-step">
              ${stageIndex === stages.length - 1 ? '채점하고 결과 보기' : '답 저장 후 다음 단계'}
            </button>
          </div>

        </div>
      </section>
    </main>

    <footer class="mm-footer">
      <a class="mm-link" href="#" id="mm-home-link">홈으로</a>
    </footer>
  </div>
  `

  app.querySelector('#mm-back')?.addEventListener('click', () => {
    location.hash = '#welcome'
  })

  app.querySelector('#mm-home-link')?.addEventListener('click', (e) => {
    e.preventDefault()
    location.hash = '#welcome'
  })

  const inputEl = app.querySelector('#mm-answer-input')
  const mathfieldEl = app.querySelector('#mm-answer-mathfield')
  const inputEl1 = app.querySelector('#mm-answer-input-1')
  const inputEl2 = app.querySelector('#mm-answer-input-2')
  const mathfieldEl1 = app.querySelector('#mm-answer-mathfield-1')
  const mathfieldEl2 = app.querySelector('#mm-answer-mathfield-2')
  const answerSingleEl = app.querySelector('#mm-answer-single')
  const answerDoubleEl = app.querySelector('#mm-answer-double')
  const feedbackEl = app.querySelector('#mm-step-feedback')
  const stepPillEl = app.querySelector('.mm-step-pill')
  const stepPointsEl = app.querySelector('.mm-step-points')
  const stepQuestionEl = app.querySelector('.mm-step-question')
  const inputLabelEl = app.querySelector('.mm-input-label')
  const modeToggleEl = app.querySelector('#mm-input-mode-toggle')
  const mathToolsEl = app.querySelector('#mm-math-tools')
  const toolBtns = Array.from(app.querySelectorAll('.mm-tool-btn'))
  let activeInputEl = null
  let activeMathfieldEl = null
  let isSubmittingStep = false
  const submitBtnEl = app.querySelector('#mm-submit-step')
  const prevBtnEl = app.querySelector('#mm-prev-step')
  const historyEl = app.querySelector('#mm-history-block')
  const eqPrefixEl = app.querySelector('#mm-eq-prefix')

  function isMathFieldStage(stage) {
    return true
  }

  function latexToPlain(latex) {
    return (latex || '')
      .replace(/\\left|\\right/g, '')
      .replace(/\\text\s*\{\s*\}/g, ' ')
      .replace(/\\times|\\cdot/g, '*')
      .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
      .replace(/\\frac\s*([0-9a-zA-Z]+)\s*([0-9a-zA-Z]+)/g, '($1)/($2)')
      .replace(/\\/g, '')
      .replace(/[{}]/g, '')
      .trim()
  }

  function syncMathFieldToInput() {
    if (!mathfieldEl || !inputEl) return
    const latex = (mathfieldEl.getValue?.('latex') || '').trim()
    inputEl.dataset.latex = latex
    inputEl.value = latexToPlain(latex)
  }

  function syncMultiMathFieldToInputs() {
    if (!mathfieldEl1 || !mathfieldEl2 || !inputEl1 || !inputEl2) return
    const latex1 = (mathfieldEl1.getValue?.('latex') || '').trim()
    const latex2 = (mathfieldEl2.getValue?.('latex') || '').trim()
    inputEl1.dataset.latex = latex1
    inputEl2.dataset.latex = latex2
    inputEl1.value = latexToPlain(latex1)
    inputEl2.value = latexToPlain(latex2)
  }

  function insertFractionTemplate(targetEl = mathfieldEl) {
    if (!targetEl) return
    if (typeof targetEl.executeCommand === 'function') {
      targetEl.executeCommand(['insert', '\\frac{#?}{#?}'])
    } else if (typeof targetEl.insert === 'function') {
      targetEl.insert('\\frac{#?}{#?}')
    }
    syncMathFieldToInput()
    syncMultiMathFieldToInputs()
  }

  function insertPlainSpace(targetEl = mathfieldEl) {
    if (!targetEl) return
    // MathLive 수학 모드에서도 공백이 보이도록 text-run으로 삽입
    if (typeof targetEl.executeCommand === 'function') {
      targetEl.executeCommand(['insert', '\\text{ }'])
    } else {
      targetEl.insert('\\text{ }')
    }
    syncMathFieldToInput()
    syncMultiMathFieldToInputs()
  }

  function updateStepUI() {
    const stage = stages[stageIndex]
    const useMathField = isMathFieldStage(stage)
    if (stepPillEl) stepPillEl.textContent = `${stageIndex + 1}단계. ${stage.title}`
    if (stepPointsEl) stepPointsEl.textContent = `배점: ${stage.points}점`
    if (stepQuestionEl) stepQuestionEl.textContent = stage.prompt
    const isMultiInput = Boolean(stage.multiInput)
    if (isMultiInput) {
      if (answerSingleEl) {
        answerSingleEl.hidden = true
        answerSingleEl.style.display = 'none'
      }
      if (answerDoubleEl) {
        answerDoubleEl.hidden = false
        answerDoubleEl.style.display = 'flex'
      }
      if (inputEl1) inputEl1.placeholder = '첫 번째 답을 입력하세요 (분수 가능: 1/2)'
      if (inputEl2) inputEl2.placeholder = '두 번째 답을 입력하세요 (분수 가능: 1/2)'
      if (inputEl1) inputEl1.hidden = useMathField
      if (inputEl2) inputEl2.hidden = useMathField
      if (mathfieldEl1) {
        mathfieldEl1.hidden = !useMathField
        mathfieldEl1.setAttribute('placeholder', inputEl1?.placeholder || '첫 번째 답')
      }
      if (mathfieldEl2) {
        mathfieldEl2.hidden = !useMathField
        mathfieldEl2.setAttribute('placeholder', inputEl2?.placeholder || '두 번째 답')
      }
    } else {
      if (answerSingleEl) {
        answerSingleEl.hidden = false
        answerSingleEl.style.display = 'block'
      }
      if (answerDoubleEl) {
        answerDoubleEl.hidden = true
        answerDoubleEl.style.display = 'none'
      }
      if (inputEl) {
        if (stage.type === 'equation') {
          inputEl.placeholder = '답을 입력하세요 (분수 가능: 1/2)'
        } else if (stage.type === 'numeric' && stage.id === 4) {
          inputEl.placeholder = '답을 입력하세요 (숫자·한글·영어 가능)'
        } else if (stage.type === 'numeric') {
          inputEl.placeholder = '숫자만 입력하세요 (분수 가능: 1/2)'
        } else {
          inputEl.placeholder = '답을 입력하세요'
        }
      }
      if (inputEl1) inputEl1.hidden = false
      if (inputEl2) inputEl2.hidden = false
      if (mathfieldEl1) mathfieldEl1.hidden = true
      if (mathfieldEl2) mathfieldEl2.hidden = true
    }
    if (mathfieldEl && inputEl) {
      inputEl.hidden = useMathField
      mathfieldEl.hidden = !useMathField
      if (useMathField) {
        mathfieldEl.setAttribute('placeholder', inputEl.placeholder || '답을 입력하세요')
      }
    }
    if (mathToolsEl) {
      const isMathStage = useMathField
      mathToolsEl.hidden = !isMathStage
    }
    if (eqPrefixEl) eqPrefixEl.hidden = !(stage.type === 'numeric' && stage.id === 3 && !isMultiInput)
    if (inputLabelEl) inputLabelEl.textContent = '답 입력'
    if (modeToggleEl) modeToggleEl.hidden = true

    if (submitBtnEl) {
      const last = stageIndex === stages.length - 1
      submitBtnEl.textContent = last ? '채점하고 결과 보기' : '답 저장 후 다음 단계'
    }
    if (prevBtnEl) {
      const first = stageIndex === 0
      prevBtnEl.disabled = first
      prevBtnEl.hidden = first
    }

    restoreInputForCurrentStage()

    renderHistory()
  }

  function restoreInputForCurrentStage() {
    const stage = stages[stageIndex]
    const saved = (answers[stageIndex] || '').toString()
    const savedLatex = (latexAnswers[stageIndex] || '').toString()
    const useMathField = isMathFieldStage(stage)

    if (stage.multiInput) {
      const parts = saved.split('\n')
      const latexParts = savedLatex.split('\n')
      if (useMathField) {
        if (mathfieldEl1) mathfieldEl1.setValue((latexParts[0] || parts[0] || '').trim())
        if (mathfieldEl2) mathfieldEl2.setValue((latexParts[1] || parts[1] || '').trim())
        syncMultiMathFieldToInputs()
      } else {
        if (inputEl1) inputEl1.value = (parts[0] || '').trim()
        if (inputEl2) inputEl2.value = (parts[1] || '').trim()
        if (inputEl1) inputEl1.dataset.latex = ''
        if (inputEl2) inputEl2.dataset.latex = ''
      }
      if (inputEl) inputEl.value = ''
      return
    }

    if (useMathField && mathfieldEl && inputEl) {
      mathfieldEl.setValue(savedLatex || saved || '')
      syncMathFieldToInput()
    } else if (inputEl) {
      inputEl.value = saved
      inputEl.dataset.latex = ''
    }
    if (inputEl1) inputEl1.value = ''
    if (inputEl2) inputEl2.value = ''
  }

  function renderHistory() {
    if (!historyEl) return

    // 1번째 문제에서는 누적 영역을 보여주지 않음
    if (stageIndex === 0) {
      historyEl.innerHTML = ''
      return
    }

    const items = stages
      // 2번째 문제부터는 "이전에 푼 문제"만 누적 표시
      .slice(0, stageIndex)
      .map((s, idx) => {
        const rawAnswer = (answers[idx] || '').toString().trim()
        const shownAnswer = rawAnswer || '미제출'

        return `
          <div class="mm-history-item">
            <div class="mm-history-head">
              <span class="mm-history-step">${idx + 1}단계</span>
              <span class="mm-history-point">${s.points}점</span>
            </div>
            <div class="mm-history-question">${escapeHtml(s.prompt)}</div>
            <div class="mm-history-answer">
              <span class="mm-history-label">학생 답</span>
              <span class="mm-history-value">${formatStudentAnswerHtml(s, shownAnswer, idx)}</span>
            </div>
          </div>
        `
      })
      .join('')

    historyEl.innerHTML = `
      <div class="mm-history-title">단계별 문제/작성 답</div>
      <div class="mm-history-list">${items}</div>
    `
  }

  // First render sync (stage title/prompt/placeholder)
  updateStepUI()

  ;[inputEl, inputEl1, inputEl2].forEach((el) => {
    el?.addEventListener('focus', () => {
      activeInputEl = el
      activeMathfieldEl = null
    })
  })
  mathfieldEl?.addEventListener('focusin', () => {
    activeMathfieldEl = mathfieldEl
    activeInputEl = inputEl
  })
  mathfieldEl?.addEventListener('keydown', (event) => {
    if (event.key === ' ') {
      event.preventDefault()
      insertPlainSpace(mathfieldEl)
      return
    }
    if (event.key !== '/') return
    event.preventDefault()
    insertFractionTemplate()
  })
  mathfieldEl?.addEventListener('beforeinput', (event) => {
    if (event.inputType === 'insertText' && event.data === ' ') {
      event.preventDefault()
      insertPlainSpace(mathfieldEl)
      return
    }
    if (event.inputType !== 'insertText' || event.data !== '/') return
    event.preventDefault()
    insertFractionTemplate()
  })
  mathfieldEl?.addEventListener('input', () => {
    syncMathFieldToInput()
  })
  ;[mathfieldEl1, mathfieldEl2].forEach((mf, idx) => {
    mf?.addEventListener('focusin', () => {
      activeMathfieldEl = mf
      activeInputEl = idx === 0 ? inputEl1 : inputEl2
    })
    mf?.addEventListener('keydown', (event) => {
      if (event.key === ' ') {
        event.preventDefault()
        insertPlainSpace(mf)
        return
      }
      if (event.key !== '/') return
      event.preventDefault()
      insertFractionTemplate(mf)
    })
    mf?.addEventListener('beforeinput', (event) => {
      if (event.inputType === 'insertText' && event.data === ' ') {
        event.preventDefault()
        insertPlainSpace(mf)
        return
      }
      if (event.inputType !== 'insertText' || event.data !== '/') return
      event.preventDefault()
      insertFractionTemplate(mf)
    })
    mf?.addEventListener('input', () => {
      syncMultiMathFieldToInputs()
    })
  })

  function insertAtCursor(el, text) {
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const before = el.value.slice(0, start)
    const after = el.value.slice(end)
    el.value = `${before}${text}${after}`
    const nextPos = start + text.length
    el.setSelectionRange(nextPos, nextPos)
    el.focus()
  }

  toolBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const token = btn.dataset.token || ''
      const currentStage = stages[stageIndex]
      if (isMathFieldStage(currentStage)) {
        const targetMathField = activeMathfieldEl || (currentStage.multiInput ? mathfieldEl1 : mathfieldEl)
        if (!targetMathField) return
        activeMathfieldEl = targetMathField
        targetMathField.focus()
        if (token === '/') {
          insertFractionTemplate(targetMathField)
        } else {
          if (typeof targetMathField.executeCommand === 'function') {
            targetMathField.executeCommand(['insert', token])
          } else {
            targetMathField.insert(token)
          }
          syncMathFieldToInput()
          syncMultiMathFieldToInputs()
        }
        return
      }
      const fallback = currentStage?.multiInput ? inputEl1 || inputEl2 : inputEl
      insertAtCursor(activeInputEl || fallback, token)
    })
  })

  function showFeedback(text, tone) {
    feedbackEl.textContent = text
    feedbackEl.dataset.tone = tone || 'neutral'
  }

  async function renderFinalAchievementTable() {
    const qCount = 4
    const problemSums = problems.map((p) => {
      const sc = window.__mmAssessment.scoresByProblem[p.id] || []
      return p.stages.reduce((acc, _, i) => acc + (sc[i] || 0), 0)
    })
    const problemMax = problems.map((p) => p.stages.reduce((a, s) => a + s.points, 0))
    const rowSums = Array.from({ length: qCount }, (_, qi) =>
      problems.reduce((sum, p) => sum + ((window.__mmAssessment.scoresByProblem[p.id] || [])[qi] || 0), 0)
    )
    const rowMax = Array.from({ length: qCount }, (_, qi) =>
      problems.reduce((sum, p) => sum + p.stages[qi].points, 0)
    )
    const total = problemSums.reduce((a, b) => a + b, 0)
    const totalMax = problemMax.reduce((a, b) => a + b, 0)
    const p1 = problemSums[0] || 0
    const p2 = problemSums[1] || 0
    const p3 = problemSums[2] || 0
    const p4 = problemSums[3] || 0
    const p5 = problemSums[4] || 0

    const highIn123 = [p1, p2, p3].filter((v) => v >= 7).length
    let level = '하'
    if (p4 >= 7 && p5 >= 7) {
      level = '최상'
    } else if ((p4 >= 7 && p5 <= 6) || (p4 <= 6 && p5 >= 7)) {
      level = '상'
    } else if (p4 <= 6 && p5 <= 6 && highIn123 >= 2) {
      level = '중'
    } else {
      level = '하'
    }

    const levelProfiles = {
      최상: {
        headline: '문장(文章)의 마스터: 손오공',
        summary:
          "'용기(勇氣)', '필승(必勝)' 등 복잡한 한자 마법을 자유자재로 조합하듯, 복잡한 문장을 완벽한 방정식으로 변환하는 능력자입니다.",
        message:
          '천자탄이 완성되었다! 너의 방정식은 어떤 난제도 단번에 타격할 수 있는 강력한 마법이야.',
        badge: '⭐',
      },
      상: {
        headline: '지략의 명사수: 샤오',
        summary:
          '차분하고 영리하게 상황을 분석하여 마법을 부리는 샤오처럼, 문제 속 단서를 정확히 찾아내어 논리적인 식을 설계합니다.',
        message:
          '한자 마법의 핵심을 꿰뚫었구나! 복잡한 조건들도 너의 논리 앞에서는 명확한 수식으로 정리돼.',
        badge: '🎯',
      },
      중: {
        headline: '성실한 탐험가: 삼장',
        summary:
          '마법 능력은 충분하지만 때때로 신중함이 더 필요한 단계입니다. 포기하지 않고 끝까지 문제를 탐구하며 실력을 키워갑니다.',
        message: '마법의 기운이 느껴져! 조금만 더 집중해서 방정식을 만들어 보자.',
        badge: '🧭',
      },
      하: {
        headline: '마법 수련생: 옥동자',
        summary:
          "이제 막 마법 천자패를 손에 넣은 단계입니다. '나올 출(出)', '들 입(入)' 같은 기초 한자(미지수 설정)부터 익히며 모험을 시작합니다.",
        message:
          '마법 천자패가 반응하고 있어! 미지수 x라는 마법의 기초를 다지면 곧 강력한 주문을 쓸 수 있을 거야.',
        badge: '🌱',
      },
    }

    const activeProfile = levelProfiles[level]
    const finalSendResult = await reportFinalCompletion(level, total)
    if (!finalSendResult?.ok) {
      alert(`최종 결과 전송 실패: ${finalSendResult?.reason || 'unknown_error'}`)
      return
    }
    const levelAvatarImg = {
      최상: { src: sonGokuImg, alt: '최상 캐릭터 손오공' },
      상: { src: shaoImg, alt: '상 캐릭터 샤오' },
      중: { src: samjangImg, alt: '중 캐릭터 삼장' },
      하: { src: okdongjaImg, alt: '하 캐릭터 옥동자' },
    }
    const av = levelAvatarImg[level]
    const avatarInner = `<img src="${av.src}" alt="${escapeHtml(av.alt)}" class="mm-final-avatar-img" width="240" height="240" />`

    app.innerHTML = `
    <div class="mm-shell" role="application" aria-label="math-master">
      <header class="mm-header">
        <div class="mm-brand">
          <div class="mm-logo" aria-hidden="true">=</div>
          <div class="mm-brand-text">
            <div class="mm-title-top">MAGIC MATH WORLD</div>
            <div class="mm-title-sub">MAGIC MATH ADVENTURE</div>
          </div>
        </div>
        <div class="mm-badge">최종 성취 ${total}/${totalMax}</div>
      </header>
      <main class="mm-main">
        <section class="mm-result-card mm-final-wrap">
          <div class="mm-final-hero mm-final-hero-split" role="region" aria-label="진단 결과 요약">
            <div class="mm-final-hero-left">
              <div class="mm-final-avatar">${avatarInner}</div>
            </div>
            <div class="mm-final-hero-text">
              <p class="mm-final-tier mm-final-tier-line1">당신의 레벨은</p>
              <p class="mm-final-tier mm-final-tier-line2">${escapeHtml(activeProfile.headline)} 입니다</p>
              <p class="mm-final-desc">${escapeHtml(activeProfile.summary)}</p>
              <p class="mm-final-quote">${escapeHtml(activeProfile.message)}</p>
              <p class="mm-final-meta">총점 ${total}/${totalMax} ${escapeHtml(activeProfile.badge)}</p>
            </div>
          </div>
          <h2 class="mm-final-table-title">진단평가 결과</h2>
          <div class="mm-score-grid">
            <div class="mm-score-row">
              <div class="mm-score-step">질문 \\ 문제</div>
              ${problems.map((_, i) => `<div class="mm-score-points">문제${i + 1}</div>`).join('')}
              <div class="mm-score-points">합계 점수</div>
            </div>
            ${Array.from({ length: qCount }, (_, qi) => `
              <div class="mm-score-row">
                <div class="mm-score-step">질문${qi + 1}</div>
                ${problems.map((p) => {
                  const v = (window.__mmAssessment.scoresByProblem[p.id] || [])[qi] || 0
                  return `<div class="mm-score-points">${v}/${p.stages[qi].points}</div>`
                }).join('')}
                <div class="mm-score-points">${rowSums[qi]}/${rowMax[qi]}</div>
              </div>
            `).join('')}
            <div class="mm-score-row">
              <div class="mm-score-step">합계 점수</div>
              ${problems
                .map(
                  (_, i) =>
                    `<div class="mm-score-points ${problemSums[i] >= 7 ? 'mm-score-pass' : ''}">${problemSums[i]}/${problemMax[i]}</div>`
                )
                .join('')}
              <div class="mm-score-points">${total}/${totalMax}</div>
            </div>
          </div>
          <div class="mm-result-actions">
            <button type="button" class="mm-btn-secondary mm-btn-w100" id="mm-go-welcome">첫 화면으로</button>
          </div>
        </section>
      </main>
    </div>`

    app.querySelector('#mm-go-welcome')?.addEventListener('click', () => {
      location.hash = '#welcome'
    })
  }

  app.querySelector('#mm-submit-step')?.addEventListener('click', async () => {
    if (isSubmittingStep) return
    isSubmittingStep = true
    if (submitBtnEl) submitBtnEl.disabled = true

    try {
      const stage = stages[stageIndex]
      const useMathField = isMathFieldStage(stage)
      let studentInput = ''
      if (stage.multiInput) {
        if (useMathField) syncMultiMathFieldToInputs()
        const a1 = (inputEl1?.value || '').trim()
        const a2 = (inputEl2?.value || '').trim()
        studentInput = [a1, a2].filter(Boolean).join('\n')
        if (useMathField) {
          const l1 = (inputEl1?.dataset.latex || '').trim()
          const l2 = (inputEl2?.dataset.latex || '').trim()
          latexAnswers[stageIndex] = [l1, l2].filter(Boolean).join('\n')
        } else {
          latexAnswers[stageIndex] = ''
        }
      } else {
        if (useMathField) syncMathFieldToInput()
        studentInput = (inputEl?.value || '').trim()
        latexAnswers[stageIndex] = useMathField ? (inputEl?.dataset.latex || '').trim() : ''
      }

      let latexStr = (inputEl?.dataset.latex || '').trim()
      if (stage.multiInput) {
        const l1 = (inputEl1?.dataset.latex || '').trim()
        const l2 = (inputEl2?.dataset.latex || '').trim()
        latexStr = [l1, l2].filter(Boolean).join('\n')
      }
      let mfLive1 = stage.multiInput && mathfieldEl1?.getValue ? (mathfieldEl1.getValue('latex') || '').trim() : ''
      let mfLive2 = stage.multiInput && mathfieldEl2?.getValue ? (mathfieldEl2.getValue('latex') || '').trim() : ''
      let mfLiveSingle = !stage.multiInput && mathfieldEl?.getValue ? (mathfieldEl.getValue('latex') || '').trim() : ''
      let mfLive = stage.multiInput ? [mfLive1, mfLive2].filter(Boolean).join('\n') : mfLiveSingle
    // [1단계] 미지수: 수식 필드 최종 동기화 후 x 검사 (p4·p5 등 누락 방지)
      if (stage.type === 'text' && stage.id === 1 && useMathField) {
      if (stage.multiInput) syncMultiMathFieldToInputs()
      else syncMathFieldToInput()
      if (!stage.multiInput) {
        studentInput = (inputEl?.value || '').trim()
        latexStr = (inputEl?.dataset.latex || '').trim()
        latexAnswers[stageIndex] = latexStr
      } else {
        const a1 = (inputEl1?.value || '').trim()
        const a2 = (inputEl2?.value || '').trim()
        studentInput = [a1, a2].filter(Boolean).join('\n')
        const l1 = (inputEl1?.dataset.latex || '').trim()
        const l2 = (inputEl2?.dataset.latex || '').trim()
        latexStr = [l1, l2].filter(Boolean).join('\n')
        latexAnswers[stageIndex] = [l1, l2].filter(Boolean).join('\n')
      }
      mfLive1 = stage.multiInput && mathfieldEl1?.getValue ? (mathfieldEl1.getValue('latex') || '').trim() : ''
      mfLive2 = stage.multiInput && mathfieldEl2?.getValue ? (mathfieldEl2.getValue('latex') || '').trim() : ''
      mfLiveSingle = !stage.multiInput && mathfieldEl?.getValue ? (mathfieldEl.getValue('latex') || '').trim() : ''
      mfLive = stage.multiInput ? [mfLive1, mfLive2].filter(Boolean).join('\n') : mfLiveSingle
    }
    // [1단계] 미지수: 반드시 x(또는 X) 포함 — 모든 문제 공통
      if (stage.type === 'text' && stage.id === 1) {
      const combined = `${studentInput}\n${latexStr}\n${mfLive}`
      if (!answerContainsVariableX(combined)) {
        showFeedback("미지수를 나타낼 때 문자 'x'를 포함해 주세요. (예: x: …, … = x)", 'bad')
        return
      }
    }
    // [2단계] 방정식: 등호 포함
      if (stage.type === 'equation') {
      const combined = `${studentInput}\n${latexStr}\n${mfLive}`
      if (!combined.includes('=')) {
        showFeedback('일차방정식에 등호(=)를 포함하세요.', 'bad')
        return
      }
    }
    // [3단계] 방정식 풀기: 숫자 형태 권장
      if (stage.type === 'numeric' && stage.id === 3) {
      if (!Number.isFinite(parseFlexibleNumber(studentInput))) {
        showFeedback('숫자로 입력하세요', 'bad')
        return
      }
    }
      answers[stageIndex] = studentInput
      const gradedCurrentStage = scoreStage(stage, studentInput)
      scores[stageIndex] = gradedCurrentStage.score
      const stagePassPromise = reportStagePass(stage, gradedCurrentStage)

    // 단계별 즉시 피드백은 숨기고, 마지막 단계에서 한꺼번에 채점 결과를 보여줌
      feedbackEl.textContent = ''

      const isLast = stageIndex === stages.length - 1
      if (!isLast) {
        // 다음 단계 화면은 즉시 이동, 시트 전송은 백그라운드 처리
        stagePassPromise.catch((err) => console.warn('[Sheets] stage pass send failed', err))
        stageIndex += 1
        updateStepUI()
        return
      }

      // 마지막 단계는 기존처럼 전송 완료를 대기
      await stagePassPromise

    // 진단평가(5번 문제) 마지막 "결과 보기" 클릭 시 가장 먼저 강제 전송
      if (problemIdx === problems.length - 1) {
      const lastStepSendResult = await saveDataToSheets({
        nickname: getStudentNicknameFromHash() || '익명',
        userLevel: '결과 보기 버튼 클릭(최종 문제)',
        problemNumber: problemIdx + 1,
        stageNumber: stage.id,
        stageTitle: stage.title,
        score: getCurrentTotalScore(),
        completionDate: new Date().toISOString(),
      })
      if (!lastStepSendResult?.ok) {
        alert(`결과 보기 전송 실패: ${lastStepSendResult?.reason || 'unknown_error'}`)
        return
      }
    }

    // 문제 완료 시점에 한꺼번에 채점
      for (let i = 0; i < stages.length; i += 1) {
      const graded = scoreStage(stages[i], answers[i] || '')
      scores[i] = graded.score
    }

    // 문제 완료 결과 화면 표시(문제별)
      const total = scores.reduce((a, b) => a + b, 0)
      let grade = '하'
      let gradeMsg = '기초부터 다시 다져보자!'
      if (total >= 8) {
        grade = '상'
        gradeMsg = '잘하고 있어요! 다음 진단도 기대해도 좋아요.'
      } else if (total >= 5) {
        grade = '중'
        gradeMsg = '중간이에요. 실수를 줄이면 더 올라갈 수 있어요.'
      }

      const totalPoints = stages.reduce((acc, s) => acc + s.points, 0)
      const hasNextProblem = problemIdx < problems.length - 1
      app.innerHTML = `
    <div class="mm-shell" role="application" aria-label="math-master">
      <header class="mm-header">
        <div class="mm-brand">
          <div class="mm-logo" aria-hidden="true">=</div>
          <div class="mm-brand-text">
          <div class="mm-title-top">MAGIC MATH WORLD</div>
            <div class="mm-title-sub">MAGIC MATH ADVENTURE</div>
          </div>
        </div>
        <div class="mm-badge" id="mm-progress-badge">Lv. 진단 완료 ${total}/${totalPoints}</div>
      </header>

      <main class="mm-main">
        <section class="mm-result-card" aria-labelledby="mm-result-title">
          <h1 class="mm-result-title" id="mm-result-title"><span class="mm-result-problem-num">문제 ${problemIdx + 1}</span><span class="mm-result-score-phrase">당신의 점수: ${total}점</span></h1>
          <p class="mm-result-desc">${gradeMsg}</p>

          <div class="mm-total-score" role="status" aria-label="총점">
            총점: ${total}/${totalPoints}점 (10점 만점)
          </div>

          <div class="mm-score-grid" role="region" aria-label="단계별 결과">
            ${stages
              .map((s, idx) => {
                const isOk = scores[idx] === s.points
                const studentAns = (answers[idx] || '').toString().trim()
                return `
                  <div class="mm-step-result">
                    <div class="mm-score-row">
                      <div class="mm-score-step">${idx + 1}단계: ${escapeHtml(stages[idx].title)}</div>
                      <div class="mm-score-points">${scores[idx]}/${s.points}점</div>
                      <div class="mm-score-status ${isOk ? 'ok' : 'no'}">${isOk ? '통과' : '재확인'}</div>
                    </div>

                    <div class="mm-compare-block" aria-label="학생 답과 정답지">
                      <div class="mm-compare-line">
                        <span class="mm-compare-label">학생 답</span>
                        <span class="mm-compare-value">${formatStudentAnswerHtml(s, studentAns, idx)}</span>
                      </div>
                      <div class="mm-compare-line">
                        <span class="mm-compare-label">정답지</span>
                        <span class="mm-compare-value">${formatExpectedAnswerHtml(s)}</span>
                      </div>
                    </div>
                  </div>
                `
              })
              .join('')}
          </div>

          <div class="mm-result-actions ${hasNextProblem ? '' : 'mm-result-actions-final'}">
            ${
              hasNextProblem
                ? '<button type="button" class="mm-btn-primary mm-btn-w100" id="mm-next-problem">결과 저장 후 다음 문제로</button>'
                : '<button type="button" class="mm-btn-primary mm-btn-primary-right" id="mm-final-achievement">최종 성취 보기</button>'
            }
          </div>
        </section>
      </main>

      <footer class="mm-footer">
        <a class="mm-link" href="#" id="mm-home-link">홈으로</a>
      </footer>
    </div>
    `

      app.querySelector('#mm-next-problem')?.addEventListener('click', () => {
        renderLevelCheckPlaceholder(problemIdx + 1)
      })
      app.querySelector('#mm-final-achievement')?.addEventListener('click', () => {
        renderFinalAchievementTable()
      })
      app.querySelector('#mm-home-link')?.addEventListener('click', (e) => {
        e.preventDefault()
        location.hash = '#welcome'
      })
    } finally {
      isSubmittingStep = false
      if (submitBtnEl) submitBtnEl.disabled = false
    }
  })

  app.querySelector('#mm-prev-step')?.addEventListener('click', () => {
    if (stageIndex === 0) return
    stageIndex -= 1
    feedbackEl.textContent = ''
    updateStepUI()
  })
}

function renderRoute() {
  const hash = (location.hash || '').replace(/^#/, '')
  const routeName = hash.split('?')[0]
  if (routeName === 'level-check') {
    window.__mmAssessment = { answersByProblem: {}, scoresByProblem: {} }
    renderLevelCheckPlaceholder()
  }
  else renderWelcome()
}

window.addEventListener('hashchange', renderRoute)
renderRoute()
