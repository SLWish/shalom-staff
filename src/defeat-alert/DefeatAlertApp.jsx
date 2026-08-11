import { useCallback, useEffect, useMemo, useState } from 'react'
import './defeatAlert.css'

const GUILDS = ['ShaLom', 'ShaLom2', 'ShaLom3', 'ShaLom4']
const ADMIN_STORAGE_KEY = 'shalomDefeatAdminToken'
const PUSH_TOKEN_STORAGE_KEY = 'shalomDefeatPushManageToken'
const IS_STANDALONE = import.meta.env.VITE_APP_MODE === 'defeat'
const APP_HOME = IS_STANDALONE ? '/' : '/defeat-alert/'
const API_BASE = String(import.meta.env.VITE_DEFEAT_API_BASE || '/.netlify/functions').replace(/\/$/, '')

function defeatApiUrl(functionName) {
  if (API_BASE === '/defeat-api') {
    return `/.netlify/functions/defeat-api-proxy?endpoint=${encodeURIComponent(functionName)}`
  }
  return `${API_BASE}/${functionName}`
}

function defeatApiUrlWithQuery(functionName, params) {
  const url = defeatApiUrl(functionName)
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}${params.toString()}`
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `요청에 실패했습니다. (${response.status})`)
    error.status = response.status
    throw error
  }
  return data
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)))
}

function supportsWebPush() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function isInAppBrowser() {
  const browserSignature = `${navigator.userAgent} ${document.referrer}`
  return /KAKAOTALK|NAVER\(inapp|FBAN|FBAV|Instagram|Line\/|ChatGPT|OpenAI|com\.openai\.chatgpt/i.test(browserSignature)
}

function getExternalBrowserUrl() {
  const target = `${window.location.origin}${APP_HOME}?tab=subscribe`
  if (!/Android/i.test(navigator.userAgent)) return target
  const parsed = new URL(target)
  return `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${encodeURIComponent(target)};end`
}

function withTimeout(promise, milliseconds, message) {
  let timeoutId
  const timeout = new Promise((resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), milliseconds)
  })
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId))
}

async function getBrowserPushSubscription(onProgress) {
  if (!supportsWebPush()) {
    throw new Error('이 브라우저는 웹 푸시를 지원하지 않습니다. iPhone은 사이트를 홈 화면에 추가한 뒤 실행해주세요.')
  }

  onProgress('알림 권한 확인 중…')
  const permission = Notification.permission === 'default'
    ? await withTimeout(
      Notification.requestPermission(),
      30000,
      '알림 권한 요청이 응답하지 않습니다. 브라우저의 사이트 설정에서 알림을 직접 허용해주세요.',
    )
    : Notification.permission
  if (permission !== 'granted') {
    throw new Error('브라우저 설정에서 이 사이트의 알림을 허용해주세요.')
  }

  onProgress('푸시 서버 확인 중…')
  const { publicKey } = await withTimeout(
    requestJson(defeatApiUrl('defeat-push-config')),
    15000,
    '푸시 서버 연결 시간이 초과됐습니다.',
  )
  onProgress('브라우저 연결 중…')
  const registration = await withTimeout(
    navigator.serviceWorker.register('/defeat-sw.js'),
    15000,
    '브라우저 알림 서비스를 시작하지 못했습니다.',
  )
  const existing = await withTimeout(
    registration.pushManager.getSubscription(),
    15000,
    '기존 푸시 구독을 확인하지 못했습니다.',
  )
  if (existing) return existing

  return withTimeout(registration.pushManager.subscribe({
      applicationServerKey: urlBase64ToUint8Array(publicKey),
      userVisibleOnly: true,
    }),
    30000,
    '푸시 구독 시간이 초과됐습니다. 브라우저 알림 권한과 절전 설정을 확인해주세요.',
  )
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
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    const remainingMinutes = minutes % 60
    return [
      `${days}일`,
      remainingHours ? `${remainingHours}시간` : '',
      remainingMinutes ? `${remainingMinutes}분` : '',
    ].filter(Boolean).join(' ')
  }
  const rest = minutes % 60
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`
}

