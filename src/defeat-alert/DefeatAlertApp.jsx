import { useCallback, useEffect, useMemo, useState } from 'react'
import './defeatAlert.css'

const GUILDS = ['ShaLom', 'ShaLom2', 'ShaLom3', 'ShaLom4']
const ADMIN_STORAGE_KEY = 'shalomDefeatAdminToken'
const IS_STANDALONE = import.meta.env.VITE_APP_MODE === 'defeat'
const APP_HOME = IS_STANDALONE ? '/' : '/defeat-alert/'

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `요청에 실패했습니다. (${response.status})`)
  return data
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

function getStoppedMinutes(apiDate, fallback) {
  const time = new Date(apiDate).getTime()
  if (!Number.isFinite(time)) return fallback || 0
  return Math.max(fallback || 0, Math.floor((Date.now() - time) / 60000))
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return '-'
  if (minutes < 60) return `${minutes}분`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`
}

function AppFrame({ children, compact = false }) {
  return (
    <div className="defeat-app">
      <header className="defeat-header">
        <a className="defeat-brand" href={APP_HOME} aria-label="디핏 알림 홈">
          <span className="defeat-brand-mark">S</span>
          <span><strong>ShaLom</strong><small>Defeat Watch</small></span>
        </a>
        {!compact && <span className="defeat-live-label"><i /> 1~4군 모니터링</span>}
      </header>
      {children}
      <footer className="defeat-footer">원본 게임 API 장애는 디핏으로 판정하지 않습니다.</footer>
    </div>
  )
}

function StatusPage() {
  const [data, setData] = useState({ defeated: [], monitor: { sourceStatus: 'idle' } })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    try {
      setError('')
      setData(await requestJson('/.netlify/functions/defeat-status'))
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialId = window.setTimeout(load, 0)
    const refreshId = window.setInterval(load, 60000)
    const tickId = window.setInterval(() => setTick((value) => value + 1), 30000)
    return () => {
      window.clearTimeout(initialId)
      window.clearInterval(refreshId)
      window.clearInterval(tickId)
    }
  }, [load])

  const grouped = useMemo(() => Object.fromEntries(GUILDS.map((guild) => [
    guild,
    data.defeated.filter((member) => member.guildName === guild),
  ])), [data.defeated])
  const status = data.monitor?.sourceStatus || 'idle'

  return (
    <section className="defeat-page">
      <div className="defeat-hero">
        <div>
          <p className="defeat-eyebrow">LIVE STATUS</p>
          <h1>전체 디핏 안내</h1>
          <p>웨이브 기록이 5분 이상 멈춘 캐릭터를 보여드려요.</p>
        </div>
        <div className={`defeat-source ${status}`}>
          <i />
          <span>{status === 'ok' ? 'API 정상' : status === 'partial' ? '일부 조회 지연' : status === 'down' ? 'API 장애' : '확인 대기'}</span>
        </div>
      </div>

      <div className="defeat-meta-row">
        <span>마지막 확인 {formatDateTime(data.monitor?.lastCheckedAt)}</span>
        <button type="button" onClick={load} disabled={loading}>{loading ? '확인 중' : '새로고침'}</button>
      </div>
      {data.monitor?.error && <div className="defeat-banner warning">{data.monitor.error}</div>}
      {error && <div className="defeat-banner error">{error}</div>}

      <div className="defeat-guild-grid">
        {GUILDS.map((guild, index) => (
          <article className="defeat-guild-card" key={guild}>
            <header>
              <span className="defeat-guild-number">{index + 1}</span>
              <div><h2>{guild}</h2><p>{grouped[guild].length}명 감지</p></div>
            </header>
            <div className="defeat-member-list">
              {grouped[guild].length === 0 ? (
                <div className="defeat-empty"><span>✓</span><p>현재 감지된 디핏이 없어요</p></div>
              ) : grouped[guild].map((member) => (
                <div className="defeat-member" key={`${guild}:${member.nickname}`}>
                  <div><strong>{member.nickname}</strong><small>wave {Number(member.wave || 0).toLocaleString()}</small></div>
                  <span>{formatDuration(getStoppedMinutes(member.apiDate, member.inactiveMinutes))}</span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function SubscribePage() {
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    setError('')
    try {
      const result = await requestJson('/.netlify/functions/defeat-subscribe', {
        body: JSON.stringify({ email, nickname }),
        method: 'POST',
      })
      setMessage(result.message)
      setNickname('')
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="defeat-page defeat-settings-page">
      <div className="defeat-hero">
        <div>
          <p className="defeat-eyebrow">PERSONAL ALERT</p>
          <h1>디핏 알림 설정</h1>
          <p>내 캐릭터가 5분 이상 멈추면 이메일로 한 번만 알려드려요.</p>
        </div>
      </div>

      <div className="defeat-settings-layout">
        <form className="defeat-form-card" onSubmit={submit}>
          <h2>알림 등록</h2>
          <p>닉네임은 ShaLom 1~4군에서 자동으로 확인합니다.</p>
          <label>
            <span>인게임 닉네임</span>
            <input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="예: SL_Wish" maxLength={40} required />
          </label>
          <label>
            <span>알림받을 이메일</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@gmail.com" autoComplete="email" required />
          </label>
          <button className="defeat-primary-button" type="submit" disabled={submitting}>
            {submitting ? '닉네임 확인 중…' : '확인 메일 받기'}
          </button>
          {message && <div className="defeat-form-message success">{message}</div>}
          {error && <div className="defeat-form-message error">{error}</div>}
          <small className="defeat-privacy">이메일은 알림 발송에만 사용하며 공개 화면과 관리자 목록에 표시하지 않습니다.</small>
        </form>

        <aside className="defeat-how-card">
          <span className="defeat-how-icon">↗</span>
          <h2>부캐도 함께 관리</h2>
          <p>확인 메일의 개인 관리 링크에서 부캐를 추가하고 캐릭터별로 알림을 켜거나 끌 수 있어요.</p>
          <ol><li>닉네임과 이메일 입력</li><li>이메일에서 등록 확인</li><li>개인 페이지에서 자유롭게 관리</li></ol>
        </aside>
      </div>
    </section>
  )
}

function MainApp() {
  const params = new URLSearchParams(window.location.search)
  const [page, setPage] = useState('status')
  const verification = params.get('verification')
  const access = params.get('access')

  return (
    <AppFrame>
      <nav className="defeat-tabs" aria-label="주요 메뉴">
        <button className={page === 'status' ? 'active' : ''} onClick={() => setPage('status')} type="button">전체 디핏 안내</button>
        <button className={page === 'subscribe' ? 'active' : ''} onClick={() => setPage('subscribe')} type="button">디핏 알림 설정</button>
      </nav>
      {(verification === 'invalid' || access === 'invalid') && <div className="defeat-top-message">링크가 만료되었거나 유효하지 않습니다. 다시 등록해주세요.</div>}
      {(verification === 'error' || access === 'error') && <div className="defeat-top-message">링크 처리 중 오류가 발생했습니다.</div>}
      {page === 'status' ? <StatusPage /> : <SubscribePage />}
    </AppFrame>
  )
}

function ManageApp() {
  const token = new URLSearchParams(window.location.search).get('token') || ''
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)

  const callManage = useCallback(async (payload) => requestJson('/.netlify/functions/defeat-manage', {
    ...(payload ? { body: JSON.stringify(payload), method: 'POST' } : {}),
    headers: { Authorization: `Bearer ${token}` },
  }), [token])

  useEffect(() => {
    if (!token) return undefined
    const initialId = window.setTimeout(() => {
      callManage().then(setState).catch((loadError) => setError(loadError.message))
    }, 0)
    return () => window.clearTimeout(initialId)
  }, [callManage, token])

  const runAction = async (payload) => {
    setBusy(true)
    setError('')
    try {
      const result = await callManage(payload)
      if (result.deleted) {
        window.location.replace(`${APP_HOME}?deleted=1`)
        return
      }
      setState(result)
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy(false)
    }
  }

  const addCharacter = async (event) => {
    event.preventDefault()
    await runAction({ action: 'add-character', nickname })
    setNickname('')
  }

  return (
    <AppFrame compact>
      <section className="defeat-page defeat-manage-page">
        <a className="defeat-back-link" href={APP_HOME}>← 전체 현황으로</a>
        <div className="defeat-hero"><div><p className="defeat-eyebrow">PRIVATE PAGE</p><h1>내 알림 관리</h1><p>이 링크를 가진 사람만 설정을 변경할 수 있어요.</p></div></div>
        {(error || !token) && <div className="defeat-banner error">{error || '관리 토큰이 없습니다.'}</div>}
        {!state && !error && <div className="defeat-loading">설정을 불러오는 중…</div>}
        {state && <>
          <div className="defeat-account-toggle">
            <div><strong>전체 이메일 알림</strong><small>모든 캐릭터 알림을 한 번에 제어합니다.</small></div>
            <button className={state.accountAlertsEnabled ? 'on' : ''} disabled={busy} onClick={() => runAction({ action: 'toggle-account', enabled: !state.accountAlertsEnabled })} type="button">{state.accountAlertsEnabled ? '켜짐' : '꺼짐'}</button>
          </div>
          <div className="defeat-character-stack">
            {state.characters.map((character) => (
              <article className="defeat-character-card" key={character.id}>
                <div className="defeat-character-main"><span className={character.isDefeated ? 'danger' : ''}>{character.isDefeated ? 'DEFEAT' : 'OK'}</span><div><h2>{character.nickname}</h2><p>{character.guildName} · 마지막 확인 {formatDateTime(character.lastCheckedAt)}</p></div></div>
                <div className="defeat-character-actions">
                  <button disabled={busy} onClick={() => runAction({ action: 'toggle-character', characterId: character.id, enabled: !character.alertsEnabled })} type="button">알림 {character.alertsEnabled ? '끄기' : '켜기'}</button>
                  <button className="danger" disabled={busy} onClick={() => window.confirm(`${character.nickname}을(를) 삭제할까요?`) && runAction({ action: 'delete-character', characterId: character.id })} type="button">삭제</button>
                </div>
              </article>
            ))}
          </div>
          <form className="defeat-add-character" onSubmit={addCharacter}><div><strong>부캐 추가</strong><small>1~4군에서 닉네임을 자동으로 찾습니다.</small></div><input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="인게임 닉네임" maxLength={40} required /><button disabled={busy} type="submit">추가</button></form>
          <div className="defeat-delete-account"><button disabled={busy} onClick={() => window.confirm('등록한 모든 캐릭터와 알림 정보를 완전히 삭제할까요?') && runAction({ action: 'delete-account' })} type="button">내 알림 정보 전체 삭제</button></div>
        </>}
      </section>
    </AppFrame>
  )
}

function AdminApp() {
  const [token, setToken] = useState(() => window.sessionStorage.getItem(ADMIN_STORAGE_KEY) || '')
  const [input, setInput] = useState('')
  const [characters, setCharacters] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async (adminToken) => {
    try {
      const result = await requestJson('/.netlify/functions/defeat-admin', { headers: { Authorization: `Bearer ${adminToken}` } })
      window.sessionStorage.setItem(ADMIN_STORAGE_KEY, adminToken)
      setCharacters(result.characters)
      setToken(adminToken)
      setError('')
    } catch (loadError) {
      window.sessionStorage.removeItem(ADMIN_STORAGE_KEY)
      setCharacters(null)
      setError(loadError.message)
    }
  }, [])

  useEffect(() => {
    if (!token) return undefined
    const initialId = window.setTimeout(() => load(token), 0)
    return () => window.clearTimeout(initialId)
  }, [load, token])

  return (
    <AppFrame compact>
      <section className="defeat-page defeat-manage-page">
        <a className="defeat-back-link" href={APP_HOME}>← 전체 현황으로</a>
        <div className="defeat-hero"><div><p className="defeat-eyebrow">ADMIN ONLY</p><h1>알림 등록 현황</h1><p>이메일 주소는 이 화면과 API 응답에 포함되지 않습니다.</p></div></div>
        {!characters && <form className="defeat-admin-login" onSubmit={(event) => { event.preventDefault(); load(input) }}><label><span>관리자 보안 키</span><input type="password" value={input} onChange={(event) => setInput(event.target.value)} required /></label><button type="submit">확인</button></form>}
        {error && <div className="defeat-banner error">{error}</div>}
        {characters && <div className="defeat-admin-list"><div className="defeat-admin-summary"><strong>등록 캐릭터 {characters.length}명</strong><button type="button" onClick={() => load(token)}>새로고침</button></div>{characters.map((character) => <article key={character.id}><div><strong>{character.nickname}</strong><small>{character.guildName} · 등록 {formatDateTime(character.createdAt)}</small></div><div className="defeat-admin-badges"><span className={character.accountAlertsEnabled && character.alertsEnabled ? 'on' : 'off'}>{character.accountAlertsEnabled && character.alertsEnabled ? '알림 켜짐' : '알림 꺼짐'}</span>{character.isDefeated && <span className="danger">디핏</span>}</div></article>)}</div>}
      </section>
    </AppFrame>
  )
}

export default function DefeatAlertApp() {
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path.endsWith('/manage')) return <ManageApp />
  if (path.endsWith('/admin')) return <AdminApp />
  return <MainApp />
}
