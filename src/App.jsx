import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import magicMainIllustration from './assets/magic-main-illustration.png'
import sonGokuImg from './assets/son-goku.png'
import shaoImg from './assets/shao.png'
import samjangImg from './assets/samjang.png'
import okdongjaImg from './assets/okdongja.png'
import TrainingMode from './TrainingMode'
import {
  MM_TRAINING_LAUNCH_KEY,
  createTrainingLaunchFromDiagnostic,
  formatDiagnosticCharacterLabel,
  resolveCanonicalDiagnosticTier,
} from './levelConfig'
import { DEFAULT_CLASS_CODE, normalizeClassCode } from './classCode'
import { loadTrainingProblemCodesFromCsv } from './utils/dataLoader'
import { clearAllStudentLocalSession, readStoredLearner, writeStoredLearner } from './studentPersist'
import {
  buildProblemAnalysisAiPayload,
  createProblemAnalysisDraft,
  fetchProblemAnalysisWithFallback,
} from './admin/problemAnalysisAi'
import {
  computeAdminStudentSummary,
  enrichAdminRosterWithSummaries,
} from './admin/adminStudentSummary'
import {
  ADMIN_STUDENT_SUMMARY_COLUMNS,
  formatAdminStudentSummaryCells,
} from './admin/adminStudentSummaryDisplay'
import { AdminProblemStatsTable } from './components/AdminProblemStatsTable'
import { AdminTeacherClassCard } from './components/AdminTeacherClassCard'
import {
  AdminDiagnosticHistoryDetail,
  AdminTrainingHistoryDetail,
  adminHistoryCategoryLabel,
  isDiagnosticHistoryRecord,
} from './components/AdminStudentHistoryPanels'
import {
  createTeacherClass,
  deleteTeacherClass,
  updateTeacherClass,
  fetchAdminStudentLearningHistory,
  fetchClassInfo,
  fetchClassProblemLearningStats,
  fetchClassRoster,
  fetchStudentLearningProgress,
  fetchTeacherClasses,
  formatAdminSeoulSheetTimestamp,
  formatAdminHistoryNumericCell,
  formatAdminHistoryTableTimestamp,
  resolveClassCodeFromNicknameLookup,
  sheetStatusLabelForAdmin,
} from './sheets'
import {
  countCompletedProblemsForMathCards,
  applySheetProblemOutcomeLists,
  mergeTrainingProblemProgressMaps,
} from './training/trainingProblemProgress'
import { readStoredTrainingProblemProgress, writeStoredTrainingProblemProgress } from './studentPersist'

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

/** 관리자 학생 목록 레벨 필터 (문자열 레벨과 매칭) */
function adminLevelMatchesFilter(levelRaw, filterValue) {
  if (!filterValue || filterValue === 'all') return true
  const level = String(levelRaw || '').trim()
  switch (filterValue) {
    case 'top':
      return (
        level.includes('최상') ||
        level.includes('손오공') ||
        level.includes('방정') ||
        level.includes('대마법사')
      )
    case 'high':
      return (
        level.includes('샤오') ||
        level.includes('수식 현자') ||
        level.includes('수식현자') ||
        (level.includes('상') && !level.includes('최상'))
      )
    case 'mid':
      return (
        level.includes('삼장') ||
        level.includes('탐구') ||
        (level.includes('중') && !level.includes('최상'))
      )
    case 'low':
      return (
        level.includes('옥동자') ||
        level.includes('입문') ||
        level.includes('(하)') ||
        /^하$/.test(level)
      )
    default:
      return true
  }
}