function NicknameAutocomplete({ maxLength = 40, onChange, placeholder, required = false, value }) {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [dismissedValue, setDismissedValue] = useState('')
  const [searchedValue, setSearchedValue] = useState('')
  const [searchError, setSearchError] = useState(false)

  useEffect(() => {
    const query = value.trim()
    if (query.length < 2 || query === dismissedValue) {
      return undefined
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setSearchError(false)
      try {
        const params = new URLSearchParams({ q: query })
        const result = await requestJson(defeatApiUrlWithQuery('defeat-nickname-search', params), {
          signal: controller.signal,
        })
        setSuggestions(result.suggestions || [])
        setSearchedValue(query)
        setOpen(true)
      } catch (error) {
        if (error.name !== 'AbortError') {
          setSuggestions([])
          setSearchedValue('')
          setSearchError(true)
          setOpen(true)
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [dismissedValue, value])

  const choose = (suggestion) => {
    setDismissedValue(suggestion.nickname)
    onChange(suggestion.nickname)
    setSuggestions([])
    setLoading(false)
    setOpen(false)
    setSearchedValue('')
    setSearchError(false)
  }

  return <div className="defeat-nickname-field">
    <input
      autoComplete="off"
      maxLength={maxLength}
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      onChange={(event) => {
        setDismissedValue('')
        setSuggestions([])
        setLoading(false)
        setOpen(false)
        setSearchedValue('')
        setSearchError(false)
        onChange(event.target.value)
      }}
      onFocus={() => suggestions.length && setOpen(true)}
      placeholder={placeholder}
      required={required}
      value={value}
    />
    {loading && <span className="defeat-nickname-loading">검색 중…</span>}
    {open && suggestions.length > 0 && <div className="defeat-nickname-suggestions">
      {suggestions.map((suggestion) => <button
        key={`${suggestion.guildName}:${suggestion.nickname}`}
        onClick={() => choose(suggestion)}
        type="button"
      >
        <strong>{suggestion.nickname}</strong>
        <small>{suggestion.guildName}</small>
      </button>)}
    </div>}
    {open && !loading && searchError && <div className="defeat-nickname-api-error">
      <strong>API 불러오기 Error</strong>
      <small>잠시 후 다시 검색해주세요.</small>
    </div>}
    {open && !loading && !searchError && suggestions.length === 0 && searchedValue === value.trim() && <div className="defeat-nickname-unknown">
      <strong>Unknown User</strong>
      <small>1~4군 활동 유저만 인식됩니다.</small>
    </div>}
  </div>
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
      setData(await requestJson(defeatApiUrl('defeat-status')))
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
  const [nickname, setNickname] = useState('')
  const [token, setToken] = useState(() => window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY) || '')
  const [deviceState, setDeviceState] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [copied, setCopied] = useState(false)
  const inAppBrowser = isInAppBrowser()

  const callManage = useCallback(async (manageToken, payload) => requestJson(defeatApiUrl('defeat-push-manage'), {
    ...(payload ? { body: JSON.stringify(payload), method: 'POST' } : {}),
    headers: { Authorization: `Bearer ${manageToken}` },
  }), [])

  useEffect(() => {
    if (!token) return undefined
    const loadDeviceState = () => {
      callManage(token)
        .then(setDeviceState)
        .catch((loadError) => {
          if (loadError.status === 401) {
            window.localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY)
            setToken('')
          } else {
            setError(loadError.message)
          }
        })
    }
    const timer = window.setTimeout(loadDeviceState, 0)
    const refreshTimer = window.setInterval(loadDeviceState, 60000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(refreshTimer)
    }
  }, [callManage, token])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setProgress('알림 연결 준비 중…')
    setMessage('')
    setError('')
    try {
      const subscription = await getBrowserPushSubscription(setProgress)
      setProgress('닉네임 등록 중…')
      const result = await withTimeout(requestJson(defeatApiUrl('defeat-push-subscribe'), {
        body: JSON.stringify({
          manageToken: token,
          nickname,
          subscription: subscription.toJSON(),
        }),
        method: 'POST',
      }), 30000, '등록 서버의 응답 시간이 초과됐습니다.')
      window.localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, result.manageToken)
      setToken(result.manageToken)
      setDeviceState(await callManage(result.manageToken))
      setMessage(result.message)
      setNickname('')
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const runAction = async (payload) => {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await callManage(token, payload)
      if (result.deleted) {
        const registration = await navigator.serviceWorker?.getRegistration('/')
        const subscription = await registration?.pushManager.getSubscription()
        await subscription?.unsubscribe()
        window.localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY)
        setToken('')
        setDeviceState(null)
        setMessage('이 기기의 디핏 알림을 삭제했습니다.')
        return
      }
      setDeviceState(result)
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy(false)
    }
  }

  const sendTestPush = async () => {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await requestJson(defeatApiUrl('defeat-push-test'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      setMessage(result.message)
    } catch (testError) {
      setError(testError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="defeat-page defeat-settings-page">
      <div className="defeat-hero">
        <div>
          <p className="defeat-eyebrow">PERSONAL ALERT</p>
          <h1>디핏 알림 설정</h1>
          <p>내 캐릭터가 5분 이상 멈추면 이 기기에 푸시 알림을 한 번만 보내드려요.</p>
        </div>
      </div>

      <div className="defeat-settings-layout">
        <form className="defeat-form-card" onSubmit={submit}>
          <h2>알림 등록</h2>
          <p>닉네임을 선택하고 브라우저 알림을 허용하면 바로 등록됩니다.</p>
          <label>
            <span>인게임 닉네임</span>
            <NicknameAutocomplete value={nickname} onChange={setNickname} placeholder="두 글자 이상 입력" required />
          </label>
          <button className="defeat-primary-button" type="submit" disabled={busy || inAppBrowser}>
            {inAppBrowser ? '외부 브라우저에서 등록해주세요' : busy ? progress || '처리 중…' : deviceState ? '캐릭터 추가 등록' : '이 기기에서 알림 받기'}
          </button>
          {inAppBrowser && <div className="defeat-external-browser-notice">
            <strong>앱 내부 브라우저에서는 푸시 등록이 제한돼요.</strong>
            <span>오른쪽 위 ⋮ 메뉴에서 ‘다른 브라우저로 열기’를 선택해주세요.</span>
            {/Android/i.test(navigator.userAgent) ? <a href={getExternalBrowserUrl()}>외부 브라우저로 열기</a> : <button onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href)
                setCopied(true)
              } catch {
                setError('주소를 복사하지 못했습니다. 브라우저 메뉴에서 직접 열어주세요.')
              }
            }} type="button">{copied ? '주소 복사됨' : 'Safari에서 열 주소 복사'}</button>}
          </div>}
          {message && <div className="defeat-form-message success">{message}</div>}
          {error && <div className="defeat-form-message error">{error}</div>}
          <small className="defeat-privacy">푸시 구독 정보는 서버에 비공개로 저장되며 관리자 화면에도 표시되지 않습니다.</small>
        </form>

        <aside className="defeat-how-card">
          <span className="defeat-how-icon">♢</span>
          <h2>메일 없이 바로 알림</h2>
          <p>이 기기에 저장된 보안 정보로만 알림을 관리합니다. 브라우저 데이터를 지우면 다시 등록해야 해요.</p>
          <ol><li>1~4군 닉네임 선택</li><li>브라우저 알림 허용</li><li>이 화면에서 켜기·끄기·삭제</li></ol>
        </aside>
      </div>

      {deviceState && <div className="defeat-push-manager">
        <div className="defeat-account-toggle">
          <div><strong>이 기기 전체 푸시 알림</strong><small>등록된 모든 캐릭터를 한 번에 제어합니다.</small></div>
          <div className="defeat-push-controls">
            <button className="test" disabled={busy} onClick={sendTestPush} type="button">테스트</button>
            <button className={deviceState.alertsEnabled ? 'on' : ''} disabled={busy} onClick={() => runAction({ action: 'toggle-device', enabled: !deviceState.alertsEnabled })} type="button">{deviceState.alertsEnabled ? '켜짐' : '꺼짐'}</button>
          </div>
        </div>
        <div className="defeat-character-stack">
          {deviceState.characters.map((character) => <article className="defeat-character-card" key={character.id}>
            <div className="defeat-character-main"><span className={!character.alertsEnabled ? 'paused' : character.isDefeated ? 'danger' : ''}>{!character.alertsEnabled ? 'PAUSE' : character.isDefeated ? 'DEFEAT' : 'ON'}</span><div><h2>{character.nickname}</h2><p>{character.guildName} · 마지막 확인 {formatDateTime(character.lastCheckedAt)}</p></div></div>
            <div className="defeat-repeat-setting">
              <label htmlFor={`repeat-${character.id}`}>재알림</label>
              <select id={`repeat-${character.id}`} disabled={busy} value={character.repeatIntervalMinutes || 0} onChange={(event) => runAction({ action: 'set-repeat-interval', characterId: character.id, repeatIntervalMinutes: Number(event.target.value) })}>
                <option value="0">반복 없음</option><option value="10">10분</option><option value="15">15분</option><option value="30">30분</option><option value="60">1시간</option><option value="120">2시간</option><option value="180">3시간</option>
              </select>
            </div>
            <div className="defeat-character-actions">
              <button disabled={busy} onClick={() => runAction({ action: 'toggle-character', characterId: character.id, enabled: !character.alertsEnabled })} type="button">{character.alertsEnabled ? '일시중지' : '다시 켜기'}</button>
              <button className="danger" disabled={busy} onClick={() => window.confirm(`${character.nickname}을(를) 삭제할까요?`) && runAction({ action: 'delete-character', characterId: character.id })} type="button">삭제</button>
            </div>
          </article>)}
        </div>
        <div className="defeat-delete-account"><button disabled={busy} onClick={() => window.confirm('이 기기에 등록된 모든 캐릭터와 푸시 알림을 삭제할까요?') && runAction({ action: 'delete-device' })} type="button">이 기기 알림 전체 삭제</button></div>
      </div>}
    </section>
  )
}

