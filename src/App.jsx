import { useEffect, useRef, useState } from 'react'
import magicMainIllustration from './assets/magic-main-illustration.png'
import sonGokuImg from './assets/son-goku.png'
import shaoImg from './assets/shao.png'
import samjangImg from './assets/samjang.png'
import okdongjaImg from './assets/okdongja.png'
import TrainingMode from './TrainingMode'
import {
  MM_TRAINING_LAUNCH_KEY,
  createTrainingLaunchFromDiagnostic,
  getCharacterNameForTier,
} from './levelConfig'
import {
  computeResumeTargetAfterSheetCompletion,
  isTrainingCompletedSheetRecord,
} from './training/trainingResumeFromSheet'
import { fetchStudentLearningProgress } from './sheets'

function decodeJwtPayload(token) {
  try {
    if (typeof token !== 'string' || !token.includes('.')) return null
    const base64Url = token.split('.')[1]
    if (!base64Url) return null
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((ch) => `%${`00${ch.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join('')
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

export default function App() {
  const [studentNickname, setStudentNickname] = useState('')
  const [activeView, setActiveView] = useState('landing')
  const [trainingPlan, setTrainingPlan] = useState(null)
  const [isCheckingStudentProgress, setIsCheckingStudentProgress] = useState(false)
  const [teacherProfile, setTeacherProfile] = useState(null)
  const [teacherAuthError, setTeacherAuthError] = useState('')
  const googleBtnRef = useRef(null)
  const getLevelFromPlan = (plan) =>
    String(plan?.diagnosticRecord?.level || plan?.diagnosticTier || '하').trim() || '하'

  /** 진단 직후 세션(`diagnostic_final`)은 첫 방문 안내, 재접속(`student_resume`)은 복귀 안내 */
  const getIntroVariant = (plan) =>
    String(plan?.source || '').trim() === 'diagnostic_final' ? 'first' : 'return'

  const buildResumeTrainingPlan = (progress, nickname) => {
    const tierKey = String(progress.diagnosticTier || progress.diagnosticRecord?.level || '하').trim() || '하'
    return {
      ...createTrainingLaunchFromDiagnostic(tierKey, nickname),
      source: 'student_resume',
      diagnosticRecord: progress.diagnosticRecord || { level: tierKey },
      introVariant: 'return',
      trainingCompletedCount: progress.trainingCompletedCount ?? 0,
      latestTrainingRecord: progress.latestTrainingRecord ?? null,
    }
  }

  const handleStudentStart = async (e) => {
    e.preventDefault()
    console.log('[student-start] submit clicked', {
      nicknameRaw: studentNickname,
      activeView,
    })

    if (!studentNickname.trim()) {
      alert('닉네임을 입력해주세요!')
      return
    }

    const nickname = studentNickname.trim()
    const moveToDiagnostic = () => {
      const encodedNickname = encodeURIComponent(nickname)
      // 진단평가 첫 화면(환영): main.js에서 routeName !== 'level-check' 일 때 renderWelcome()
      window.location.assign(`/legacy.html#welcome?nickname=${encodedNickname}`)
    }

    setIsCheckingStudentProgress(true)

    try {
      console.log('[student-start] fetching progress', { nickname })
      const progress = await fetchStudentLearningProgress(nickname)
      console.log('[student-start] progress fetched', progress)
      if (!progress.hasDiagnosticResult) {
        moveToDiagnostic()
        return
      }

      const resumeBase = buildResumeTrainingPlan(progress, nickname)

      if (!progress.hasTrainingCompletion || !progress.latestTrainingRecord) {
        setTrainingPlan({
          ...resumeBase,
          resumeType: '본문제',
          resumeProblemNumber: 1,
        })
        setActiveView('diagnostic-intro')
        return
      }

      const latestTrainingRecord = progress.latestTrainingRecord
      console.log('[next-problem] latestTrainingRecord (sheet)', latestTrainingRecord)

      if (!isTrainingCompletedSheetRecord(latestTrainingRecord)) {
        console.warn('[next-problem] latest row is not 수련완료; starting from first 문제')
        setTrainingPlan({
          ...resumeBase,
          resumeType: '본문제',
          resumeProblemNumber: 1,
        })
        setActiveView('diagnostic-intro')
        return
      }

      const resumeFields = computeResumeTargetAfterSheetCompletion(latestTrainingRecord)
      console.log('[next-problem] resume after last 완료 기록만 반영:', resumeFields)

      setTrainingPlan({
        ...resumeBase,
        ...resumeFields,
      })
      setActiveView('diagnostic-intro')
      return
    } catch (error) {
      console.error('학생 기록 조회 실패', error)
      window.alert(
        '기록 조회에 실패했습니다. 네트워크/Apps Script 설정 확인 후 다시 시도해주세요.'
      )
    } finally {
      setIsCheckingStudentProgress(false)
    }
  }

  useEffect(() => {
    const rawLaunch = sessionStorage.getItem(MM_TRAINING_LAUNCH_KEY)
    if (rawLaunch) {
      try {
        const plan = JSON.parse(rawLaunch)
        if (plan?.stages?.length) {
          if (plan.nickname) setStudentNickname(String(plan.nickname))
          setTrainingPlan(plan)
          setActiveView('diagnostic-intro')
          sessionStorage.removeItem(MM_TRAINING_LAUNCH_KEY)
          return
        }
      } catch {
        sessionStorage.removeItem(MM_TRAINING_LAUNCH_KEY)
      }
    }

    const savedTeacher = sessionStorage.getItem('teacherProfile')
    if (savedTeacher) {
      try {
        const parsed = JSON.parse(savedTeacher)
        if (parsed?.email) {
          setTeacherProfile(parsed)
          setActiveView('teacher-dashboard')
        }
      } catch {
        sessionStorage.removeItem('teacherProfile')
      }
    }
  }, [])

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) {
      setTeacherAuthError('Google 로그인 설정이 필요합니다. (VITE_GOOGLE_CLIENT_ID)')
      return
    }
    if (!googleBtnRef.current || activeView !== 'landing') return

    const existingScript = document.querySelector('script[data-google-gsi="true"]')
    const initializeGoogle = () => {
      if (!window.google?.accounts?.id) return
      const buttonHost = googleBtnRef.current
      if (!buttonHost) return

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          const payload = decodeJwtPayload(response.credential)
          if (!payload) {
            setTeacherAuthError('구글 로그인 처리 중 오류가 발생했습니다.')
            return
          }
          setTeacherAuthError('')
          const nextProfile = {
            name: payload.name || 'Teacher',
            email: payload.email || '',
          }
          setTeacherProfile(nextProfile)
          sessionStorage.setItem('teacherProfile', JSON.stringify(nextProfile))
          setActiveView('teacher-dashboard')
        },
      })

      buttonHost.innerHTML = ''
      window.google.accounts.id.renderButton(buttonHost, {
        theme: 'filled_blue',
        size: 'large',
        shape: 'pill',
        width: 320,
        text: 'signin_with',
      })
    }

    if (existingScript) {
      initializeGoogle()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.googleGsi = 'true'
    script.onload = initializeGoogle
    script.onerror = () => {
      setTeacherAuthError('Google 로그인 스크립트를 불러오지 못했습니다.')
    }
    document.head.appendChild(script)
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'diagnostic-intro' || !trainingPlan) return
    const level = getLevelFromPlan(trainingPlan)
    console.log('[diagnostic-intro] level:', level)
  }, [activeView, trainingPlan])

  const handleTeacherDashboardEnter = () => {
    if (!teacherProfile) {
      window.alert('먼저 Google로 로그인해 주세요.')
      return
    }
    setActiveView('teacher-dashboard')
  }

  const handleTeacherLogout = () => {
    setTeacherProfile(null)
    sessionStorage.removeItem('teacherProfile')
    setActiveView('landing')
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-yellow-100 via-blue-100 to-yellow-50 text-slate-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.12),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(250,204,21,0.2),transparent_45%),radial-gradient(circle_at_40%_80%,rgba(37,99,235,0.1),transparent_42%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_center,rgba(59,130,246,0.22)_1.5px,transparent_1.5px),radial-gradient(circle_at_center,rgba(234,179,8,0.2)_1.5px,transparent_1.5px)] [background-position:0_0,28px_28px] [background-size:56px_56px]" />

      <main className="relative mx-auto flex w-full max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        {activeView === 'training' && (
          <TrainingMode
            nickname={studentNickname.trim() || '익명'}
            trainingPlan={trainingPlan}
            onExit={() => {
              setTrainingPlan(null)
              setActiveView('landing')
            }}
          />
        )}

        {activeView === 'diagnostic-intro' && trainingPlan && (
          <section className="mx-auto w-full max-w-3xl rounded-3xl border border-blue-200/80 bg-white/90 p-6 shadow-2xl shadow-blue-300/20 backdrop-blur-md sm:p-8">
            <div className="space-y-6 text-center">
              {getIntroVariant(trainingPlan) === 'first' ? (
                <h2 className="text-3xl font-black text-blue-950 sm:text-4xl">🎉 진단 완료!</h2>
              ) : (
                <div className="space-y-1">
                  <p className="text-2xl font-black text-blue-950 sm:text-3xl">다시 돌아왔군요!</p>
                  <p className="text-base font-semibold text-slate-600 sm:text-lg">수련을 이어가 볼까요?</p>
                </div>
              )}
              <div>
                <img
                  src={
                    {
                      최상: sonGokuImg,
                      상: shaoImg,
                      중: samjangImg,
                      하: okdongjaImg,
                    }[getLevelFromPlan(trainingPlan)] || magicMainIllustration
                  }
                  alt={`${getLevelFromPlan(trainingPlan)} 레벨 캐릭터`}
                  className="mx-auto h-48 w-48 rounded-2xl border border-blue-200 bg-blue-50 object-cover sm:h-56 sm:w-56"
                />
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-left">
                <p className="text-lg font-black text-blue-900 sm:text-xl">
                  {`${getCharacterNameForTier(getLevelFromPlan(trainingPlan))}(${getLevelFromPlan(trainingPlan)})`}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-700 sm:text-base">
                  {{
                    최상: '최고 수준입니다! 어떤 문제도 해결할 수 있습니다.',
                    상: '잘하고 있습니다! 조금만 더 노력하면 최고 단계입니다.',
                    중: '기본기를 잘 갖추었습니다. 연습을 통해 더 성장할 수 있어요.',
                    하: '지금부터 시작입니다! 차근차근 실력을 키워봅시다.',
                  }[getLevelFromPlan(trainingPlan)] ||
                    '지금부터 시작입니다! 차근차근 실력을 키워봅시다.'}
                </p>
              </div>
              {getIntroVariant(trainingPlan) === 'return' && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-800 sm:text-base">
                  <p className="font-bold">
                    현재까지 완료한 수련 문제: {Number(trainingPlan.trainingCompletedCount ?? 0)}개
                  </p>
                  {trainingPlan.latestTrainingRecord?.problem ? (
                    <p className="mt-1 text-slate-600">
                      최근 기록 문항: {String(trainingPlan.latestTrainingRecord.problem).trim()}
                    </p>
                  ) : null}
                </div>
              )}
              <p className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm font-bold leading-relaxed text-amber-900 shadow-sm sm:text-base">
                수련 문제를 해결하면 보상으로 숫자카드를 얻을 수 있습니다.
                <br />
                15개의 카드를 모두 모으면 당신은 방정식 마스터가 될 수 있습니다.
                <br />
                지금 바로 도전해보세요!
              </p>
              <button
                type="button"
                onClick={() => setActiveView('training')}
                className="rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 px-6 py-3 text-base font-black text-slate-900 shadow-lg shadow-yellow-500/30 transition hover:brightness-105 active:translate-y-px"
              >
                {getIntroVariant(trainingPlan) === 'first' ? '수련 시작하기' : '이어 수련하기'}
              </button>
            </div>
          </section>
        )}

        {activeView === 'landing' && (
          <section className="rounded-3xl border border-blue-200/80 bg-white/70 p-6 shadow-2xl shadow-blue-300/20 backdrop-blur-md sm:p-8 lg:p-10">
          <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-5">
              <span className="inline-flex rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30">
                MAGIC MATH WORLD
              </span>
              <h1 className="text-balance text-3xl font-black leading-tight text-blue-950 sm:text-4xl lg:text-5xl">
                마법천자문:
                <br />
                일차방정식의 호흡
              </h1>
              <p className="max-w-2xl text-base leading-relaxed text-slate-700 sm:text-lg">
                손오공과 함께 방정식 주문을 익히고, 문제를 풀며 성장하는 모험을 시작해 보세요.
                닉네임만 입력하면 바로 입장할 수 있어요.
              </p>
            </div>

            <div className="mx-auto flex w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-blue-300/70 shadow-2xl shadow-blue-400/35">
              <div className="relative aspect-[7/5] w-full overflow-hidden">
                <img
                  src={magicMainIllustration}
                  alt="마법천자문 메인 배경"
                  className="h-full w-full object-cover object-center"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-black/5 to-black/15" />
              </div>
              <div className="flex min-h-[85px] shrink-0 flex-col justify-center bg-black px-3 py-3 sm:min-h-[90px]">
                <p className="text-center text-xl font-black tracking-wide text-yellow-300 [text-shadow:0_2px_4px_rgba(0,0,0,0.7)] sm:text-2xl lg:text-3xl">
                  수식 마법으로 세상을 구하라!
                </p>
              </div>
            </div>
          </div>

          <section className="mt-8 grid gap-5 lg:mt-10 lg:grid-cols-2">
            <article className="rounded-2xl border border-yellow-300 bg-white/85 p-5 shadow-lg shadow-yellow-400/20 sm:p-6">
              <h2 className="text-xl font-extrabold text-yellow-600">학생용 입장</h2>
              <p className="mt-2 text-sm text-slate-600">
                닉네임을 입력하세요. 방정식 활용 수련을 시작합니다
              </p>
              <form className="mt-4 space-y-3" onSubmit={handleStudentStart}>
                <label className="block text-sm font-semibold text-slate-700" htmlFor="nickname">
                  닉네임
                </label>
                <input
                  id="nickname"
                  type="text"
                  value={studentNickname}
                  onChange={(event) => setStudentNickname(event.target.value)}
                  placeholder="예: 방정식탐험가"
                  className="w-full rounded-xl border border-yellow-300 bg-white px-4 py-3 text-base outline-none ring-yellow-300 transition focus:ring-2"
                />
                <button
                  type="submit"
                  disabled={isCheckingStudentProgress}
                  className="w-full rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 px-4 py-3 text-base font-bold text-slate-900 shadow-lg shadow-yellow-500/30 transition hover:brightness-105 active:translate-y-px"
                >
                  {isCheckingStudentProgress ? '학습 기록 확인 중...' : '모험 시작'}
                </button>
              </form>
            </article>

            <article className="rounded-2xl border border-blue-300 bg-white/85 p-5 shadow-lg shadow-blue-400/20 sm:p-6">
              <h2 className="text-xl font-extrabold text-blue-700">교사용 입장</h2>
              <p className="mt-2 text-sm text-slate-600">
                Google 로그인으로 선생님 인증 후 관리자 계정에 입장합니다.
              </p>
              <div className="mt-4 space-y-3">
                <p className="text-sm font-semibold text-slate-700">Google Teacher Sign-In</p>
                <div ref={googleBtnRef} className="min-h-11" />
                {teacherAuthError && <p className="text-sm font-semibold text-red-600">{teacherAuthError}</p>}
                {teacherProfile && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                    <p className="font-bold text-blue-800">{teacherProfile.name}</p>
                    <p className="text-blue-700">{teacherProfile.email}</p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleTeacherDashboardEnter}
                  disabled={!teacherProfile}
                  className="w-full rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-3 text-base font-bold text-white shadow-lg shadow-blue-500/35 transition hover:brightness-105 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                >
                  관리자 대시보드 입장
                </button>
                <p className="text-xs text-slate-500">교사 인증 후에만 대시보드 메뉴가 활성화됩니다.</p>
              </div>
            </article>
          </section>
          </section>
        )}

        {activeView === 'teacher-dashboard' && teacherProfile && (
          <section className="rounded-3xl border border-blue-200/80 bg-white/85 p-6 shadow-2xl shadow-blue-300/20 backdrop-blur-md sm:p-8 lg:p-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-blue-700">Teacher Account</p>
                <h2 className="text-2xl font-black text-blue-950 sm:text-3xl">관리자 대시보드</h2>
              </div>
              <button
                type="button"
                onClick={handleTeacherLogout}
                className="rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-50"
              >
                로그아웃
              </button>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[240px_1fr]">
              <aside className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
                <p className="text-xs font-semibold uppercase text-blue-600">Menu</p>
                <nav className="mt-3 space-y-2">
                  <button
                    type="button"
                    className="w-full rounded-lg bg-blue-600 px-3 py-2 text-left text-sm font-bold text-white"
                  >
                    대시보드
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700"
                    disabled
                  >
                    학생 데이터
                  </button>
                </nav>
              </aside>

              <section className="rounded-2xl border border-blue-200 bg-white p-5">
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-sm font-semibold text-slate-600">로그인한 교사</p>
                  <p className="mt-1 text-lg font-black text-blue-900">{teacherProfile.name}</p>
                  <p className="text-sm text-blue-700">{teacherProfile.email}</p>
                </div>
                <p className="mt-4 text-sm text-slate-600">
                  Google 로그인 인증이 완료되어 관리자 계정으로 입장했습니다. 다음 단계에서 학생 학습 데이터
                  조회/시각화를 연결할 수 있습니다.
                </p>
              </section>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