export default function App() {
  const [studentNickname, setStudentNickname] = useState('')
  /** 확정된 클래스 코드(확인 화면 이후·저장·수련 연동용) */
  const [studentClassCode, setStudentClassCode] = useState('')
  /** 학생 입장: 닉네임 화면 → 나의 선생님(클래스) 화면 → 자동 재개 */
  const [studentFlowStep, setStudentFlowStep] = useState(
    /** @type {'nickname' | 'classCode'} */ ('nickname')
  )
  const [classCodeDraft, setClassCodeDraft] = useState('')
  /** 클래스 참여 직후 오른쪽 '나의 클래스' 패널에 표시 */
  const [joinedClassSnapshot, setJoinedClassSnapshot] = useState(null)
  const [isClassJoinBusy, setIsClassJoinBusy] = useState(false)
  const [activeView, setActiveView] = useState('landing')
  const [trainingPlan, setTrainingPlan] = useState(null)
  const [isCheckingStudentProgress, setIsCheckingStudentProgress] = useState(false)
  const [isNicknameLookupBusy, setIsNicknameLookupBusy] = useState(false)
  const [teacherProfile, setTeacherProfile] = useState(null)
  const [teacherAuthError, setTeacherAuthError] = useState('')
  const [adminClassFilter, setAdminClassFilter] = useState(DEFAULT_CLASS_CODE)
  const [adminRoster, setAdminRoster] = useState([])
  const [adminRosterLoading, setAdminRosterLoading] = useState(false)
  const [adminRosterError, setAdminRosterError] = useState('')
  /** 관리자 대시보드: 클래스 선택 → 학생 명단 */
  const [teacherDashStep, setTeacherDashStep] = useState(/** @type {'pickClass' | 'roster'} */ ('pickClass'))
  const [teacherClasses, setTeacherClasses] = useState([])
  const [teacherClassesLoading, setTeacherClassesLoading] = useState(false)
  const [teacherClassesError, setTeacherClassesError] = useState('')
  const [isCreateClassOpen, setIsCreateClassOpen] = useState(false)
  const [createClassName, setCreateClassName] = useState('')
  const [createClassCode, setCreateClassCode] = useState('')
  const [createClassError, setCreateClassError] = useState('')
  const [createClassNotice, setCreateClassNotice] = useState('')
  const [isCreateClassBusy, setIsCreateClassBusy] = useState(false)
  const [openClassMenuKey, setOpenClassMenuKey] = useState(/** @type {string | null} */ (null))
  const [renameClassTarget, setRenameClassTarget] = useState(/** @type {object | null} */ (null))
  const [renameClassName, setRenameClassName] = useState('')
  const [renameClassError, setRenameClassError] = useState('')
  const [isRenameClassBusy, setIsRenameClassBusy] = useState(false)
  const [adminRosterNicknameQuery, setAdminRosterNicknameQuery] = useState('')
  const [adminRosterLevelFilter, setAdminRosterLevelFilter] = useState(
    /** @type {'all' | 'top' | 'high' | 'mid' | 'low'} */ ('all'),
  )
  const [adminRosterStatusFilter, setAdminRosterStatusFilter] = useState(
    /** @type {'all' | 'diagnostic_done'} */ ('all'),
  )
  /** 문제별 학습 분석: 문제×유형 통계 행, 원시 집계용 records, 문제 드롭다운 후보 */
  const [adminProblemStatsRows, setAdminProblemStatsRows] = useState([])
  const [adminProblemStatsRecords, setAdminProblemStatsRecords] = useState([])
  const [adminProblemStatsProblemKeys, setAdminProblemStatsProblemKeys] = useState([])
  const [adminCsvTrainingProblems, setAdminCsvTrainingProblems] = useState([])
  const [adminProblemAnalysisSelect, setAdminProblemAnalysisSelect] = useState('')
  /** 문제별 분석 카드: Web App 성공 시 api, 실패·미구현 시 stats */
  const [adminProblemAnalysisUi, setAdminProblemAnalysisUi] = useState({
    loading: false,
    source: /** @type {null | 'api' | 'stats'} */ (null),
    sections: /** @type {null | ReturnType<typeof createProblemAnalysisDraft>} */ (null),
  })
  const [adminProblemStatsError, setAdminProblemStatsError] = useState('')
  const [adminPage, setAdminPage] = useState(/** @type {'dashboard' | 'students'} */ ('dashboard'))
  const [adminStudentDetail, setAdminStudentDetail] = useState(null)
  const [adminHistoryRecords, setAdminHistoryRecords] = useState([])
  const [adminHistoryCompletedProblems, setAdminHistoryCompletedProblems] = useState([])
  const [adminHistoryLoading, setAdminHistoryLoading] = useState(false)
  const [adminHistoryError, setAdminHistoryError] = useState('')
  const [adminHistoryView, setAdminHistoryView] = useState(/** @type {'list' | 'detail'} */ ('list'))
  const [adminSelectedHistoryRecord, setAdminSelectedHistoryRecord] = useState(null)
  const googleBtnRef = useRef(null)
  const getLevelFromPlan = (plan) =>
    resolveCanonicalDiagnosticTier(plan?.diagnosticRecord?.level || plan?.diagnosticTier || '하')

  /** 진단 직후 세션(`diagnostic_final`)은 첫 방문 안내, 재접속(`student_resume`)은 복귀 안내 */
  const getIntroVariant = (plan) =>
    String(plan?.source || '').trim() === 'diagnostic_final' ? 'first' : 'return'

  const buildResumeTrainingPlan = (progress, nickname, classCode) => {
    const tierKey = String(progress.diagnosticTier || progress.diagnosticRecord?.level || '하').trim() || '하'
    return {
      ...createTrainingLaunchFromDiagnostic(tierKey, nickname, classCode),
      source: 'student_resume',
      diagnosticRecord: progress.diagnosticRecord || { level: tierKey },
      introVariant: 'return',
      trainingCompletedCount: progress.trainingCompletedCount ?? 0,
      latestTrainingRecord: progress.latestTrainingRecord ?? null,
    }
  }

  const runProgressFromCredentials = useCallback(async (nickname, classCode, opts = {}) => {
    const nick = (nickname || '').toString().trim()
    const cc = normalizeClassCode(classCode)
    if (!nick) return

    const { prefetchedProgress } = opts

    const moveToDiagnostic = () => {
      const q = new URLSearchParams()
      q.set('nickname', nick)
      q.set('classCode', cc)
      window.location.assign(`/legacy.html#welcome?${q.toString()}`)
    }

    setIsCheckingStudentProgress(true)
    try {
      console.log('[student-progress] fetch after class confirm', { nickname: nick, classCode: cc })
      const progress =
        prefetchedProgress != null ? prefetchedProgress : await fetchStudentLearningProgress(nick, cc)
      if (!progress.hasDiagnosticResult) {
        setJoinedClassSnapshot(null)
        moveToDiagnostic()
        return
      }

      const resumeBase = buildResumeTrainingPlan(progress, nick, cc)
      const progressMap = applySheetProblemOutcomeLists(
        mergeTrainingProblemProgressMaps(
          readStoredTrainingProblemProgress(nick, cc),
          progress.trainingProblemProgressByCode || {},
        ),
        progress.completedProblems,
        progress.failedProblems,
      )
      writeStoredTrainingProblemProgress(nick, cc, progressMap)
      const trainingProgressMapByProblem = progress.trainingProgressMapByProblem || {}

      setTrainingPlan({
        ...resumeBase,
        classCode: cc,
        trainingProblemProgressByCode: progressMap,
        trainingProgressMapByProblem,
        completedProblems: progress.completedProblems ?? [],
        failedProblems: progress.failedProblems ?? [],
      })
      setJoinedClassSnapshot(null)
      setStudentFlowStep('nickname')
      setActiveView('diagnostic-intro')
    } catch (error) {
      console.error('학생 기록 조회 실패', error)
      window.alert(
        '기록 조회에 실패했습니다. 네트워크/Apps Script 설정 확인 후 다시 시도해주세요.'
      )
      setJoinedClassSnapshot(null)
      setStudentFlowStep(readStoredLearner() ? 'classCode' : 'nickname')
    } finally {
      setIsCheckingStudentProgress(false)
    }
  }, [])

  const handleNicknameStepSubmit = async (e) => {
    e.preventDefault()
    const nickname = studentNickname.trim()
    if (!nickname) {
      window.alert('닉네임을 입력해주세요.')
      return
    }
    setJoinedClassSnapshot(null)
    setIsNicknameLookupBusy(true)
    try {
      const resolved = await resolveClassCodeFromNicknameLookup(nickname)
      const foundClassCode =
        resolved.ok && !resolved.ambiguous && resolved.classCode ? resolved.classCode : null

      console.log('[entry] nickname:', nickname)
      if (!foundClassCode) {
        console.log('[entry] found classCode:', '')
        console.log('[entry] skip class join:', false)
        const stored = readStoredLearner()
        const nextDraft =
          classCodeDraft.trim() || studentClassCode.trim() || (stored?.classCode ?? '') || ''
        setClassCodeDraft(nextDraft)
        setStudentFlowStep('classCode')
        return
      }

      console.log('[entry] found classCode:', foundClassCode)
      setStudentClassCode(foundClassCode)
      setClassCodeDraft(foundClassCode)

      const progress = await fetchStudentLearningProgress(nickname, foundClassCode)
      const skipClassJoin = Boolean(progress?.hasDiagnosticResult)
      console.log('[entry] skip class join:', skipClassJoin)

      if (!progress?.hasDiagnosticResult) {
        writeStoredLearner(nickname, foundClassCode)
        setStudentFlowStep('classCode')
        return
      }

      writeStoredLearner(nickname, foundClassCode)
      await runProgressFromCredentials(nickname, foundClassCode, { prefetchedProgress: progress })
    } catch (err) {
      console.error('[entry] nickname re-entry flow', err)
      const stored = readStoredLearner()
      setClassCodeDraft(
        classCodeDraft.trim() || studentClassCode.trim() || (stored?.classCode ?? '') || ''
      )
      setStudentFlowStep('classCode')
    } finally {
      setIsNicknameLookupBusy(false)
    }
  }

  const handleClassJoinSubmit = async (e) => {
    e.preventDefault()
    const nick = studentNickname.trim()
    const raw = classCodeDraft.trim()
    if (!nick) {
      window.alert('닉네임이 없습니다. 처음으로 돌아가 주세요.')
      return
    }
    if (!raw) {
      window.alert('선생님이 알려준 클래스 코드를 입력해주세요.')
      return
    }
    const cc = normalizeClassCode(raw)
    setIsClassJoinBusy(true)
    try {
      const meta = await fetchClassInfo(cc)
      setStudentClassCode(meta.classCode)
      setJoinedClassSnapshot({
        classCode: meta.classCode,
        title: meta.title,
        subtitle: meta.subtitle || '',
        footnote: meta.footnote || '',
      })
      writeStoredLearner(nick, meta.classCode)
      await new Promise((r) => window.setTimeout(r, 420))
      await runProgressFromCredentials(nick, meta.classCode)
    } catch (err) {
      console.error('[class-join]', err)
      setJoinedClassSnapshot(null)
      window.alert('클래스 정보를 불러오지 못했습니다. 코드를 확인한 뒤 다시 시도해주세요.')
    } finally {
      setIsClassJoinBusy(false)
    }
  }

  const resetStudentLandingState = () => {
    setTrainingPlan(null)
    setStudentNickname('')
    setStudentClassCode('')
    setClassCodeDraft('')
    setJoinedClassSnapshot(null)
    setStudentFlowStep('nickname')
    setIsClassJoinBusy(false)
  }

  /** 나가기·다른 사용자: 저장 세션 삭제 후 닉네임 첫 화면부터 */
  const handleStudentExitFromFlow = () => {
    clearAllStudentLocalSession()
    resetStudentLandingState()
    setActiveView('landing')
  }

  const handleDifferentUser = () => {
    handleStudentExitFromFlow()
  }

  useEffect(() => {
    const rawLaunch = sessionStorage.getItem(MM_TRAINING_LAUNCH_KEY)
    if (rawLaunch) {
      try {
        const plan = JSON.parse(rawLaunch)
        if (plan?.stages?.length) {
          if (plan.nickname) setStudentNickname(String(plan.nickname))
          if (plan.classCode != null) setStudentClassCode(normalizeClassCode(plan.classCode))
          setTrainingPlan(plan)
          setActiveView('diagnostic-intro')
          sessionStorage.removeItem(MM_TRAINING_LAUNCH_KEY)
          return
        }
      } catch {
        sessionStorage.removeItem(MM_TRAINING_LAUNCH_KEY)
      }
    }

    const stored = readStoredLearner()
    if (stored?.nickname && stored?.classCode) {
      setStudentNickname(stored.nickname)
      setStudentClassCode(stored.classCode)
      setClassCodeDraft(stored.classCode)
      // 자동 조회/자동 화면 전환 없음 — 반드시 닉네임 단계부터 보이게 한 뒤 사용자가 "다음"으로 진행
      setStudentFlowStep('nickname')
      return
    }

    const savedTeacher = sessionStorage.getItem('teacherProfile')
    if (savedTeacher) {
      try {
        const parsed = JSON.parse(savedTeacher)
        if (parsed?.email) {
          setTeacherProfile(parsed)
          setTeacherDashStep('pickClass')
          setActiveView('teacher-dashboard')
        }
      } catch {
        sessionStorage.removeItem('teacherProfile')
      }
    }
  }, [runProgressFromCredentials])

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

      console.log(window.location.origin)

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
          setTeacherDashStep('pickClass')
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
  }, [activeView, studentFlowStep])

  const reloadTeacherClasses = useCallback(async () => {
    if (!teacherProfile?.email) return
    const loginEmail = (teacherProfile.email || '').trim()
    setTeacherClassesLoading(true)
    setTeacherClassesError('')
    try {
      const res = await fetchTeacherClasses(teacherProfile.email)
      const rows = Array.isArray(res.rows) ? res.rows : []
      const matchedClasses = Array.isArray(res.classes) ? res.classes : []
      console.log('[admin] login email:', loginEmail)
      console.log('[admin] classes rows:', rows)
      console.log('[admin] matched classes:', matchedClasses)
      if (!res.ok) {
        setTeacherClasses([])
        setTeacherClassesError(
          res.reason === 'missing_api_url'
            ? '클래스 목록을 불러올 수 없습니다. 관리자에게 문의해 주세요.'
            : res.message ||
                (res.reason === 'invalid_response'
                  ? '클래스 목록 응답 형식이 올바르지 않습니다. 관리자에게 문의해 주세요.'
                  : '클래스 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
        )
        return
      }
      setTeacherClasses(matchedClasses)
    } catch (e) {
      setTeacherClasses([])
      setTeacherClassesError(e?.message || '클래스 목록 조회 중 오류가 발생했습니다.')
    } finally {
      setTeacherClassesLoading(false)
    }
  }, [teacherProfile?.email, teacherProfile])

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
    setTeacherDashStep('pickClass')
    setAdminPage('dashboard')
    setActiveView('teacher-dashboard')
  }

  const handleTeacherLogout = () => {
    setTeacherProfile(null)
    sessionStorage.removeItem('teacherProfile')
    setAdminRoster([])
    setAdminRosterError('')
    setAdminProblemStatsRows([])
    setAdminProblemStatsRecords([])
    setAdminProblemStatsProblemKeys([])
    setAdminCsvTrainingProblems([])
    setAdminProblemAnalysisSelect('')
    setAdminProblemStatsError('')
    setTeacherClasses([])
    setTeacherClassesError('')
    setTeacherDashStep('pickClass')
    setAdminPage('dashboard')
    setStudentFlowStep('nickname')
    setActiveView('landing')
  }

  const handleTeacherPickClass = (row) => {
    const code = normalizeClassCode(row?.classCode)
    if (!code) return
    setAdminClassFilter(code)
    setAdminRoster([])
    setAdminRosterError('')
    setAdminProblemStatsRows([])
    setAdminProblemStatsRecords([])
    setAdminProblemStatsProblemKeys([])
    setAdminCsvTrainingProblems([])
    setAdminProblemAnalysisSelect('')
    setAdminProblemStatsError('')
    setAdminPage('dashboard')
    setTeacherDashStep('roster')
  }

  useEffect(() => {
    if (activeView !== 'teacher-dashboard' || !teacherProfile?.email) return
    if (teacherDashStep !== 'pickClass') return
    let cancelled = false
    ;(async () => {
      await reloadTeacherClasses()
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
  }, [activeView, teacherProfile?.email, teacherDashStep, reloadTeacherClasses])

  const handleCreateClassSubmit = async (e) => {
    e.preventDefault()
    if (!teacherProfile?.email) return
    const className = createClassName.trim()
    const classCode = normalizeClassCode(createClassCode)
    if (!className || !classCode) {
      setCreateClassError('클래스명과 클래스 코드를 입력해 주세요.')
      return
    }
    setIsCreateClassBusy(true)
    setCreateClassError('')
    setCreateClassNotice('')
    try {
      const res = await createTeacherClass(teacherProfile.email, classCode, className)
      if (!res.ok) {
        setCreateClassError(res.message || '클래스 생성에 실패했습니다.')
        return
      }
      if (res.duplicated) {
        setCreateClassNotice('이미 같은 클래스 코드가 등록되어 있습니다.')
      } else {
        setCreateClassNotice('클래스를 생성했습니다.')
      }
      await reloadTeacherClasses()
      const createdCode = normalizeClassCode(res?.class?.classCode || classCode)
      const createdName =
        String(res?.class?.className || '').trim() || String(res?.class?.displayName || '').trim() || className
      handleTeacherPickClass({
        classCode: createdCode,
        className: createdName,
        displayName: createdName,
      })
      setIsCreateClassOpen(false)
    } catch (err) {
      setCreateClassError(err?.message || '클래스 생성 중 오류가 발생했습니다.')
    } finally {
      setIsCreateClassBusy(false)
    }
  }

  const openRenameClassModal = (row) => {
    const code = normalizeClassCode(row?.classCode)
    const current = String(row?.displayName || row?.className || code).trim()
    setRenameClassTarget(row)
    setRenameClassName(current)
    setRenameClassError('')
    setOpenClassMenuKey(null)
  }

  const handleRenameClassSubmit = async (e) => {
    e.preventDefault()
    if (!teacherProfile?.email || !renameClassTarget) return
    const code = normalizeClassCode(renameClassTarget.classCode)
    const nextName = renameClassName.trim()
    if (!code || !nextName) {
      setRenameClassError('새 클래스 이름을 입력해 주세요.')
      return
    }
    setIsRenameClassBusy(true)
    setRenameClassError('')
    try {
      const res = await updateTeacherClass(teacherProfile.email, code, nextName)
      if (!res.ok) {
        setRenameClassError(res.message || '클래스 이름 변경에 실패했습니다.')
        return
      }
      await reloadTeacherClasses()
      setRenameClassTarget(null)
      setRenameClassName('')
    } catch (err) {
      setRenameClassError(err?.message || '클래스 이름 변경 중 오류가 발생했습니다.')
    } finally {
      setIsRenameClassBusy(false)
    }
  }

  const handleDeleteClass = async (row) => {
    if (!teacherProfile?.email) return
    const code = normalizeClassCode(row?.classCode)
    const name = String(row?.displayName || row?.className || code).trim()
    if (!code) return
    setOpenClassMenuKey(null)
    const confirmed = window.confirm(
      '정말 삭제하시겠습니까?\n\n삭제 후 학생 기록은 복구되지 않습니다.',
    )
    if (!confirmed) return
    const res = await deleteTeacherClass(teacherProfile.email, code)
    if (!res.ok) {
      window.alert(res.message || '클래스 삭제에 실패했습니다.')
      return
    }
    await reloadTeacherClasses()
    if (normalizeClassCode(adminClassFilter) === code) {
      setAdminClassFilter('')
      setTeacherDashStep('pickClass')
      setAdminRoster([])
      setAdminRosterError('')
      setAdminProblemStatsRows([])
      setAdminProblemStatsRecords([])
      setAdminProblemStatsProblemKeys([])
      setAdminCsvTrainingProblems([])
      setAdminProblemAnalysisSelect('')
      setAdminProblemStatsError('')
    }
  }

  const adminRosterStats = useMemo(() => {
    const list = Array.isArray(adminRoster) ? adminRoster : []
    let diagnosticDone = 0
    let trainingComplete = 0
    let inProgress = 0
    for (let i = 0; i < list.length; i++) {
      const row = list[i]
      if (row.hasDiagnosticResult === true) {
        diagnosticDone += 1
      }
      const st = String(row.latestStatus ?? row.status ?? row.lastStatus ?? '').trim()
      if (st === '수련완료') {
        trainingComplete += 1
      }
      if (row.hasDiagnosticResult === true && st !== '수련완료') {
        inProgress += 1
      }
    }
    return {
      total: list.length,
      diagnosticDone,
      trainingComplete,
      inProgress,
    }
  }, [adminRoster])

  const filteredAdminRoster = useMemo(() => {
    const q = adminRosterNicknameQuery.trim()
    const list = Array.isArray(adminRoster) ? adminRoster : []
    return list.filter((row) => {
      const nick = String(row.nickname ?? row.닉네임 ?? row.Nickname ?? row.name ?? row['이름'] ?? '').trim()
      if (q && !nick.includes(q)) return false

      const levelStr = String(row.level ?? row.diagnosticTier ?? '').trim()
      if (!adminLevelMatchesFilter(levelStr, adminRosterLevelFilter)) return false

      if (adminRosterStatusFilter === 'diagnostic_done' && row.hasDiagnosticResult !== true) {
        return false
      }

      return true
    })
  }, [adminRoster, adminRosterNicknameQuery, adminRosterLevelFilter, adminRosterStatusFilter])

  const adminMergedProblemOptions = useMemo(() => {
    const s = new Set()
    for (const p of adminCsvTrainingProblems) {
      const v = String(p || '').trim()
      if (v) s.add(v)
    }
    for (const p of adminProblemStatsProblemKeys) {
      const v = String(p || '').trim()
      if (v) s.add(v)
    }
    for (const row of adminProblemStatsRows) {
      const v = String(row?.problem ?? '').trim()
      if (v) s.add(v)
    }
    return [...s].sort((a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true }))
  }, [adminCsvTrainingProblems, adminProblemStatsProblemKeys, adminProblemStatsRows])

  const adminProblemAnalysisTableRows = useMemo(() => {
    const key = adminProblemAnalysisSelect.trim()
    if (!key) return []
    return adminProblemStatsRows.filter((r) => String(r?.problem ?? '').trim() === key)
  }, [adminProblemAnalysisSelect, adminProblemStatsRows])

  const adminProblemAnalysisAiPayload = useMemo(
    () =>
      buildProblemAnalysisAiPayload(
        normalizeClassCode(adminClassFilter),
        adminProblemAnalysisSelect,
        adminProblemAnalysisTableRows,
        adminProblemStatsRecords,
      ),
    [
      adminClassFilter,
      adminProblemAnalysisSelect,
      adminProblemAnalysisTableRows,
      adminProblemStatsRecords,
    ],
  )

  useEffect(() => {
    if (!adminProblemAnalysisAiPayload.problem) {
      setAdminProblemAnalysisUi({ loading: false, source: null, sections: null })
      return
    }
    let cancelled = false
    setAdminProblemAnalysisUi((prev) => ({ ...prev, loading: true }))
    ;(async () => {
      const out = await fetchProblemAnalysisWithFallback(adminProblemAnalysisAiPayload)
      if (cancelled) return
      setAdminProblemAnalysisUi({
        loading: false,
        source: out.source,
        sections: out.sections,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [adminProblemAnalysisAiPayload])

  const adminProblemAnalysisDraft =
    adminProblemAnalysisUi.sections ?? createProblemAnalysisDraft(adminProblemAnalysisAiPayload)

  const adminHasProblemTrainingRecords =
    adminProblemStatsRecords.length > 0 || adminProblemStatsRows.length > 0

  useEffect(() => {
    if (!adminMergedProblemOptions.length) return
    if (adminMergedProblemOptions.includes(adminProblemAnalysisSelect)) return
    setAdminProblemAnalysisSelect(adminMergedProblemOptions[0])
  }, [adminMergedProblemOptions, adminProblemAnalysisSelect])

  const handleAdminLoadRoster = async () => {
    setAdminStudentDetail(null)
    setAdminHistoryRecords([])
    setAdminHistoryCompletedProblems([])
    setAdminHistoryError('')
    setAdminHistoryLoading(false)
    setAdminHistoryView('list')
    setAdminSelectedHistoryRecord(null)
    const code = normalizeClassCode(adminClassFilter)
    setAdminRosterLoading(true)
    setAdminRosterError('')
    setAdminRoster([])
    setAdminProblemStatsRows([])
    setAdminProblemStatsRecords([])
    setAdminProblemStatsProblemKeys([])
    setAdminCsvTrainingProblems([])
    setAdminProblemAnalysisSelect('')
    setAdminProblemStatsError('')
    try {
      const res = await fetchClassRoster(code)
      if (!res.ok) {
        setAdminRosterError(
          res.reason === 'missing_api_url'
            ? '학생 목록을 불러올 수 없습니다. 관리자에게 문의해 주세요.'
            : res.message ||
                (res.reason === 'roster_api'
                  ? '학생 목록을 불러오지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.'
                  : '학생 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
        )
        return
      }
      const rosterRows = Array.isArray(res.rows) ? res.rows : []
      const enrichedRows = await enrichAdminRosterWithSummaries(rosterRows, code)
      setAdminRoster(enrichedRows)

      const [statsRes, csvProblems] = await Promise.all([
        fetchClassProblemLearningStats(code),
        loadTrainingProblemCodesFromCsv().catch(() => []),
      ])
      const csvList = Array.isArray(csvProblems) ? csvProblems : []
      setAdminCsvTrainingProblems(csvList)
      if (statsRes.ok) {
        const stats = Array.isArray(statsRes.stats) ? statsRes.stats : []
        const records = Array.isArray(statsRes.records) ? statsRes.records : []
        const apiProblems = Array.isArray(statsRes.problems) ? statsRes.problems : []
        const fromStats = [...new Set(stats.map((s) => String(s?.problem ?? '').trim()).filter(Boolean))]
        const problemKeys = apiProblems.length ? apiProblems : fromStats
        setAdminProblemStatsRows(stats)
        setAdminProblemStatsRecords(records)
        setAdminProblemStatsProblemKeys(problemKeys)
        const merged = new Set([...csvList, ...problemKeys, ...fromStats])
        const sorted = [...merged].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true }))
        const initial =
          sorted.find((pid) => stats.some((s) => String(s?.problem ?? '').trim() === pid)) || sorted[0] || ''
        setAdminProblemAnalysisSelect(initial)
        setAdminProblemStatsError('')
      } else {
        setAdminProblemStatsRows([])
        setAdminProblemStatsRecords([])
        setAdminProblemStatsProblemKeys([])
        setAdminProblemAnalysisSelect('')
        setAdminProblemStatsError(
          statsRes.reason === 'missing_api_url'
            ? ''
            : statsRes.message ||
                (statsRes.reason === 'problem_stats_api'
                  ? '문제별 분석을 불러오지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.'
                  : '문제별 분석을 불러오지 못했습니다.'),
        )
      }
    } catch (e) {
      setAdminRosterError(e?.message || '목록 조회 중 오류가 발생했습니다.')
    } finally {
      setAdminRosterLoading(false)
    }
  }

  const closeAdminStudentDetail = useCallback(() => {
    setAdminStudentDetail(null)
    setAdminHistoryRecords([])
    setAdminHistoryCompletedProblems([])
    setAdminHistoryError('')
    setAdminHistoryLoading(false)
    setAdminHistoryView('list')
    setAdminSelectedHistoryRecord(null)
  }, [])

  const backToAdminHistoryList = useCallback(() => {
    setAdminHistoryView('list')
    setAdminSelectedHistoryRecord(null)
  }, [])

  const selectAdminHistoryRecord = useCallback((rec) => {
    console.log('[admin history] selected record:', rec)
    setAdminSelectedHistoryRecord(rec)
    setAdminHistoryView('detail')
  }, [])

  const openAdminStudentDetail = useCallback(
    (row) => {
      if (!row) return
      setAdminStudentDetail(row)
      setAdminHistoryRecords([])
      setAdminHistoryCompletedProblems([])
      setAdminHistoryError('')
      setAdminHistoryLoading(true)
      setAdminHistoryView('list')
      setAdminSelectedHistoryRecord(null)
      const nick = String(row.nickname ?? row.닉네임 ?? row.Nickname ?? row.name ?? row['이름'] ?? '').trim()
      if (!nick) {
        setAdminHistoryLoading(false)
        setAdminHistoryError('닉네임이 없어 기록을 불러올 수 없습니다.')
        return
      }
      const cc = normalizeClassCode(adminClassFilter)
      fetchAdminStudentLearningHistory(nick, cc)
        .then((res) => {
          if (!res.ok) {
            setAdminHistoryError(res.message || '학습 기록을 불러오지 못했습니다.')
            setAdminHistoryRecords([])
            setAdminHistoryCompletedProblems([])
            return
          }
          setAdminHistoryRecords(Array.isArray(res.records) ? res.records : [])
          setAdminHistoryCompletedProblems(
            Array.isArray(res.completedProblems) ? res.completedProblems : [],
          )
        })
        .finally(() => setAdminHistoryLoading(false))
    },
    [adminClassFilter],
  )

  useEffect(() => {
    if (!adminStudentDetail) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (adminHistoryView === 'detail') {
        backToAdminHistoryList()
      } else {
        closeAdminStudentDetail()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adminStudentDetail, adminHistoryView, backToAdminHistoryList, closeAdminStudentDetail])

  useEffect(() => {
    if (adminHistoryView !== 'detail' || !adminSelectedHistoryRecord) return
    const r = adminSelectedHistoryRecord
    console.log('[admin detail] selected record:', r)
    console.log('[admin detail] steps:', {
      step1: r.step1,
      step2: r.step2,
      step3: r.step3,
      step4: r.step4,
      step5_1: r.step5_1,
      step5_2: r.step5_2,
      step5_3: r.step5_3,
      step6: r.step6,
    })
  }, [adminHistoryView, adminSelectedHistoryRecord])

  const adminStudentSummary = useMemo(() => {
    if (!adminStudentDetail) return null
    return computeAdminStudentSummary({
      records: adminHistoryRecords,
      rosterRow: adminStudentDetail,
      completedProblems: adminHistoryCompletedProblems,
    })
  }, [adminStudentDetail, adminHistoryRecords, adminHistoryCompletedProblems])

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-br from-yellow-100 via-blue-100 to-yellow-50 text-slate-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.12),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(250,204,21,0.2),transparent_45%),radial-gradient(circle_at_40%_80%,rgba(37,99,235,0.1),transparent_42%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_center,rgba(59,130,246,0.22)_1.5px,transparent_1.5px),radial-gradient(circle_at_center,rgba(234,179,8,0.2)_1.5px,transparent_1.5px)] [background-position:0_0,28px_28px] [background-size:56px_56px]" />

      <main
        className={`relative mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10 ${
          activeView === 'diagnostic-intro'
            ? 'flex min-h-[calc(100dvh-2rem)] flex-1 flex-col justify-center py-10 sm:py-12'
            : 'py-8 lg:py-12'
        }`}
      >
        {activeView === 'training' && (
          <TrainingMode
            nickname={studentNickname.trim() || '익명'}
            classCode={normalizeClassCode(trainingPlan?.classCode ?? studentClassCode)}
            trainingPlan={trainingPlan}
            onTrainingProgressChange={(map) => {
              setTrainingPlan((prev) =>
                prev ? { ...prev, trainingProblemProgressByCode: map } : prev,
              )
            }}
            onExit={handleStudentExitFromFlow}
          />
        )}

        {activeView === 'diagnostic-intro' && trainingPlan && (
          <section className="mx-auto w-full max-w-3xl rounded-3xl border border-violet-200/80 bg-white/90 p-5 shadow-2xl shadow-violet-200/25 backdrop-blur-md sm:p-7">
            <div className="space-y-4 text-center">
              {getIntroVariant(trainingPlan) === 'first' ? (
                <div className="space-y-1">
                  <h2 className="text-2xl font-black text-violet-950 sm:text-3xl">🎉 진단 완료!</h2>
                  <p className="text-sm font-semibold text-slate-600 sm:text-base">
                    이제 나에게 맞는 수련을 시작해 볼까요?
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xl font-black text-violet-950 sm:text-2xl">다시 돌아왔군요!</p>
                  <p className="text-sm font-semibold text-slate-600 sm:text-base">수련을 이어가 볼까요?</p>
                </div>
              )}
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
                className="mx-auto h-40 w-40 rounded-xl border border-blue-200 object-cover sm:h-44 sm:w-44"
              />
              <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3.5 text-left sm:p-4">
                <p className="text-base font-black text-violet-900 sm:text-lg">
                  {formatDiagnosticCharacterLabel(getLevelFromPlan(trainingPlan))}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-700 sm:text-[0.9375rem]">
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
                <p className="inline-flex rounded-full bg-violet-100 px-4 py-2 text-sm font-bold text-violet-900">
                  MATH-CARD{' '}
                  {countCompletedProblemsForMathCards(trainingPlan.trainingProblemProgressByCode)}장 / 15
                </p>
              )}
              <div className="rounded-lg border border-violet-100/90 bg-violet-50/40 px-3 py-2.5 text-left sm:text-center">
                <p className="text-sm font-medium leading-relaxed text-slate-800">
                  수련 문제를 해결하면 보상으로 숫자카드를 얻을 수 있어요.
                </p>
                <p className="mt-1 text-sm font-medium leading-relaxed text-slate-800/90">
                  15개의 카드를 모두 모으면 방정식 마스터에 한 걸음 더 가까워져요.
                </p>
                <p className="mt-1 text-sm font-medium leading-relaxed text-slate-800/90">
                  지금 바로 도전해보세요!
                </p>
              </div>
              <div className="flex flex-col items-stretch gap-2.5 pt-1 sm:flex-row sm:justify-center sm:gap-3">
                <button
                  type="button"
                  onClick={() => setActiveView('training')}
                  className="step-learning-cta-glow step-learning-cta-btn rounded-xl bg-violet-600 px-6 py-3 text-base font-bold text-white shadow-md shadow-violet-600/35 transition hover:bg-violet-700 active:translate-y-px sm:min-w-[200px]"
                >
                  {getIntroVariant(trainingPlan) === 'first' ? '수련 시작하기' : '수련하기'}
                </button>
                <button
                  type="button"
                  onClick={handleStudentExitFromFlow}
                  className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:shadow-md active:translate-y-px sm:min-w-[120px]"
                >
                  나가기
                </button>
              </div>
            </div>
          </section>
        )}

        {activeView === 'landing' && (
          <section className="rounded-3xl border border-blue-200/80 bg-white/70 p-6 shadow-2xl shadow-blue-300/20 backdrop-blur-md sm:p-8 lg:p-10">
            {studentFlowStep === 'nickname' && (
              <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-5">
                  <span className="inline-flex rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30">
                    MAGIC MATH WORLD
                  </span>
                  <h1 className="text-balance text-3xl font-black leading-tight text-blue-950 sm:text-4xl lg:text-5xl">
                    수학마법:
                    <br />
                    일차방정식의 호흡
                  </h1>
                  <p className="max-w-2xl text-base leading-relaxed text-slate-700 sm:text-lg">
                    수학마법의 주문(일차방정식)을 익히고, 문제를 풀며 성장하는 모험을 시작해 보세요.
                  </p>
                </div>

                <div className="mx-auto flex w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-blue-300/70 shadow-2xl shadow-blue-400/35">
                  <div className="relative aspect-[7/5] w-full overflow-hidden">
                    <img
                      src={magicMainIllustration}
                      alt="수학마법 메인 배경"
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
            )}

            <div className="mt-8">
              {studentFlowStep === 'nickname' && (
                <div className="mx-auto w-full max-w-lg rounded-2xl border border-yellow-300 bg-white/90 p-6 shadow-lg shadow-yellow-400/15">
                  <h2 className="text-xl font-extrabold text-yellow-600">학생용 입장</h2>
                  <form className="mt-4 space-y-3" onSubmit={handleNicknameStepSubmit}>
                    <p className="text-sm text-slate-600">모험에 사용할 닉네임을 입력하세요.</p>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="nickname">
                      닉네임
                    </label>
                    <input
                      id="nickname"
                      type="text"
                      value={studentNickname}
                      onChange={(event) => setStudentNickname(event.target.value)}
                      placeholder="예: 방정식탐험가"
                      autoComplete="username"
                      className="w-full rounded-xl border border-yellow-300 bg-white px-4 py-3 text-base outline-none ring-yellow-300 transition focus:ring-2"
                    />
                    <button
                      type="submit"
                      disabled={isCheckingStudentProgress || isNicknameLookupBusy}
                      className="w-full rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 px-4 py-3 text-base font-bold text-slate-900 shadow-lg shadow-yellow-500/30 transition hover:brightness-105 active:translate-y-px disabled:opacity-60"
                    >
                      {isNicknameLookupBusy ? '기록 확인 중…' : '다음'}
                    </button>
                    <button
                      type="button"
                      onClick={handleDifferentUser}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                    >
                      다른 사용자로 접속
                    </button>
                  </form>
                </div>
              )}

              {studentFlowStep === 'classCode' && (
                <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-lg sm:p-8">
                  <h2 className="text-2xl font-black text-blue-950 sm:text-3xl">나의 선생님</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
                    선생님이 알려준 클래스 코드를 입력하세요.
                  </p>
                  <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                    지금 입장 중인 닉네임:{' '}
                    <span className="font-bold text-slate-800">{studentNickname.trim() || '—'}</span>
                  </p>

                  <div className="mt-8 grid gap-8 border-t border-slate-200/80 pt-8 lg:grid-cols-2 lg:gap-10">
                    <div>
                      <h3 className="text-lg font-extrabold text-blue-900">클래스 참여</h3>
                      <form className="mt-4 space-y-3" onSubmit={handleClassJoinSubmit}>
                        <label className="block text-sm font-semibold text-slate-700" htmlFor="classCodeDraft">
                          클래스 코드
                        </label>
                        <input
                          id="classCodeDraft"
                          type="text"
                          value={classCodeDraft}
                          onChange={(event) => setClassCodeDraft(event.target.value)}
                          placeholder="예: MATH-101"
                          autoComplete="off"
                          spellCheck={false}
                          className="w-full rounded-xl border border-blue-200 bg-white px-4 py-3 font-mono text-base outline-none ring-blue-200 transition focus:ring-2"
                        />
                        <button
                          type="submit"
                          disabled={isClassJoinBusy || isCheckingStudentProgress}
                          className="w-full rounded-xl bg-blue-600 px-4 py-3 text-base font-bold text-white shadow-md shadow-blue-500/25 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          {isClassJoinBusy || isCheckingStudentProgress
                            ? joinedClassSnapshot
                              ? '학습 기록 확인 중…'
                              : '처리 중…'
                            : '클래스 참여'}
                        </button>
                      </form>
                      <button
                        type="button"
                        onClick={handleDifferentUser}
                        className="mt-4 text-sm font-bold text-blue-700 underline-offset-2 hover:underline"
                      >
                        다른 사용자로 접속
                      </button>
                    </div>

                    <div className="lg:border-l lg:border-slate-200 lg:pl-10">
                      <h3 className="text-lg font-extrabold text-blue-900">나의 클래스</h3>
                      {!joinedClassSnapshot ? (
                        <p className="mt-4 text-sm leading-relaxed text-slate-500">
                          아직 참여한 클래스가 없습니다. 왼쪽에서 클래스 코드를 입력한 뒤 &quot;클래스 참여&quot;를
                          눌러 주세요.
                        </p>
                      ) : (
                        <div className="mt-4 space-y-3 rounded-2xl border border-amber-200/90 bg-amber-50/90 p-4 sm:p-5">
                          <p className="text-xs font-bold uppercase tracking-wide text-amber-800">나의 클래스</p>
                          <p className="text-lg font-black leading-snug text-amber-950 sm:text-xl">
                            {joinedClassSnapshot.title}
                          </p>
                          {joinedClassSnapshot.subtitle ? (
                            <p className="text-sm font-semibold text-amber-900/95">{joinedClassSnapshot.subtitle}</p>
                          ) : null}
                          {joinedClassSnapshot.footnote ? (
                            <p className="text-sm text-amber-900/85">{joinedClassSnapshot.footnote}</p>
                          ) : null}
                          <p className="border-t border-amber-200/80 pt-3 text-sm font-bold text-slate-800">
                            나의 클래스에 참여했습니다.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {studentFlowStep !== 'classCode' && (
              <section className="mt-10 rounded-2xl border border-blue-300 bg-white/85 p-5 shadow-lg shadow-blue-400/20 sm:p-6 lg:mt-12">
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
              </section>
            )}
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

            <div
              className={`mt-5 grid gap-5 ${teacherDashStep === 'pickClass' ? '' : 'lg:grid-cols-[240px_1fr]'}`}
            >
              {teacherDashStep === 'roster' ? (
                <aside className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
                  <p className="text-xs font-semibold uppercase text-blue-600">Menu</p>
                  <nav className="mt-3 space-y-2">
                    <button
                      type="button"
                      onClick={() => setAdminPage('dashboard')}
                      className={
                        adminPage === 'dashboard'
                          ? 'w-full rounded-lg bg-blue-600 px-3 py-2 text-left text-sm font-bold text-white shadow-sm'
                          : 'w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-blue-50/90'
                      }
                    >
                      문제 분석
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdminPage('students')}
                      className={
                        adminPage === 'students'
                          ? 'w-full rounded-lg bg-blue-600 px-3 py-2 text-left text-sm font-bold text-white shadow-sm'
                          : 'w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-blue-50/90'
                      }
                    >
                      학생 데이터
                    </button>
                  </nav>
                </aside>
              ) : null}

              <section className="rounded-2xl border border-blue-200 bg-white p-5">
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-sm font-semibold text-slate-600">로그인한 교사</p>
                  <p className="mt-1 text-lg font-black text-blue-900">{teacherProfile.name}</p>
                  <p className="text-sm text-blue-700">{teacherProfile.email}</p>
                </div>

                {teacherDashStep === 'pickClass' ? (
                  <div className="mt-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-lg font-black text-blue-950">클래스 선택</h3>
                      <button
                        type="button"
                        onClick={() => {
                          setCreateClassName('')
                          setCreateClassCode('')
                          setCreateClassError('')
                          setCreateClassNotice('')
                          setIsCreateClassOpen(true)
                        }}
                        className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 transition hover:bg-blue-50"
                      >
                        클래스 생성
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      본인 계정에 연결된 클래스만 표시됩니다. 목록이 비어 있으면 관리자에게 클래스 등록을 요청해 주세요.
                    </p>
                    {teacherClassesLoading ? (
                      <p className="mt-6 text-sm font-semibold text-slate-600">클래스 목록을 불러오는 중…</p>
                    ) : null}
                    {teacherClassesError ? (
                      <p className="mt-4 text-sm font-semibold text-red-600">{teacherClassesError}</p>
                    ) : null}
                    {!teacherClassesLoading && !teacherClassesError && teacherClasses.length === 0 ? (
                      <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-bold text-amber-900">
                        클래스를 먼저 생성해주세요
                      </p>
                    ) : null}
                    {!teacherClassesLoading && teacherClasses.length > 0 ? (
                      <ul className="mt-4 flex flex-col gap-2">
                        {teacherClasses.map((row, idx) => {
                          const code = normalizeClassCode(row.classCode)
                          const menuKey = `${code}-${idx}`
                          return (
                            <li key={menuKey}>
                              <AdminTeacherClassCard
                                row={row}
                                menuOpen={openClassMenuKey === menuKey}
                                onMenuToggle={() =>
                                  setOpenClassMenuKey((prev) => (prev === menuKey ? null : menuKey))
                                }
                                onMenuClose={() => setOpenClassMenuKey(null)}
                                onPick={() => handleTeacherPickClass(row)}
                                onRename={() => openRenameClassModal(row)}
                                onDelete={() => handleDeleteClass(row)}
                              />
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/90 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        {adminPage === 'dashboard' ? (
                          <>
                            <h3 className="text-lg font-black text-slate-900 sm:text-xl">클래스 학습 현황</h3>
                            <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-600 sm:text-sm">
                              선택한 클래스의 전체 학습 현황과 문제별 분석 결과를 확인할 수 있습니다.
                            </p>
                          </>
                        ) : (
                          <p className="text-sm font-bold text-slate-800">클래스별 학생 데이터</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          closeAdminStudentDetail()
                          setTeacherDashStep('pickClass')
                          setAdminRoster([])
                          setAdminRosterError('')
                          setAdminProblemStatsRows([])
                          setAdminProblemStatsRecords([])
                          setAdminProblemStatsProblemKeys([])
                          setAdminCsvTrainingProblems([])
                          setAdminProblemAnalysisSelect('')
                          setAdminProblemStatsError('')
                          setAdminRosterNicknameQuery('')
                          setAdminRosterLevelFilter('all')
                          setAdminRosterStatusFilter('all')
                          setAdminPage('dashboard')
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        ← 클래스 선택
                      </button>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="min-w-0 flex-1">
                        <label className="text-xs font-semibold text-slate-600" htmlFor="admin-class-filter">
                          필터 클래스 코드
                        </label>
                        <input
                          id="admin-class-filter"
                          type="text"
                          value={adminClassFilter}
                          onChange={(e) => setAdminClassFilter(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none ring-blue-200 focus:ring-2"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleAdminLoadRoster}
                        disabled={adminRosterLoading}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {adminRosterLoading ? '불러오는 중…' : '목록 불러오기'}
                      </button>
                    </div>
                    {adminRosterError ? (
                      <p className="mt-2 text-sm font-semibold text-red-600">{adminRosterError}</p>
                    ) : null}
                    {adminRoster.length > 0 && adminPage === 'dashboard' ? (
                      <>
                        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                          <div className="rounded-2xl border border-blue-200/90 bg-white px-4 py-3 shadow-sm shadow-blue-500/5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">전체 학생 수</p>
                            <p className="mt-1 text-2xl font-black tabular-nums text-blue-950">{adminRosterStats.total}</p>
                          </div>
                          <div className="rounded-2xl border border-emerald-200/90 bg-white px-4 py-3 shadow-sm shadow-emerald-500/5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">진단 완료</p>
                            <p className="mt-1 text-2xl font-black tabular-nums text-emerald-900">{adminRosterStats.diagnosticDone}</p>
                          </div>
                          <div className="rounded-2xl border border-amber-200/90 bg-white px-4 py-3 shadow-sm shadow-amber-500/5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">수련 진행 중</p>
                            <p className="mt-1 text-2xl font-black tabular-nums text-amber-950">{adminRosterStats.inProgress}</p>
                          </div>
                          <div className="rounded-2xl border border-indigo-200/90 bg-white px-4 py-3 shadow-sm shadow-indigo-500/5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">수련 완료</p>
                            <p className="mt-1 text-2xl font-black tabular-nums text-indigo-950">{adminRosterStats.trainingComplete}</p>
                          </div>
                        </div>

                        <section
                          className="mt-6 rounded-2xl border border-indigo-200/70 bg-gradient-to-b from-indigo-50/40 to-white px-4 py-4 shadow-sm sm:px-5 sm:py-5"
                          aria-labelledby="admin-problem-stats-heading"
                        >
                          <h3 id="admin-problem-stats-heading" className="text-base font-black text-indigo-950 sm:text-lg">
                            문제별 학습 분석
                          </h3>
                          <p className="mt-1 text-xs text-slate-600">
                            선택한 문제를 학습한 학생들의 결과를 유형별로 분석합니다. 본문제, 유사문제1, 유사문제2의 평균 점수와
                            실패율을 확인할 수 있습니다.
                          </p>
                          {adminProblemStatsError ? (
                            <p className="mt-2 text-sm font-semibold text-amber-700">{adminProblemStatsError}</p>
                          ) : null}
                          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                            <div className="min-w-0 sm:max-w-xs sm:flex-1">
                              <label
                                className="block text-xs font-semibold text-slate-600"
                                htmlFor="admin-problem-analysis-select"
                              >
                                분석할 문제
                              </label>
                              <select
                                id="admin-problem-analysis-select"
                                value={adminProblemAnalysisSelect}
                                onChange={(e) => setAdminProblemAnalysisSelect(e.target.value)}
                                disabled={adminRosterLoading || adminMergedProblemOptions.length === 0}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none ring-indigo-200 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {adminMergedProblemOptions.length === 0 ? (
                                  <option value="">문제 목록 없음</option>
                                ) : null}
                                {adminMergedProblemOptions.map((pid) => (
                                  <option key={pid} value={pid}>
                                    {pid}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="mt-3">
                            <AdminProblemStatsTable
                              selectedProblem={adminProblemAnalysisSelect}
                              rows={adminProblemAnalysisTableRows}
                              hasAnyTrainingRecords={adminHasProblemTrainingRecords}
                            />
                          </div>

                          <div className="mt-5 rounded-2xl border border-violet-200/80 bg-white px-4 py-4 shadow-sm sm:px-5">
                            <h4 className="text-sm font-black text-violet-950">AI 분석</h4>
                            <p className="mt-1 text-xs text-slate-600">
                              선택한 문제가 바뀌면 Web App(VITE_API_URL)으로 분석을 요청합니다. Apps Script에서 처리하면 AI
                              요약이 표시되고, 실패·미연동 시 통계 기반 요약으로 대체됩니다.
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {adminProblemAnalysisUi.loading ? (
                                <p className="text-xs font-semibold text-violet-700">분석 요청 중…</p>
                              ) : adminProblemAnalysisUi.source === 'api' ? (
                                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                                  AI 응답
                                </span>
                              ) : adminProblemAnalysisUi.source === 'stats' ? (
                                <span className="rounded-full bg-slate-200/90 px-2.5 py-1 text-xs font-bold text-slate-700">
                                  통계 요약
                                </span>
                              ) : null}
                            </div>
                            <div
                              className="mt-4 rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-3"
                              aria-live="polite"
                            >
                              <h5 className="text-sm font-bold text-violet-950">문제별 AI 분석 결과</h5>
                              <p className="mt-2 text-sm leading-relaxed text-slate-700">
                                선택한 문제의 학습 데이터를 바탕으로 어려움이 나타난 지점과 지도 방향을 제안합니다.
                              </p>
                              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                                <section className="rounded-lg border border-violet-200/80 bg-white px-3 py-3">
                                  <h6 className="text-sm font-bold text-violet-950">1. 학습 경향 분석</h6>
                                  <p className="mt-1 text-xs leading-relaxed text-slate-700">
                                    {adminProblemAnalysisDraft.learningTrend}
                                  </p>
                                </section>
                                <section className="rounded-lg border border-violet-200/80 bg-white px-3 py-3">
                                  <h6 className="text-sm font-bold text-violet-950">2. 주요 어려움</h6>
                                  <p className="mt-1 text-xs leading-relaxed text-slate-700">
                                    {adminProblemAnalysisDraft.majorDifficulty}
                                  </p>
                                </section>
                                <section className="rounded-lg border border-violet-200/80 bg-white px-3 py-3">
                                  <h6 className="text-sm font-bold text-violet-950">3. 오개념 추정</h6>
                                  <p className="mt-1 text-xs leading-relaxed text-slate-700">
                                    {adminProblemAnalysisDraft.misconception}
                                  </p>
                                </section>
                                <section className="rounded-lg border border-violet-200/80 bg-white px-3 py-3">
                                  <h6 className="text-sm font-bold text-violet-950">4. 지도 방향</h6>
                                  <p className="mt-1 text-xs leading-relaxed text-slate-700">
                                    {adminProblemAnalysisDraft.teachingGuide}
                                  </p>
                                </section>
                                <section className="rounded-lg border border-violet-200/80 bg-white px-3 py-3 lg:col-span-2">
                                  <h6 className="text-sm font-bold text-violet-950">5. 추천 활동</h6>
                                  <p className="mt-1 text-xs leading-relaxed text-slate-700">
                                    {adminProblemAnalysisDraft.recommendedActivities}
                                  </p>
                                </section>
                              </div>
                            </div>
                          </div>
                        </section>
                      </>
                    ) : null}

                    {adminPage === 'students' ? (
                      <div className="mt-5 space-y-4">
                        <div>
                          <h3 className="text-xl font-black text-slate-900">학생 데이터</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            선택한 클래스의 학생별 진단 결과와 수련 이력을 확인할 수 있습니다.
                          </p>
                        </div>
                        {adminRoster.length > 0 ? (
                          <>
                            <div className="mt-2 flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white/90 px-4 py-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-end">
                              <div className="min-w-0 flex-1 sm:min-w-[12rem]">
                                <label className="block text-xs font-semibold text-slate-600" htmlFor="admin-roster-search">
                                  닉네임 검색
                                </label>
                                <input
                                  id="admin-roster-search"
                                  type="search"
                                  value={adminRosterNicknameQuery}
                                  onChange={(e) => setAdminRosterNicknameQuery(e.target.value)}
                                  placeholder="일부만 입력해도 검색"
                                  autoComplete="off"
                                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-200 transition focus:ring-2"
                                />
                              </div>
                              <div className="w-full sm:w-auto sm:min-w-[11rem]">
                                <label className="block text-xs font-semibold text-slate-600" htmlFor="admin-roster-level">
                                  레벨
                                </label>
                                <select
                                  id="admin-roster-level"
                                  value={adminRosterLevelFilter}
                                  onChange={(e) =>
                                    setAdminRosterLevelFilter(
                                      /** @type {'all' | 'top' | 'high' | 'mid' | 'low'} */ (e.target.value),
                                    )
                                  }
                                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-200 focus:ring-2 sm:w-full"
                                >
                                  <option value="all">전체</option>
                                  <option value="top">손오공(최상)</option>
                                  <option value="high">샤오(상)</option>
                                  <option value="mid">삼장(중)</option>
                                  <option value="low">옥동자(하)</option>
                                </select>
                              </div>
                              <div className="w-full sm:w-auto sm:min-w-[9rem]">
                                <label className="block text-xs font-semibold text-slate-600" htmlFor="admin-roster-status">
                                  상태
                                </label>
                                <select
                                  id="admin-roster-status"
                                  value={adminRosterStatusFilter}
                                  onChange={(e) =>
                                    setAdminRosterStatusFilter(
                                      /** @type {'all' | 'diagnostic_done'} */ (e.target.value),
                                    )
                                  }
                                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-200 focus:ring-2 sm:w-full"
                                >
                                  <option value="all">전체</option>
                                  <option value="diagnostic_done">진단완료</option>
                                </select>
                              </div>
                            </div>
                            <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200 bg-white">
                              <table className="w-full min-w-[72rem] border-collapse text-left text-sm">
                                <thead className="sticky top-0 z-[1] bg-slate-100 text-xs font-bold uppercase text-slate-600">
                                  <tr>
                                    {ADMIN_STUDENT_SUMMARY_COLUMNS.map((col) => (
                                      <th
                                        key={col.key}
                                        className={`border-b border-slate-200 px-2 py-2 ${
                                          col.key === 'lastActivity' ? 'whitespace-nowrap' : ''
                                        }`}
                                      >
                                        {col.label}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredAdminRoster.length === 0 ? (
                                    <tr>
                                      <td
                                        colSpan={ADMIN_STUDENT_SUMMARY_COLUMNS.length}
                                        className="border-b border-slate-100 px-4 py-10 text-center text-sm font-semibold text-slate-500"
                                      >
                                        조건에 맞는 학생이 없습니다.
                                      </td>
                                    </tr>
                                  ) : null}
                                  {filteredAdminRoster.map((row, idx) => {
                                    const cells = formatAdminStudentSummaryCells(row)
                                    const nick = cells.nickname
                                    return (
                                      <tr
                                        key={`${String(nick)}-f-${idx}`}
                                        role="button"
                                        tabIndex={0}
                                        title="클릭하여 상세 보기"
                                        className="odd:bg-white even:bg-slate-50/80 cursor-pointer transition hover:bg-blue-50/80 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-300"
                                        onClick={() => openAdminStudentDetail(row)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault()
                                            openAdminStudentDetail(row)
                                          }
                                        }}
                                      >
                                        {ADMIN_STUDENT_SUMMARY_COLUMNS.map((col) => (
                                          <td
                                            key={col.key}
                                            className={`border-b border-slate-100 px-2 py-2 ${
                                              col.key === 'nickname'
                                                ? 'font-medium text-slate-900'
                                                : col.key === 'lastActivity'
                                                  ? 'whitespace-nowrap text-xs text-slate-600'
                                                  : col.key === 'diagnosticScore' ||
                                                      col.key.endsWith('Count')
                                                    ? 'tabular-nums text-slate-800'
                                                    : 'text-slate-800'
                                            }`}
                                          >
                                            {cells[col.key]}
                                          </td>
                                        ))}
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </>
                        ) : !adminRosterLoading && !adminRosterError ? (
                          <p className="text-sm text-slate-500">
                            위에서 클래스 코드를 확인한 뒤 &quot;목록 불러오기&quot;를 누르면 학생 목록이 표시됩니다.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {!adminRosterLoading && !adminRosterError && adminRoster.length === 0 && adminPage === 'dashboard' ? (
                      <p className="mt-3 text-sm text-slate-500">
                        위에서 클래스 코드를 확인한 뒤 &quot;목록 불러오기&quot;를 누르면 대시보드 요약과 문제별 분석이 표시됩니다.
                      </p>
                    ) : null}
                  </div>
                )}
              </section>
            </div>
          </section>
        )}
      </main>

      {adminStudentDetail ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/45 backdrop-blur-[1px]"
            aria-label="상세 닫기"
            onClick={closeAdminStudentDetail}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-student-detail-title"
            className="relative z-[91] flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-2xl shadow-blue-900/15"
          >
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-blue-50/80 px-5 py-4">
              <div className="min-w-0 flex-1">
                {adminHistoryView === 'detail' ? (
                  <button
                    type="button"
                    onClick={backToAdminHistoryList}
                    className="mb-2 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-800 transition hover:bg-blue-50"
                  >
                    ← 기록 목록
                  </button>
                ) : null}
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  {adminHistoryView === 'detail' ? '기록 상세' : '학생 상세'}
                </p>
                <h2 id="admin-student-detail-title" className="mt-0.5 text-xl font-black text-blue-950">
                  {String(
                    adminStudentDetail.nickname ??
                      adminStudentDetail.닉네임 ??
                      adminStudentDetail.name ??
                      '—',
                  )}
                </h2>
                <p className="mt-1 font-mono text-xs text-slate-600">
                  클래스 {normalizeClassCode(adminClassFilter)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeAdminStudentDetail}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                닫기
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {adminHistoryView === 'detail' && adminSelectedHistoryRecord ? (
                isDiagnosticHistoryRecord(adminSelectedHistoryRecord) ? (
                  <AdminDiagnosticHistoryDetail record={adminSelectedHistoryRecord} />
                ) : (
                  <AdminTrainingHistoryDetail record={adminSelectedHistoryRecord} />
                )
              ) : (
                (() => {
                  const summary = adminStudentSummary
                  const pending = adminHistoryLoading
                  const cells = formatAdminStudentSummaryCells(
                    summary || {
                      nickname: adminStudentDetail?.nickname,
                      level: adminStudentDetail?.level,
                      diag_score: adminStudentDetail?.diag_score,
                      ...adminStudentDetail,
                    },
                    { pending },
                  )
                  return (
                    <div className="space-y-6">
                      <section className="rounded-xl border border-slate-200 bg-slate-50/90 p-4">
                        <h3 className="text-sm font-black text-slate-800">요약</h3>
                        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div>
                            <dt className="text-xs font-semibold text-slate-500">닉네임</dt>
                            <dd className="mt-0.5 text-sm font-semibold text-slate-900">
                              {cells.nickname}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold text-slate-500">레벨</dt>
                            <dd className="mt-0.5 text-sm text-slate-900">{cells.level}</dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold text-slate-500">진단점수</dt>
                            <dd className="mt-0.5 text-sm tabular-nums text-slate-900">{cells.diagnosticScore}</dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold text-slate-500">매쓰카드 수</dt>
                            <dd className="mt-0.5 text-sm tabular-nums text-slate-900">
                              {cells.mathCardCount}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold text-slate-500">성공한 본문제 수</dt>
                            <dd className="mt-0.5 text-sm tabular-nums text-slate-900">
                              {cells.mainSuccessCount}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold text-slate-500">실패한 본문제 수</dt>
                            <dd className="mt-0.5 text-sm tabular-nums text-slate-900">
                              {cells.mainFailCount}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold text-slate-500">성공한 유사문제 수</dt>
                            <dd className="mt-0.5 text-sm tabular-nums text-slate-900">
                              {cells.similarSuccessCount}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold text-slate-500">실패한 유사문제 수</dt>
                            <dd className="mt-0.5 text-sm tabular-nums text-slate-900">
                              {cells.similarFailCount}
                            </dd>
                          </div>
                          <div className="sm:col-span-2">
                            <dt className="text-xs font-semibold text-slate-500">최근 활동 시간</dt>
                            <dd className="mt-0.5 text-sm text-slate-800">{cells.lastActivity}</dd>
                          </div>
                        </dl>
                      </section>

                      <section>
                        <h3 className="text-sm font-black text-slate-800">전체 학습 이력</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          최근 기록이 위에 표시됩니다.
                        </p>
                        {adminHistoryLoading ? (
                          <p className="mt-4 text-sm font-semibold text-slate-600">기록을 불러오는 중…</p>
                        ) : adminHistoryError ? (
                          <p className="mt-4 text-sm font-semibold text-red-600">{adminHistoryError}</p>
                        ) : adminHistoryRecords.length === 0 ? (
                          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                            표시할 학습 기록이 없습니다.
                          </p>
                        ) : (
                          <div className="mt-3 max-h-[min(52vh,26rem)] overflow-auto rounded-lg border border-slate-200 bg-white">
                            <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                              <thead className="sticky top-0 z-[1] bg-slate-100 text-xs font-bold uppercase text-slate-600">
                                <tr>
                                  <th className="border-b border-slate-200 px-2 py-2">구분</th>
                                  <th className="border-b border-slate-200 px-2 py-2">total</th>
                                  <th className="border-b border-slate-200 px-2 py-2">fail_count</th>
                                  <th className="border-b border-slate-200 px-2 py-2">status</th>
                                  <th className="border-b border-slate-200 px-2 py-2 whitespace-nowrap">
                                    timestamp
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {adminHistoryRecords.map((rec, hi) => (
                                  <tr
                                    key={`hist-${hi}`}
                                    role="button"
                                    tabIndex={0}
                                    title="클릭하여 기록 상세"
                                    className="cursor-pointer odd:bg-white even:bg-slate-50/80 transition hover:bg-blue-50/80 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-300"
                                    onClick={() => selectAdminHistoryRecord(rec)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        selectAdminHistoryRecord(rec)
                                      }
                                    }}
                                  >
                                    <td className="border-b border-slate-100 px-2 py-2 font-medium text-slate-900">
                                      {adminHistoryCategoryLabel(rec)}
                                    </td>
                                    <td className="border-b border-slate-100 px-2 py-2 tabular-nums text-slate-800">
                                      {formatAdminHistoryNumericCell(rec.total)}
                                    </td>
                                    <td className="border-b border-slate-100 px-2 py-2 tabular-nums text-slate-800">
                                      {formatAdminHistoryNumericCell(rec.fail_count ?? rec.failCount)}
                                    </td>
                                    <td className="border-b border-slate-100 px-2 py-2 text-slate-800">
                                      {sheetStatusLabelForAdmin(rec)}
                                    </td>
                                    <td className="border-b border-slate-100 px-2 py-2 whitespace-nowrap text-xs text-slate-600">
                                      {formatAdminHistoryTableTimestamp(rec)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>
                    </div>
                  )
                })()
              )}
            </div>
          </div>
        </div>
      ) : null}

      {activeView === 'teacher-dashboard' && teacherDashStep === 'pickClass' && renameClassTarget ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/45 backdrop-blur-[1px]"
            aria-label="이름 변경 닫기"
            onClick={() => {
              if (isRenameClassBusy) return
              setRenameClassTarget(null)
              setRenameClassName('')
              setRenameClassError('')
            }}
          />
          <div className="relative z-[101] w-full max-w-md rounded-2xl border border-blue-200 bg-white p-5 shadow-2xl shadow-blue-900/15">
            <h3 className="text-lg font-black text-blue-950">클래스 이름 변경</h3>
            <p className="mt-1 text-sm text-slate-600">
              현재 이름:{' '}
              <span className="font-semibold text-slate-900">
                {String(renameClassTarget.displayName || renameClassTarget.className || '').trim() ||
                  normalizeClassCode(renameClassTarget.classCode)}
              </span>
            </p>
            <p className="mt-0.5 font-mono text-xs text-slate-500">
              코드 ({normalizeClassCode(renameClassTarget.classCode)})는 변경되지 않습니다.
            </p>
            <form className="mt-4 space-y-3" onSubmit={handleRenameClassSubmit}>
              <div>
                <label className="block text-xs font-semibold text-slate-600" htmlFor="rename-class-name">
                  새 이름
                </label>
                <input
                  id="rename-class-name"
                  type="text"
                  value={renameClassName}
                  onChange={(e) => setRenameClassName(e.target.value)}
                  placeholder="새 클래스 이름"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-200 focus:ring-2"
                  autoFocus
                />
              </div>
              {renameClassError ? (
                <p className="text-sm font-semibold text-red-600">{renameClassError}</p>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isRenameClassBusy}
                  onClick={() => {
                    setRenameClassTarget(null)
                    setRenameClassName('')
                    setRenameClassError('')
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isRenameClassBusy}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {isRenameClassBusy ? '저장 중…' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {activeView === 'teacher-dashboard' && teacherDashStep === 'pickClass' && isCreateClassOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/45 backdrop-blur-[1px]"
            aria-label="클래스 생성 닫기"
            onClick={() => setIsCreateClassOpen(false)}
          />
          <div className="relative z-[101] w-full max-w-md rounded-2xl border border-blue-200 bg-white p-5 shadow-2xl shadow-blue-900/15">
            <h3 className="text-lg font-black text-blue-950">클래스 생성</h3>
            <form className="mt-4 space-y-3" onSubmit={handleCreateClassSubmit}>
              <div>
                <label className="block text-xs font-semibold text-slate-600" htmlFor="create-class-name">
                  클래스명
                </label>
                <input
                  id="create-class-name"
                  type="text"
                  value={createClassName}
                  onChange={(e) => setCreateClassName(e.target.value)}
                  placeholder="예: 1학년 1반"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-200 focus:ring-2"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600" htmlFor="create-class-code">
                  클래스 코드
                </label>
                <input
                  id="create-class-code"
                  type="text"
                  value={createClassCode}
                  onChange={(e) => setCreateClassCode(e.target.value)}
                  placeholder="예: MATH-11"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none ring-blue-200 focus:ring-2"
                />
              </div>
              {createClassError ? (
                <p className="text-sm font-semibold text-red-600">{createClassError}</p>
              ) : null}
              {createClassNotice ? (
                <p className="text-sm font-semibold text-blue-700">{createClassNotice}</p>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsCreateClassOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isCreateClassBusy}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {isCreateClassBusy ? '생성 중…' : '생성'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