function MainApp() {
  const params = new URLSearchParams(window.location.search)
  const [page, setPage] = useState(params.get('tab') === 'subscribe' ? 'subscribe' : 'status')
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

  const callManage = useCallback(async (payload) => requestJson(defeatApiUrl('defeat-manage'), {
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
                <div className="defeat-character-main"><span className={!character.alertsEnabled ? 'paused' : character.isDefeated ? 'danger' : ''}>{!character.alertsEnabled ? 'PAUSE' : character.isDefeated ? 'DEFEAT' : 'ON'}</span><div><h2>{character.nickname}</h2><p>{character.guildName} · 마지막 확인 {formatDateTime(character.lastCheckedAt)}</p></div></div>
                <div className="defeat-repeat-setting">
                  <label htmlFor={`repeat-legacy-${character.id}`}>재알림</label>
                  <select id={`repeat-legacy-${character.id}`} disabled={busy} value={character.repeatIntervalMinutes || 0} onChange={(event) => runAction({ action: 'set-repeat-interval', characterId: character.id, repeatIntervalMinutes: Number(event.target.value) })}>
                    <option value="0">반복 없음</option><option value="10">10분</option><option value="15">15분</option><option value="30">30분</option><option value="60">1시간</option><option value="120">2시간</option><option value="180">3시간</option>
                  </select>
                </div>
                <div className="defeat-character-actions">
                  <button disabled={busy} onClick={() => runAction({ action: 'toggle-character', characterId: character.id, enabled: !character.alertsEnabled })} type="button">{character.alertsEnabled ? '일시중지' : '다시 켜기'}</button>
                  <button className="danger" disabled={busy} onClick={() => window.confirm(`${character.nickname}을(를) 삭제할까요?`) && runAction({ action: 'delete-character', characterId: character.id })} type="button">삭제</button>
                </div>
              </article>
            ))}
          </div>
          <form className="defeat-add-character" onSubmit={addCharacter}><div><strong>부캐 추가</strong><small>1~4군에서 닉네임을 자동으로 찾습니다.</small></div><NicknameAutocomplete value={nickname} onChange={setNickname} placeholder="두 글자 이상 입력" required /><button disabled={busy} type="submit">추가</button></form>
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
      const result = await requestJson(defeatApiUrl('defeat-admin'), { headers: { Authorization: `Bearer ${adminToken}` } })
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
        <div className="defeat-hero"><div><p className="defeat-eyebrow">ADMIN ONLY</p><h1>알림 등록 현황</h1><p>기기의 푸시 구독 주소는 이 화면과 API 응답에 포함되지 않습니다.</p></div></div>
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
