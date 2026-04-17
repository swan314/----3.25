import { useEffect, useRef, useState } from 'react'
import magicMainIllustration from './assets/magic-main-illustration.png'

function decodeJwtPayload(token) {
  try {
    const base64Url = token.split('.')[1]
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
  const [teacherProfile, setTeacherProfile] = useState(null)
  const [teacherAuthError, setTeacherAuthError] = useState('')
  const googleBtnRef = useRef(null)

  const handleStudentStart = (event) => {
    event.preventDefault()
    const name = studentNickname.trim()
    if (!name) {
      window.alert('닉네임을 입력해 주세요.')
      return
    }

    // 기존에 구현된 진단평가/채점/레벨분석/캐릭터 결과 흐름으로 이동
    window.location.href = `/legacy.html#level-check?nickname=${encodeURIComponent(name)}`
  }

  useEffect(() => {
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

      googleBtnRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(googleBtnRef.current, {
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

            <div className="relative mx-auto w-full max-w-xl aspect-[7/5] overflow-hidden rounded-3xl border border-blue-300/70 shadow-2xl shadow-blue-400/35">
              <img src={magicMainIllustration} alt="마법천자문 메인 배경" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-black/20" />
              <div className="absolute bottom-0 left-0 right-0 h-[85px] bg-black" />
              <p className="absolute bottom-0 left-0 right-0 flex h-[85px] items-center justify-center px-3 text-center text-xl font-black tracking-wide text-yellow-300 [text-shadow:0_2px_4px_rgba(0,0,0,0.7)] sm:text-2xl lg:text-3xl">
                수식 마법으로 세상을 구하라!
              </p>
            </div>
          </div>

          <section className="mt-8 grid gap-5 lg:mt-10 lg:grid-cols-2">
            <article className="rounded-2xl border border-yellow-300 bg-white/85 p-5 shadow-lg shadow-yellow-400/20 sm:p-6">
              <h2 className="text-xl font-extrabold text-yellow-600">학생용 입장</h2>
              <p className="mt-2 text-sm text-slate-600">
                입장 후 기존 진단평가, 채점, 레벨 분석과 캐릭터 결과를 그대로 진행합니다.
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
                  className="w-full rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 px-4 py-3 text-base font-bold text-slate-900 shadow-lg shadow-yellow-500/30 transition hover:brightness-105 active:translate-y-px"
                >
                  모험 시작
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
