import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import AppHeader from './components/AppHeader.jsx'
import DataNotice from './components/DataNotice.jsx'
import GuildSelector from './components/GuildSelector.jsx'
import GuildSummaryCard from './components/GuildSummaryCard.jsx'
import MenuDrawer from './components/MenuDrawer.jsx'
import PageShell from './components/PageShell.jsx'
import { activeGuildConfigs, guildConfigs, menuItems } from './config/guildConfig.js'
import { fallbackGuilds } from './data/fallbackGuilds.js'
import { fetchGuildSeason, fetchPlayerSeason } from './services/growCastleApi.js'
import {
  compareAndSaveScoreHistory,
  mergeMembersWithHistory,
  readScoreHistory,
} from './services/scoreHistory.js'
import { createSeasonArchive, readSeasonArchives, shouldAutoArchive, upsertSeasonArchive } from './services/seasonArchive.js'
import { fetchSharedSeasonArchives } from './services/serverHistoryApi.js'
import { getLatestWphRecords } from './services/wphHistory.js'
import { fetchWphReport } from './services/wphReportApi.js'

const INACTIVE_HOURS_THRESHOLD = 6
const GUILD_ORDER = ['ShaLom', 'ShaLom2', 'ShaLom3', 'ShaLom4']
const MAX_GUILD_MEMBERS = 20
const SHOW_PROJECTION_DEBUG = false
const GUILD_NICKNAME_PATTERN = /^SL_/
const INVALID_GUILD_NICKNAME_PATTERN = /^5L_/i
const MANUAL_LEADER_STORAGE_KEY = 'shalomInfo_manualGuildLeaders'
const MOVE_SCOPE_ALL = 'all'

function createDefaultCutScores() {
  return Object.fromEntries(activeGuildConfigs.map((config) => [config.guildName, config.defaultCutScore]))
}

function isGuildLeaderRole(value) {
  const text = String(value || '').trim()
  if (!text) return false

  const lowerText = text.toLowerCase().replaceAll(/[\s_-]/g, '')
  return (
    lowerText.includes('guildmaster') ||
    lowerText.includes('guildleader') ||
    lowerText === 'master' ||
    lowerText === 'leader' ||
    lowerText === 'owner' ||
    text.includes('길드장') ||
    text.includes('마스터')
  )
}

function getFallbackGuild(config, cutScore) {
  const fallback = fallbackGuilds.find((guild) => guild.guildName === config.guildName)
  return {
    guildName: config.guildName,
    seasonEndAt: fallback?.seasonEndAt || null,
    seasonPeriod: fallback?.seasonPeriod || '현재 시즌',
    cutScore,
    members: (fallback?.members || []).map((member) => ({
      ...member,
      isGuildLeader: member.isGuildLeader || isGuildLeaderRole(member.role || member.memo),
    })),
    type: config.type,
  }
}

function sortByScore(members) {
  return [...members].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname))
}

function sortShortageMembers(members) {
  return [...members].sort((a, b) => b.shortage - a.shortage || a.score - b.score)
}

function sortInactiveMembers(members) {
  return [...members].sort((a, b) => b.inactiveHours - a.inactiveHours || a.score - b.score)
}

function formatDateTime(value) {
  if (!value) return '기록 없음'
  return new Date(getDateTimeValue(value)).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

function getDateTimeValue(value) {
  if (!value) return value
  const text = String(value)
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
  return text.includes('T') && !hasExplicitTimezone ? `${text}Z` : value
}

function getValidRecordTime(apiDate) {
  if (!apiDate) return null
  const time = new Date(getDateTimeValue(apiDate)).getTime()
  return Number.isFinite(time) ? time : null
}

function getSeasonStartTime(guild) {
  const apiStartTime = getValidRecordTime(guild.seasonStartAt)
  if (apiStartTime !== null) return apiStartTime

  const parsedStart = parseSeasonStart(guild.seasonPeriod)
  return parsedStart ? parsedStart.getTime() : null
}

function getMemberCutMeta(member, guild, cutScore) {
  if (!member.history?.isNewDuringSeason) {
    return {
      effectiveCutScore: cutScore,
      isProratedCut: false,
      joinedDuringSeasonAt: null,
    }
  }

  const seasonStartTime = getSeasonStartTime(guild)
  const seasonEndTime = getValidRecordTime(guild.seasonEndAt)
  const firstSeenTime = getValidRecordTime(member.history?.firstSeenAt)

  if (seasonStartTime === null || seasonEndTime === null || firstSeenTime === null) {
    return {
      effectiveCutScore: cutScore,
      isProratedCut: false,
      joinedDuringSeasonAt: null,
    }
  }

  const seasonDuration = seasonEndTime - seasonStartTime

  if (Date.now() > seasonEndTime || seasonDuration <= 0 || firstSeenTime <= seasonStartTime) {
    return {
      effectiveCutScore: cutScore,
      isProratedCut: false,
      joinedDuringSeasonAt: null,
    }
  }

  const elapsedDays = Math.max(0, Math.floor((firstSeenTime - seasonStartTime) / 86400000))
  const cutRatio = Math.max(0, 1 - elapsedDays * 0.2)
  const effectiveCutScore = Math.ceil(cutScore * cutRatio)

  return {
    effectiveCutScore: Math.min(cutScore, effectiveCutScore),
    isProratedCut: effectiveCutScore < cutScore,
    joinedDuringSeasonAt: member.history?.firstSeenAt || null,
  }
}

function hasValidGuildNickname(nickname) {
  const text = String(nickname || '')
  return GUILD_NICKNAME_PATTERN.test(text) && !INVALID_GUILD_NICKNAME_PATTERN.test(text)
}

function GuildLeaderBadge({ member }) {
  if (!member?.isGuildLeader) return null
  return <span className="role-badge">길드장</span>
}


function CrownBadge({ active }) {
  if (!active) return null
  return <span className="crown-badge" title="Guild staff" aria-label="Guild staff">{'\u265B'}</span>
}

function getManualLeaderKey(guildName, nickname) {
  return `${guildName}:${nickname}`
}

function readManualLeaderKeys() {
  if (typeof window === 'undefined') return []

  try {
    const parsed = JSON.parse(window.localStorage.getItem(MANUAL_LEADER_STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []

    const byGuild = new Map()
    parsed
      .filter((key) => typeof key === 'string' && key.includes(':'))
      .forEach((key) => {
        const [guildName] = key.split(':')
        byGuild.set(guildName, key)
      })
    return [...byGuild.values()]
  } catch {
    return []
  }
}

function saveManualLeaderKeys(keys) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(MANUAL_LEADER_STORAGE_KEY, JSON.stringify(keys))
}

const MANUAL_ALT_ACCOUNT_GROUPS = [
  {
    aliases: ['SL_Wish', 'SL_ChaOs', 'SL_ShaLom', 'SL_ZZoGGoMi'],
    displayName: 'Wish',
    key: 'manual-wish',
    mainNickname: 'SL_Wish',
  },
]

function normalizeManualAccountNickname(nickname) {
  return String(nickname || '')
    .trim()
    .normalize('NFKC')
    .replace(/\s/g, '')
    .toLowerCase()
}

function getManualAltAccountGroup(nickname) {
  const normalizedNickname = normalizeManualAccountNickname(nickname)
  return MANUAL_ALT_ACCOUNT_GROUPS.find((group) =>
    group.aliases.some((alias) => normalizeManualAccountNickname(alias) === normalizedNickname),
  )
}

function getAltAccountKey(nickname) {
  const manualGroup = getManualAltAccountGroup(nickname)
  if (manualGroup) return manualGroup.key

  return String(nickname || '')
    .trim()
    .normalize('NFKC')
    .replace(/^[sS5][lL][\s_.-]*/, '')
    .replace(/[\s_.-]/g, '')
    .replace(/\d+$/, '')
    .toLowerCase()
}

function getAltAccountDisplayName(nickname) {
  const manualGroup = getManualAltAccountGroup(nickname)
  if (manualGroup) return manualGroup.displayName

  return String(nickname || '')
    .trim()
    .normalize('NFKC')
    .replace(/^[sS5][lL][\s_.-]*/, '')
    .replace(/\d+$/, '')
}

function getAltAccountGroups(members) {
  const guildOrder = new Map(guildConfigs.map((config) => [config.guildName, config.order]))
  const grouped = members.reduce((groups, member) => {
    const key = getAltAccountKey(member.nickname)
    if (!key) return groups

    const nextGroup = groups.get(key) || {
      displayName: getAltAccountDisplayName(member.nickname),
      key,
      manualMainNickname: getManualAltAccountGroup(member.nickname)?.mainNickname || null,
      members: [],
    }
    nextGroup.members.push(member)
    groups.set(key, nextGroup)
    return groups
  }, new Map())

  return [...grouped.values()]
    .filter((group) => group.members.length > 1)
    .map((group) => ({
      ...group,
      members: [...group.members].sort(
        (a, b) =>
          Number(normalizeManualAccountNickname(b.nickname) === normalizeManualAccountNickname(group.manualMainNickname)) -
            Number(normalizeManualAccountNickname(a.nickname) === normalizeManualAccountNickname(group.manualMainNickname)) ||
          (guildOrder.get(a.guildName) || 99) - (guildOrder.get(b.guildName) || 99) ||
          b.score - a.score ||
          a.nickname.localeCompare(b.nickname),
      ),
    }))
    .sort((a, b) => b.members.length - a.members.length || a.displayName.localeCompare(b.displayName))
}

function AccountRelationBadge({ meta }) {
  if (!meta) return null
  return <span className={meta.isMain ? 'role-badge account-main-badge' : 'role-badge account-alt-badge'}>{meta.label}</span>
}

function getLastRecordMinutes(member) {
  const recordTime = getValidRecordTime(member.lastRecordDate || member.apiDate || member.wph?.apiDate)
  if (recordTime === null) return null
  return Math.max(0, Math.floor((Date.now() - recordTime) / 60000))
}

function formatStoppedMinutes(minutes) {
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 60) return `${minutes}\uBD84`

  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 24) return restMinutes > 0 ? `${hours}\uC2DC\uAC04 ${restMinutes}\uBD84` : `${hours}\uC2DC\uAC04`

  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours > 0 ? `${days}\uC77C ${restHours}\uC2DC\uAC04` : `${days}\uC77C`
}

function formatCheckClock(value) {
  const time = getValidRecordTime(value)
  if (time === null) return null

  return new Date(time).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}
function StoppedFiveMinuteDot({ member }) {
  const minutes = getLastRecordMinutes(member)
  if (minutes === null || minutes < 5) return null

  const checkedAt = member.wph?.checkedAt || member.history?.lastCheckedAt || null
  const checkedClock = formatCheckClock(checkedAt)
  const stoppedLabel = formatStoppedMinutes(minutes)
  const checkLabel = checkedClock ? `\uAC31\uC2E0 ${checkedClock}` : '\uAC31\uC2E0 \uD655\uC778 \uBD88\uAC00'

  return (
    <span className="stopped-status" title={`5\uBD84 \uC774\uC0C1 Defeat · ${stoppedLabel} · ${checkLabel}`}>
      <span className="stopped-dot" aria-hidden="true" />
      <span className="stopped-status-text">{stoppedLabel} Defeat</span>
      <span className="stopped-check-time">{checkLabel}</span>
    </span>
  )
}

function getDiffHoursFromApiDate(apiDate) {
  const recordTime = getValidRecordTime(apiDate)
  if (recordTime === null) return null
  return Math.max(0, (Date.now() - recordTime) / 36e5)
}

function formatInactiveDuration(diffHours) {
  if (diffHours === null) return '\uAE30\uB85D \uD655\uC778 \uBD88\uAC00'
  const totalMinutes = Math.max(0, Math.floor(diffHours * 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 1) return `${minutes}\uBD84`
  if (hours < 24) return `${hours}\uC2DC\uAC04 ${minutes}\uBD84`
  return `${Math.floor(hours / 24)}\uC77C ${hours % 24}\uC2DC\uAC04`
}

function parseSeasonStart(seasonPeriod) {
  if (!seasonPeriod) return null
  const match = String(seasonPeriod).match(/(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/)
  if (!match) return null
  const [, year, month, day] = match
  const parsed = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isSeasonNotJoined(member, seasonStart) {
  const apiDate = member.lastRecordDate || member.apiDate || member.wph?.apiDate
  const recordTime = getValidRecordTime(apiDate)
  return member.score === 0 && Boolean(seasonStart) && recordTime !== null && recordTime < seasonStart.getTime()
}

function getActivityMeta(member, seasonStart) {
  const rawApiDate = member.lastRecordDate || member.apiDate || member.wph?.apiDate || null
  const diffHours = getDiffHoursFromApiDate(rawApiDate)
  const hasValidDate = diffHours !== null
  const seasonNotJoined = isSeasonNotJoined(member, seasonStart)
  const inactiveOverSixHours = hasValidDate && diffHours >= INACTIVE_HOURS_THRESHOLD
  let activityStatus = '최근 활동'

  if (!hasValidDate) activityStatus = '기록 확인 불가'
  else if (seasonNotJoined) activityStatus = '시즌 미참여'
  else if (inactiveOverSixHours) activityStatus = '6시간 이상 미활동'

  return {
    activityStatus,
    diffHours,
    inactiveOverSixHours,
    inactiveText: formatInactiveDuration(diffHours),
    rawApiDate,
    seasonNotJoined,
  }
}

function getStaffStatus(member, cutScore, seasonStart) {
  const activity = getActivityMeta(member, seasonStart)
  const targetCutScore = member.effectiveCutScore ?? cutScore
  if (activity.activityStatus === '기록 확인 불가') return '기록 확인 불가'
  if (activity.seasonNotJoined) return '시즌 미참여'
  if (member.score < targetCutScore) return '컷 미달'
  if (activity.inactiveOverSixHours) return '미활동'
  return '확인 완료'
}

function getApiNotice(guildName, state) {
  if (!state || state.status === 'idle') return null
  if (state.status === 'loading') {
    return { status: 'loading', title: '로딩 중', message: `${guildName} 데이터를 불러오는 중...` }
  }
  if (state.status === 'success') {
    return { status: 'success', title: '갱신 완료', message: state.message || `${guildName} 데이터를 불러왔습니다.` }
  }
  if (state.status === 'empty') {
    return { status: 'empty', title: '데이터 없음', message: `${guildName} 길드원 데이터 없음` }
  }
  return {
    status: 'error',
    title: state.title || '데이터 불러오기 실패',
    message: state.message || `${guildName} 데이터 불러오기 실패`,
  }
}

function getRemainingHours(seasonEndAt) {
  const seasonEndTime = getValidRecordTime(seasonEndAt)
  if (seasonEndTime === null) return null
  return Math.max(0, (seasonEndTime - Date.now()) / 36e5)
}

function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-'
}

function formatWphSlotDate(value) {
  if (!value) return '-'
  return new Date(getDateTimeValue(value)).toLocaleDateString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

function formatWphSlotClock(value) {
  if (!value) return '-'
  return new Date(getDateTimeValue(value)).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

function formatWphSlotRange(startValue, endValue) {
  if (!startValue || !endValue) return '-'
  const startDate = formatWphSlotDate(startValue)
  const endDate = formatWphSlotDate(endValue)
  const startClock = formatWphSlotClock(startValue)
  const endClock = formatWphSlotClock(endValue)
  return startDate === endDate
    ? `${startDate} ${startClock} ~ ${endClock}`
    : `${startDate} ${startClock} ~ ${endDate} ${endClock}`
}

function formatWphSeasonDate(value) {
  if (!value) return null
  return new Date(getDateTimeValue(value)).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

function formatWphSeasonRange(startValue, endValue) {
  const start = formatWphSeasonDate(startValue)
  const end = formatWphSeasonDate(endValue)
  if (!start || !end) return '55분 기준'
  return `${start} - ${end}`
}

function formatWphScoreProjection(member) {
  if (typeof member.currentScore !== 'number') return '점수: 확인 불가'
  if (typeof member.projectedFinalScore !== 'number') return `점수: ${formatNumber(member.currentScore)} -> 예측 대기`
  return `점수: ${formatNumber(member.currentScore)} -> ${formatNumber(member.projectedFinalScore)} 예상`
}

function formatWphMinute(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  if (value < 60) return `${value}m`
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

function formatProjectedScore(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString()}점` : '예측 대기'
}

function formatWph(member) {
  if (typeof member.wph?.wph === 'number') return `${Math.round(member.wph.wph).toLocaleString()}`
  return member.wph?.wphStatus || '계산 대기'
}

function formatRemainingHours(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '확인 불가'
  const totalHours = Math.max(0, Math.round(value))
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days > 0) return `${days}일 ${hours}시간`
  return `${hours}시간`
}

function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '시즌 종료됨'
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}일 ${hours}시간 ${minutes}분`
  if (hours > 0) return `${hours}시간 ${minutes}분`
  return `${minutes}분`
}

function formatShortDateTime(value) {
  if (!value) return '확인 불가'
  return new Date(getDateTimeValue(value)).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

function formatShortDate(value) {
  if (!value) return '미확인'
  return new Date(getDateTimeValue(value)).toLocaleDateString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

function formatSeasonButtonLabel(archive) {
  const start = formatShortDate(archive?.seasonStartAt)
  const end = formatShortDate(archive?.seasonEndAt)
  return `${start} ~ ${end}`
}

function getArchiveTargetAt(seasonEndAt) {
  const seasonEndTime = getValidRecordTime(seasonEndAt)
  if (seasonEndTime === null) return null
  return new Date(seasonEndTime - 60 * 1000).toISOString()
}

function getScoreTrend(member) {
  return (
    member.history?.prediction || {
      basis: '예측 대기',
      previousScore: null,
      projectedFinalScore: null,
      remainingHours: null,
      scoreDelta: null,
      scorePerHour: null,
      timeDeltaHours: null,
    }
  )
}

function getWphProjectionTrend(guildName, member, wphReport) {
  const reportMember = wphReport?.guilds?.[guildName]?.members?.find((entry) => entry.nickname === member.nickname)
  if (!reportMember) return null

  return {
    basis: 'WPH 55분 기록 기준',
    previousScore: reportMember.startScore,
    projectedFinalScore: typeof reportMember.projectedFinalScore === 'number' ? reportMember.projectedFinalScore : null,
    remainingHours: null,
    scoreDelta: reportMember.scoreDelta,
    scorePerHour: reportMember.scorePerHour,
    timeDeltaHours: null,
  }
}

function getTargetLabel(guildName) {
  const order = GUILD_ORDER.indexOf(guildName)
  return order >= 0 ? `${order + 1}군` : guildName
}

function getGuildOrderIndex(guildName) {
  const index = GUILD_ORDER.indexOf(guildName)
  return index >= 0 ? index : 999
}

function getMoveCandidateProjectedValue(member) {
  return typeof member.projectedFinalScore === 'number' ? member.projectedFinalScore : member.currentScore || 0
}

function compareMoveCandidates(a, b) {
  return (
    getGuildOrderIndex(a.recommendedGuild) - getGuildOrderIndex(b.recommendedGuild) ||
    getMoveCandidateProjectedValue(b) - getMoveCandidateProjectedValue(a) ||
    (b.scorePerHour || 0) - (a.scorePerHour || 0) ||
    (b.currentScore || 0) - (a.currentScore || 0) ||
    a.nickname.localeCompare(b.nickname)
  )
}

function sortMoveCandidates(candidates) {
  return [...candidates].sort(compareMoveCandidates)
}

function getTargetSlotMap(guildStats) {
  return Object.fromEntries(
    guildStats.map(({ guild, stats }) => [
      guild.guildName,
      {
        availableSlots: stats.availableSlots,
        memberCount: stats.memberCount,
        maxMembers: stats.maxMembers,
      },
    ]),
  )
}

function getMoveCandidateGroups(candidates, targetSlotMap) {
  const grouped = candidates.reduce((nextGroups, member) => {
    if (!nextGroups[member.recommendedGuild]) nextGroups[member.recommendedGuild] = []
    nextGroups[member.recommendedGuild].push(member)
    return nextGroups
  }, {})

  return Object.entries(grouped)
    .map(([guildName, members]) => ({
      guildName,
      label: getTargetLabel(guildName),
      members,
      slots: targetSlotMap[guildName] || { availableSlots: 0, memberCount: 0, maxMembers: MAX_GUILD_MEMBERS },
    }))
    .sort((a, b) => getGuildOrderIndex(a.guildName) - getGuildOrderIndex(b.guildName))
}

function getMoveTarget(guildName, currentScore, trend, cutScores) {
  const currentIndex = GUILD_ORDER.indexOf(guildName)
  if (currentIndex < 0) return null

  const upperGuilds = GUILD_ORDER.slice(0, currentIndex)
  for (const targetGuild of upperGuilds) {
    const targetCutScore = cutScores[targetGuild] ?? 0
    const targetLabel = getTargetLabel(targetGuild)

    if (currentScore >= targetCutScore) {
      return {
        recommendationBasis: '현재 점수',
        recommendedGuild: targetGuild,
        reason: `현재 점수 ${formatNumber(currentScore)}점으로 ${targetLabel} 기준 ${formatNumber(targetCutScore)}점 초과`,
        targetGuild,
        targetCutScore,
      }
    }

    if (typeof trend.projectedFinalScore === 'number' && trend.projectedFinalScore >= targetCutScore) {
      return {
        recommendationBasis: '예상 종료 점수',
        recommendedGuild: targetGuild,
        reason: `예상 종료 점수 ${formatNumber(trend.projectedFinalScore)}점으로 ${targetLabel} 기준 ${formatNumber(targetCutScore)}점 초과 예상`,
        targetGuild,
        targetCutScore,
      }
    }
  }

  const projectedScore = typeof trend.projectedFinalScore === 'number' ? trend.projectedFinalScore : null
  const expectedScore = projectedScore ?? currentScore
  const currentCutScore = cutScores[guildName] ?? 0
  if (expectedScore >= currentCutScore || currentIndex >= GUILD_ORDER.length - 1) return null

  const lowerGuilds = GUILD_ORDER.slice(currentIndex + 1)
  const targetGuild = lowerGuilds.find((lowerGuild) => expectedScore >= (cutScores[lowerGuild] ?? 0)) || lowerGuilds.at(-1)
  if (!targetGuild) return null

  const targetCutScore = cutScores[targetGuild] ?? 0
  const targetLabel = getTargetLabel(targetGuild)
  const basis = projectedScore === null ? '현재 점수' : '예상 종료 점수'

  return {
    direction: 'down',
    recommendationBasis: basis,
    recommendedGuild: targetGuild,
    reason: `${basis} ${formatNumber(expectedScore)}점 기준 ${targetLabel} 이동 검토`,
    targetGuild,
    targetCutScore,
  }
}

function getMoveCandidatesForGuild(guild, cutScores, wphReport) {
  const remainingHours = getRemainingHours(guild.seasonEndAt)

  return sortByScore(guild.members)
    .map((member) => {
      const trend = getWphProjectionTrend(guild.guildName, member, wphReport) || getScoreTrend(member)
      const currentScore = Number(member.score)
      if (!Number.isFinite(currentScore)) return null
      const target = getMoveTarget(guild.guildName, currentScore, trend, cutScores)
      if (!target) return null
      return {
        ...member,
        currentScore,
        currentGuild: guild.guildName,
        lastRecord: member.wph?.apiDate || null,
        previousScore: trend.previousScore,
        remainingHours: trend.remainingHours ?? remainingHours,
        projectionBasis: trend.basis || '기록 부족',
        projectedFinalScore: typeof trend.projectedFinalScore === 'number' ? trend.projectedFinalScore : null,
        recommendationBasis: target.recommendationBasis,
        scoreDelta: trend.scoreDelta,
        scorePerHour: trend.scorePerHour,
        targetGuild: target.targetGuild,
        timeDeltaHours: trend.timeDeltaHours,
        ...target,
      }
    })
    .filter(Boolean)
    .sort(compareMoveCandidates)
}

function getGuildStaffData(guild, cutScores, wphReport) {
  const seasonStart = parseSeasonStart(guild.seasonPeriod)
  const shortageMembers = sortShortageMembers(
    guild.members
      .filter((member) => member.score < (member.effectiveCutScore ?? guild.cutScore))
      .map((member) => ({
        ...member,
        shortage: (member.effectiveCutScore ?? guild.cutScore) - member.score,
        lastRecord: member.wph?.apiDate || null,
      })),
  )

  const activityMembers = guild.members.map((member) => {
    const activity = getActivityMeta(member, seasonStart)
    return {
      ...member,
      activityStatus: activity.activityStatus,
      diffHours: activity.diffHours,
      inactiveHours: activity.diffHours ?? 0,
      inactiveText: activity.inactiveText,
      lastRecord: activity.rawApiDate,
      rawApiDate: activity.rawApiDate,
      seasonNotJoined: activity.seasonNotJoined,
    }
  })

  return {
    inactiveMembers: sortInactiveMembers(activityMembers.filter((member) => member.diffHours !== null && member.diffHours >= INACTIVE_HOURS_THRESHOLD)),
    moveCandidates: getMoveCandidatesForGuild(guild, cutScores, wphReport),
    newMembers: sortByScore(activityMembers.filter((member) => member.isProratedCut)),
    nicknameWarningMembers: sortByScore(activityMembers.filter((member) => !member.nicknameFormatOk)),
    seasonNotJoinedMembers: sortInactiveMembers(activityMembers.filter((member) => member.seasonNotJoined)),
    shortageMembers,
    unverifiedMembers: sortByScore(activityMembers.filter((member) => member.diffHours === null)),
  }
}

function getGuildStats(guild, staffData) {
  const totalScore = guild.members.reduce((sum, member) => sum + member.score, 0)
  const memberCount = guild.members.length
  const achievedCount = guild.members.filter((member) => member.score >= (member.effectiveCutScore ?? guild.cutScore)).length
  return {
    achievementRate: memberCount > 0 ? Math.round((achievedCount / memberCount) * 100) : 0,
    achievedCount,
    averageScore: memberCount > 0 ? Math.round(totalScore / memberCount) : 0,
    availableSlots: MAX_GUILD_MEMBERS - memberCount,
    cutScore: guild.cutScore,
    inactiveSixHourCount: staffData.inactiveMembers.length,
    maxMembers: MAX_GUILD_MEMBERS,
    memberCount,
    moveCandidateCount: staffData.moveCandidates.length,
    newMemberCount: staffData.newMembers.length,
    nicknameWarningCount: staffData.nicknameWarningMembers.length,
    seasonNotJoinedCount: staffData.seasonNotJoinedMembers.length,
    totalScore,
    unverifiedCount: staffData.unverifiedMembers.length,
    warningCount: staffData.shortageMembers.length,
  }
}

function getFirstSeasonEndAt(guildStats) {
  return guildStats.find(({ guild }) => guild.seasonEndAt)?.guild.seasonEndAt || null
}

function getTierLabel(index) {
  return `${index + 1}군`
}

function getArchiveFailureGroups(archive) {
  if (!archive?.guilds) return []

  return archive.guilds.map((guild, index) => {
    const cutScore = Number(guild.cutScore) || 0
    const failedMembers = sortShortageMembers(
      (guild.failedMembers || [])
        .map((member) => ({
          nickname: member.nickname,
          score: Number(member.score) || 0,
          shortage: Number(member.shortage) || Math.max(0, cutScore - (Number(member.score) || 0)),
        }))
        .filter((member) => member.nickname),
    )

    return {
      cutScore,
      failedMembers,
      guildName: guild.guildName,
      tierLabel: guild.tierLabel || getTierLabel(index),
    }
  })
}

function getArchiveFailureCountText(groups) {
  return groups.map((group, index) => `${index + 1}군 ${group.failedMembers.length}명`).join(' · ')
}

function buildArchiveNoticeText(archive, groups) {
  if (!archive) return ''

  const lines = [
    '[ShaLom 시즌 컷 미달자 안내]',
    `${formatSeasonButtonLabel(archive)} 기준`,
    `총 미달자: ${groups.reduce((sum, group) => sum + group.failedMembers.length, 0)}명`,
    '',
  ]

  groups.forEach((group, index) => {
    lines.push(`[${index + 1}군 ${group.guildName} / 기준 ${formatNumber(group.cutScore)}]`)
    if (group.failedMembers.length === 0) {
      lines.push('전원 기준 달성')
    } else {
      group.failedMembers.forEach((member) => {
        lines.push(`${member.nickname} ${formatNumber(member.score)}점 / ${formatNumber(member.shortage)} 부족`)
      })
    }
    lines.push('')
  })

  return lines.join('\n').trim()
}

function StaffNotice() {
  return (
    <section className="defeat-notice">
      스탭용 컷 체크 대시보드입니다. 새로고침하면 최신 API 데이터를 다시 불러옵니다.
    </section>
  )
}

function EmptyState({ children = '대상 없음' }) {
  return <div className="empty-state compact-empty">{children}</div>
}

function LoadingState({ guildName }) {
  return <div className="empty-state compact-empty">{guildName} 데이터를 불러오는 중...</div>
}

function SeasonCountdownCard({ now, seasonEndAt }) {
  const seasonEndTime = getValidRecordTime(seasonEndAt)
  const archiveTargetAt = getArchiveTargetAt(seasonEndAt)

  return (
    <section className="season-countdown-card">
      <div>
        <span>시즌 종료까지</span>
        <strong>{seasonEndTime === null ? '확인 불가' : formatCountdown(seasonEndTime - now)}</strong>
      </div>
      <p>종료 예정: {formatShortDateTime(seasonEndAt)}</p>
      <p>최종 스냅샷 기준: {formatShortDateTime(archiveTargetAt)}</p>
    </section>
  )
}

function GuildStatusPage({ guildStats, now, selectedEntry, selectedGuildName }) {
  const isLoading = selectedEntry.guild.apiState?.status === 'loading'
  const seasonEndAt = getFirstSeasonEndAt(guildStats)

  return (
    <PageShell eyebrow="Staff Dashboard" title="길드 현황">
      <SeasonCountdownCard now={now} seasonEndAt={seasonEndAt} />
      {isLoading ? (
        <LoadingState guildName={selectedGuildName} />
      ) : (
        <section className="guild-summary-grid selected-summary-grid" aria-label={`${selectedGuildName} 길드 현황`}>
          <GuildSummaryCard guild={selectedEntry.guild} stats={selectedEntry.stats} summary={selectedEntry.staffData} />
        </section>
      )}
      <p className="selected-debug">현재 선택 길드: {selectedGuildName}</p>
      <StaffNotice />
    </PageShell>
  )
}

function NewMembersPage({ guildStats }) {
  const totalNewMembers = guildStats.reduce((sum, entry) => sum + entry.staffData.newMembers.length, 0)
  const totalNicknameWarnings = guildStats.reduce((sum, entry) => sum + entry.staffData.nicknameWarningMembers.length, 0)

  return (
    <PageShell eyebrow="New Members" title="신규 확인">
      <section className="staff-section">
        <div className="section-title">
          <span>시즌 중 신규 / 닉네임 양식</span>
          <h2>
            신규 {totalNewMembers}명 · 닉네임 확인 {totalNicknameWarnings}명
          </h2>
        </div>
        <p className="page-note">
          신규 기준은 API 가입 시간이 아니라 앱이 해당 닉네임을 처음 관측한 시각입니다. 시즌 중 신규는 남은 시즌 시간 기준 보정컷을 적용합니다.
        </p>
      </section>

      {guildStats.map(({ guild, staffData }, index) => (
        <section className="staff-section" key={`${guild.guildName}-new-members`}>
          <div className="section-title">
            <span>{getTierLabel(index)}</span>
            <h2>{guild.guildName}</h2>
          </div>

          <div className="staff-summary-block">
            <span>시즌 중 신규 관측</span>
            {staffData.newMembers.length === 0 ? (
              <p className="summary-empty">신규 관측 대상 없음</p>
            ) : (
              <div className="staff-card-list compact-list">
                {staffData.newMembers.map((member) => (
                  <article className="staff-row-card" key={`${guild.guildName}-new-${member.nickname}`}>
                    <div className="member-title-row">
                      <strong>{member.nickname}</strong>
                      <span className="status-badge">신규</span>
                    </div>
                    <dl className="mini-fields">
                      <div>
                        <dt>현재 점수</dt>
                        <dd>{formatNumber(member.score)}점</dd>
                      </div>
                      <div>
                        <dt>기본 컷</dt>
                        <dd>{formatNumber(guild.cutScore)}점</dd>
                      </div>
                      <div>
                        <dt>적용 컷</dt>
                        <dd>{formatNumber(member.effectiveCutScore)}점</dd>
                      </div>
                      <div>
                        <dt>부족</dt>
                        <dd>{formatNumber(Math.max(0, member.effectiveCutScore - member.score))}점</dd>
                      </div>
                      <div>
                        <dt>처음 확인</dt>
                        <dd>{formatDateTime(member.joinedDuringSeasonAt)}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="staff-summary-block">
            <span>닉네임 양식 확인</span>
            {staffData.nicknameWarningMembers.length === 0 ? (
              <p className="summary-empty">닉네임 양식 확인 대상 없음</p>
            ) : (
              <div className="staff-card-list compact-list">
                {staffData.nicknameWarningMembers.map((member) => (
                  <article className="staff-row-card" key={`${guild.guildName}-nickname-${member.nickname}`}>
                    <div className="member-title-row">
                      <strong>{member.nickname}</strong>
                      <span className="status-badge">SL_ 확인</span>
                    </div>
                    <span>현재 점수: {formatNumber(member.score)}점</span>
                    <p>권장 양식: SL_ 로 시작</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      ))}

      <StaffNotice />
    </PageShell>
  )
}

function MembersPage({ guilds }) {
  const [searchText, setSearchText] = useState('')
  const [manualLeaderKeys, setManualLeaderKeys] = useState(readManualLeaderKeys)
  const longPressTimersRef = useRef(new Map())
  const normalizedSearch = searchText.trim().toLowerCase()
  const activeGuilds = guilds.filter((guild) => guild.type === 'active')
  const restGuilds = guilds.filter((guild) => guild.type === 'rest')
  const allMembers = guilds.flatMap((guild) => guild.members.map((member) => ({ ...member, guildName: guild.guildName })))
  const nicknameWarnings = allMembers.filter((member) => !hasValidGuildNickname(member.nickname))
  const altAccountGroups = getAltAccountGroups(allMembers)
  const filterMembers = (members) =>
    normalizedSearch
      ? members.filter((member) => member.nickname.toLowerCase().includes(normalizedSearch))
      : members
  const matchedCount = normalizedSearch ? allMembers.filter((member) => member.nickname.toLowerCase().includes(normalizedSearch)).length : allMembers.length
  const totalActive = activeGuilds.reduce((sum, guild) => sum + guild.members.length, 0)
  const totalRest = restGuilds.reduce((sum, guild) => sum + guild.members.length, 0)
  const manualLeaderKeySet = useMemo(() => new Set(manualLeaderKeys), [manualLeaderKeys])

  const toggleManualLeader = useCallback((key) => {
    setManualLeaderKeys((current) => {
      const [guildName] = key.split(':')
      const nextSet = new Set(current.filter((currentKey) => !currentKey.startsWith(`${guildName}:`)))
      if (!current.includes(key)) nextSet.add(key)

      const next = [...nextSet]
      saveManualLeaderKeys(next)
      return next
    })
  }, [])

  const clearLongPress = useCallback((key) => {
    const timer = longPressTimersRef.current.get(key)
    if (timer) window.clearTimeout(timer)
    longPressTimersRef.current.delete(key)
  }, [])

  const startLongPress = useCallback(
    (key) => {
      clearLongPress(key)
      const timer = window.setTimeout(() => {
        toggleManualLeader(key)
        longPressTimersRef.current.delete(key)
      }, 650)
      longPressTimersRef.current.set(key, timer)
    },
    [clearLongPress, toggleManualLeader],
  )

  useEffect(
    () => () => {
      longPressTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      longPressTimersRef.current.clear()
    },
    [],
  )

  const sortMembersForDisplay = useCallback(
    (members, guildName) =>
      sortByScore(members).sort((a, b) => {
        const aIsManualLeader = manualLeaderKeySet.has(getManualLeaderKey(guildName, a.nickname))
        const bIsManualLeader = manualLeaderKeySet.has(getManualLeaderKey(guildName, b.nickname))
        return Number(bIsManualLeader) - Number(aIsManualLeader)
      }),
    [manualLeaderKeySet],
  )

  const renderGuildCard = (guild, index, labelPrefix) => (
    <section className="staff-section" key={`${guild.guildName}-member-list`}>
      {(() => {
        const visibleMembers = filterMembers(guild.members)

        return (
          <>
      <div className="section-title">
        <span>{labelPrefix} {index + 1}</span>
        <h2>
          {guild.guildName} · {visibleMembers.length}/{guild.members.length}명
        </h2>
      </div>
      {guild.apiState?.status === 'loading' ? (
        <LoadingState guildName={guild.guildName} />
      ) : visibleMembers.length === 0 ? (
        <EmptyState>길드원 데이터 없음</EmptyState>
      ) : (
        <ul className="member-name-list">
          {sortMembersForDisplay(visibleMembers, guild.guildName).map((member) => {
            const manualLeaderKey = getManualLeaderKey(guild.guildName, member.nickname)

            return (
              <li
                className={!member.nicknameFormatOk ? 'needs-check' : ''}
                key={`${guild.guildName}-${member.nickname}`}
                onContextMenu={(event) => event.preventDefault()}
                onPointerCancel={() => clearLongPress(manualLeaderKey)}
                onPointerDown={() => startLongPress(manualLeaderKey)}
                onPointerLeave={() => clearLongPress(manualLeaderKey)}
                onPointerUp={() => clearLongPress(manualLeaderKey)}
              >
                <span className="member-name-main">
                  <strong>{member.nickname}</strong>
                  <CrownBadge active={manualLeaderKeySet.has(manualLeaderKey)} />
                  {guild.type === 'active' && <StoppedFiveMinuteDot member={member} />}
                  <GuildLeaderBadge member={member} />
                </span>
                <span>{formatNumber(member.score)}{'\uC810'}</span>
              </li>
            )
          })}
        </ul>
      )}
          </>
        )
      })()}
    </section>
  )

  return (
    <PageShell eyebrow="Members" title="전체 인원">
      <section className="staff-section">
        <div className="section-title">
          <span>활동 4개 + 휴식 2개</span>
          <h2>전체 {allMembers.length}명</h2>
        </div>
        <div className="season-total-card">
          <strong>활동 {totalActive}명 · 휴식 {totalRest}명</strong>
          <span>닉네임 양식 확인 {nicknameWarnings.length}명 · 표시 {matchedCount}명</span>
        </div>
        <div className="member-legend">
          <span className="stopped-dot" aria-hidden="true" />
          <span>Red dot = 5min+ Defeat · minutes and check time shown · active guilds only</span>
        </div>
        <label className="member-search-box">
          <span>닉네임 검색</span>
          <input
            type="search"
            value={searchText}
            placeholder="예: SL_ 또는 Wish"
            onChange={(event) => setSearchText(event.target.value)}
          />
        </label>
      </section>

      <section className="staff-section">
        <div className="section-title">
          <span>컷 체크 대상</span>
          <h2>활동 길드</h2>
        </div>
      </section>
      {activeGuilds.map((guild, index) => renderGuildCard(guild, index, '활동'))}

      <section className="staff-section">
        <div className="section-title">
          <span>컷 제외 / 소속 확인용</span>
          <h2>휴식 길드</h2>
        </div>
      </section>
      {restGuilds.map((guild, index) => renderGuildCard(guild, index, '휴식'))}

      {nicknameWarnings.length > 0 && (
        <section className="staff-section">
          <div className="section-title">
            <span>SL_ 양식 미일치</span>
            <h2>닉네임 확인</h2>
          </div>
          <ul className="member-name-list">
            {nicknameWarnings.map((member) => (
              <li className="needs-check" key={`${member.guildName}-${member.nickname}-warning`}>
                <span className="member-name-main">
                  <strong>{member.nickname}</strong>
                  <CrownBadge active={manualLeaderKeySet.has(getManualLeaderKey(member.guildName, member.nickname))} />
                  <GuildLeaderBadge member={member} />
                </span>
                <span>{member.guildName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="staff-section">
        <div className="section-title">
          <span>{'SL / sL / 5L \uC811\uB450\uC5B4 \uC81C\uC678 \uD6C4 \uBE44\uAD50'}</span>
          <h2>{'\uBCF8\uACC4\uC815 / \uBD80\uACC4\uC815 \uC815\uB9AC'}</h2>
        </div>
        {altAccountGroups.length === 0 ? (
          <EmptyState>{'\uC77C\uCE58\uD558\uB294 \uB2C9\uB124\uC784 \uC5C6\uC74C'}</EmptyState>
        ) : (
          <div className="staff-card-list compact-list">
            {altAccountGroups.map((group) => {
              const mainMember = group.members[0]
              const subMembers = group.members.slice(1)

              return (
                <article className="staff-row-card account-group-card" key={`account-group-${group.key}`}>
                  <div className="member-title-row">
                    <strong>{group.displayName}</strong>
                    <span className="status-badge">{group.members.length}{'\uACC4\uC815'}</span>
                  </div>
                  <ul className="member-name-list">
                    <li>
                      <span className="member-name-main">
                        <strong>{mainMember.nickname}</strong>
                        <CrownBadge active={manualLeaderKeySet.has(getManualLeaderKey(mainMember.guildName, mainMember.nickname))} />
                        <AccountRelationBadge meta={{ isMain: true, label: '\uBCF8\uACC4\uC815' }} />
                        <GuildLeaderBadge member={mainMember} />
                      </span>
                      <span>{mainMember.guildName} / {formatNumber(mainMember.score)}{'\uC810'}</span>
                    </li>
                    {subMembers.map((member) => (
                      <li className={!member.nicknameFormatOk ? 'needs-check' : ''} key={`${member.guildName}-${member.nickname}-sub`}>
                        <span className="member-name-main">
                          <strong>{member.nickname}</strong>
                          <CrownBadge active={manualLeaderKeySet.has(getManualLeaderKey(member.guildName, member.nickname))} />
                          <AccountRelationBadge meta={{ isMain: false, label: '\uBD80\uACC4\uC815' }} />
                          <GuildLeaderBadge member={member} />
                        </span>
                        <span>{member.guildName} / {formatNumber(member.score)}{'\uC810'}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <StaffNotice />
    </PageShell>
  )
}

function FailureGroupList({ groups }) {
  return (
    <div className="season-record-groups">
      {groups.map((group) => (
        <section className="season-record-group" key={group.guildName}>
          <h3>
            {group.tierLabel} {group.guildName} / 기준 {formatNumber(group.cutScore)}
          </h3>
          {group.failedMembers.length === 0 ? (
            <p className="summary-empty">전원 기준 달성</p>
          ) : (
            <ul className="season-failure-list">
              {group.failedMembers.map((member) => (
                <li key={`${group.guildName}-${member.nickname}`}>
                  <strong>{member.nickname}</strong>
                  <span>
                    {formatNumber(member.score)}점 / {formatNumber(member.shortage)} 부족
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

function ArchiveDetail({ archive }) {
  const [copyStatus, setCopyStatus] = useState('')
  if (!archive) return null

  const groups = getArchiveFailureGroups(archive)
  const failedCount = groups.reduce((sum, group) => sum + group.failedMembers.length, 0)
  const noticeText = buildArchiveNoticeText(archive, groups)

  const copyNoticeText = async () => {
    try {
      await navigator.clipboard.writeText(noticeText)
      setCopyStatus('복사 완료')
    } catch {
      setCopyStatus('복사 실패')
    }
  }

  return (
    <section className="staff-section archive-history-detail">
      <div className="section-title">
        <span>과거 시즌 미달자</span>
        <h2>{formatSeasonButtonLabel(archive)}</h2>
      </div>
      <div className="season-total-card">
        <strong>총 미달자: {failedCount}명</strong>
        <span>저장: {formatDateTime(archive.savedAt)} · 자동 저장</span>
      </div>
      <FailureGroupList groups={groups} />
      <div className="copy-box archive-copy-box">
        <div className="copy-box-head">
          <strong>공지방 안내용</strong>
          <div className="copy-actions">
            {copyStatus && <span>{copyStatus}</span>}
            <button type="button" onClick={copyNoticeText}>
              복사
            </button>
          </div>
        </div>
        <pre>{noticeText}</pre>
      </div>
    </section>
  )
}

function AttentionPage({ archiveStatus, archives }) {
  const [selectedArchiveKey, setSelectedArchiveKey] = useState(null)
  const [isSeasonPickerOpen, setIsSeasonPickerOpen] = useState(false)
  const selectedArchive = archives.find((archive) => archive.seasonKey === selectedArchiveKey) || archives[0] || null

  return (
    <PageShell eyebrow="Season Records" title="시즌 기록">
      <section className="staff-section">
        <div className="section-title archive-title-row">
          <div>
            <span>시즌 종료 직전 자동 저장</span>
            <h2>과거 시즌 미달자 기록</h2>
          </div>
        </div>
        <p className="page-note">최대 10시즌까지 보관하며, 시즌 날짜를 누르면 해당 시즌 미달자 목록이 열립니다.</p>
        {archiveStatus && <p className="archive-status">{archiveStatus}</p>}
        {archives.length === 0 ? (
          <div className="empty-state compact-empty">
            저장된 과거 시즌 기록 없음
            <br />
            시즌 종료 직전 자동 스냅샷 저장 후 확인할 수 있습니다.
          </div>
        ) : (
          <div className="archive-season-picker">
            <button
              type="button"
              className={`archive-picker-current archive-card ${isSeasonPickerOpen ? 'active' : ''}`}
              onClick={() => setIsSeasonPickerOpen((open) => !open)}
            >
              <span className="archive-season-main">
                <small>시즌 선택</small>
                <strong>{formatSeasonButtonLabel(selectedArchive)}</strong>
                <small className="archive-tier-counts">
                  {getArchiveFailureCountText(getArchiveFailureGroups(selectedArchive))}
                </small>
              </span>
              <span className="archive-fail-count">
                미달 {getArchiveFailureGroups(selectedArchive).reduce((sum, group) => sum + group.failedMembers.length, 0)}명
              </span>
            </button>

            {isSeasonPickerOpen && (
              <div className="archive-picker-options">
                {archives.map((archive) => {
                  const groups = getArchiveFailureGroups(archive)
                  const failedCount = groups.reduce((sum, group) => sum + group.failedMembers.length, 0)
                  return (
                    <button
                      type="button"
                      className={`archive-card ${selectedArchive?.seasonKey === archive.seasonKey ? 'active' : ''}`}
                      key={archive.seasonKey}
                      onClick={() => {
                        setSelectedArchiveKey(archive.seasonKey)
                        setIsSeasonPickerOpen(false)
                      }}
                    >
                      <span className="archive-season-main">
                        <strong>{formatSeasonButtonLabel(archive)}</strong>
                        <small>{formatDateTime(archive.savedAt)} 저장</small>
                        <small className="archive-tier-counts">{getArchiveFailureCountText(groups)}</small>
                      </span>
                      <span className="archive-fail-count">미달 {failedCount}명</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <ArchiveDetail archive={selectedArchive} />
      <StaffNotice />
    </PageShell>
  )
}

function WphReportPage() {
  const [selectedGuildName, setSelectedGuildName] = useState('ShaLom')
  const [report, setReport] = useState(null)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let isMounted = true
    fetchWphReport()
      .then((payload) => {
        if (!isMounted) return
        setReport(payload)
        setStatus('ready')
      })
      .catch(() => {
        if (!isMounted) return
        setStatus('error')
      })

    return () => {
      isMounted = false
    }
  }, [])

  const selectedReport = report?.guilds?.[selectedGuildName] || null
  const wphSeasonLabel = selectedReport ? formatWphSeasonRange(selectedReport.seasonStartAt, selectedReport.seasonEndAt) : '55분 기준'
  const reportGuilds = activeGuildConfigs.slice(0, 3)
  const getRankLabel = (guildName) => {
    const rank = report?.guilds?.[guildName]?.rank
    return typeof rank === 'number' ? `#${rank}` : '#-'
  }

  return (
    <PageShell eyebrow="Guild Waves" title="WPH">
      <section className="staff-section">
        <div className="section-title">
          <span>{wphSeasonLabel}</span>
          <h2>길드 WPH</h2>
        </div>
        <div className="guild-tabs wph-guild-tabs">
          {reportGuilds.map((guild, index) => (
            <button
              type="button"
              className={selectedGuildName === guild.guildName ? 'active' : ''}
              key={guild.guildName}
              onClick={() => setSelectedGuildName(guild.guildName)}
            >
              {index + 1}군 {guild.guildName} {getRankLabel(guild.guildName)}
            </button>
          ))}
        </div>
      </section>

      <section className="staff-section">
        {status === 'loading' ? (
          <LoadingState guildName="WPH" />
        ) : status === 'error' ? (
          <EmptyState>WPH 기록 불러오기 실패</EmptyState>
        ) : !selectedReport || selectedReport.members.length === 0 ? (
          <EmptyState>WPH 기록 없음</EmptyState>
        ) : (
          <div className="wph-report-card">
            <div className="wph-report-head">
              <strong>🌊 {selectedGuildName} Guild Waves ({getRankLabel(selectedGuildName)}) 🌊</strong>
              <span>
                {formatWphSlotRange(selectedReport.windowStartAt, selectedReport.windowEndAt)}
              </span>
            </div>
            <ol className="wph-report-list">
              {selectedReport.members.map((member, index) => (
                <li key={`${selectedGuildName}-${member.nickname}`}>
                  <div className="wph-member-line">
                    <strong>
                      {index + 1}. {member.nickname}
                    </strong>
                    <span>
                      {member.skips} skips, {formatWphMinute(member.downMinutes)} down
                    </span>
                  </div>
                  <div className="wph-values-row">
                    {member.hourly.map((value, hourIndex) => (
                      <span key={`${member.nickname}-wph-${hourIndex}`}>
                        {typeof value === 'number' ? formatNumber(value) : '-'}
                      </span>
                    ))}
                    <strong>WPH {formatNumber(member.averageWph)}</strong>
                  </div>
                  <p className="wph-score-projection">{formatWphScoreProjection(member)}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
      <StaffNotice />
    </PageShell>
  )
}

function MoveCandidatesPage({ guildStats, isAllScope, selectedEntry, selectedGuildName }) {
  const { guild, staffData } = selectedEntry
  const allCandidates = sortMoveCandidates(guildStats.flatMap(({ staffData: entryStaffData }) => entryStaffData.moveCandidates))
  const candidates = isAllScope ? allCandidates : sortMoveCandidates(staffData.moveCandidates)
  const targetSlotMap = getTargetSlotMap(guildStats)
  const targetGroups = getMoveCandidateGroups(candidates, targetSlotMap)
  const titleLabel = isAllScope ? '전체 후보' : selectedGuildName

  return (
    <PageShell eyebrow="Move Candidates" title="이동 후보">
      <section className="staff-section">
        <div className="section-title">
          <span>확정이 아닌 참고 후보</span>
          <h2>
            {titleLabel} · {candidates.length}명
          </h2>
        </div>
        {candidates.length === 0 ? (
          <EmptyState>이동 후보 없음</EmptyState>
        ) : (
          <>
            <div className="move-summary-panel">
              {targetGroups.map((group) => (
                <article className="move-summary-card" key={group.guildName}>
                  <div className="move-summary-head">
                    <strong>{group.label} {group.guildName}</strong>
                    <span>
                      후보 {group.members.length}명 · 자리 {Math.max(0, group.slots.availableSlots)}개
                    </span>
                  </div>
                  <div className="move-summary-meta">
                    정원 {group.slots.memberCount}/{group.slots.maxMembers}
                    {group.slots.availableSlots <= 0 ? ' · 만원' : ''}
                  </div>
                  <ul className="move-summary-list">
                    {group.members.map((member) => (
                      <li key={`${member.currentGuild}-${member.nickname}-${member.recommendedGuild}-summary`}>
                        <span>{member.nickname}</span>
                        <strong>
                          {getTargetLabel(member.currentGuild)}→{getTargetLabel(member.recommendedGuild)} {formatNumber(member.projectedFinalScore)}점
                        </strong>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>

            {!isAllScope && (
              <div className="staff-card-list compact-list">
                {candidates.map((member, index) => (
                  <article className="staff-row-card move-card" key={`${member.currentGuild}-${member.nickname}-${member.recommendedGuild}`}>
                    <div className="member-title-row">
                      <strong>{member.nickname}</strong>
                      <span className="status-badge">우선 {index + 1} · {member.currentGuild} → {member.recommendedGuild}</span>
                    </div>
                    <dl className="mini-fields">
                      <div>
                        <dt>현재 소속</dt>
                        <dd>{member.currentGuild}</dd>
                      </div>
                      <div>
                        <dt>현재 점수</dt>
                        <dd>{formatNumber(member.currentScore)}점</dd>
                      </div>
                      <div>
                        <dt>추천 이동</dt>
                        <dd>{member.recommendedGuild}</dd>
                      </div>
                      <div>
                        <dt>목표 기준</dt>
                        <dd>{member.targetCutScore.toLocaleString()}점</dd>
                      </div>
                      <div>
                        <dt>예상 종료</dt>
                        <dd>{formatProjectedScore(member.projectedFinalScore)}</dd>
                      </div>
                      <div>
                        <dt>남은 시즌</dt>
                        <dd>{formatRemainingHours(member.remainingHours)}</dd>
                      </div>
                      <div>
                        <dt>사용 기준</dt>
                        <dd>{member.projectionBasis}</dd>
                      </div>
                      <div>
                        <dt>추천 기준</dt>
                        <dd>{member.recommendationBasis}</dd>
                      </div>
                      <div>
                        <dt>WPH</dt>
                        <dd>{formatWph(member)}</dd>
                      </div>
                    </dl>
                    <p>{member.reason}</p>
                    {SHOW_PROJECTION_DEBUG && (
                      <p className="prediction-debug">
                        previousScore: {formatNumber(member.previousScore)} · currentScore: {formatNumber(member.currentScore)} ·
                        scoreDelta: {formatNumber(member.scoreDelta)} · timeDeltaHours:{' '}
                        {typeof member.timeDeltaHours === 'number' ? member.timeDeltaHours.toFixed(2) : '-'} · scorePerHour:{' '}
                        {typeof member.scorePerHour === 'number' ? Math.round(member.scorePerHour).toLocaleString() : '-'} ·
                        remainingHours: {typeof member.remainingHours === 'number' ? member.remainingHours.toFixed(2) : '-'} ·
                        projectedFinalScore: {formatNumber(member.projectedFinalScore)} · projectionBasis: {member.projectionBasis}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <p className="selected-debug">현재 보기: {isAllScope ? '총 요약' : guild.guildName}</p>
      <StaffNotice />
    </PageShell>
  )
}

function App() {
  const [activePage, setActivePage] = useState('status')
  const [apiStates, setApiStates] = useState({})
  const [archiveStatus, setArchiveStatus] = useState('')
  const [archives, setArchives] = useState(readSeasonArchives)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const cutScores = useMemo(() => createDefaultCutScores(), [])
  const [guildData, setGuildData] = useState({})
  const [historyByGuild, setHistoryByGuild] = useState(() =>
    Object.fromEntries(guildConfigs.map((config) => [config.guildName, readScoreHistory(config.guildName)])),
  )
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [lastRefreshedAtByGuild, setLastRefreshedAtByGuild] = useState({})
  const [moveScope, setMoveScope] = useState(MOVE_SCOPE_ALL)
  const [selectedGuildName, setSelectedGuildName] = useState(activeGuildConfigs[0].guildName)
  const [serverWphReport, setServerWphReport] = useState(null)
  const [wphRecordsByGuild, setWphRecordsByGuild] = useState(() =>
    Object.fromEntries(guildConfigs.map((config) => [config.guildName, getLatestWphRecords(config.guildName)])),
  )
  const archiveSavingRef = useRef(false)
  const loadingGuildsRef = useRef(new Set())

  useEffect(() => {
    let isMounted = true
    fetchWphReport()
      .then((payload) => {
        if (isMounted) setServerWphReport(payload)
      })
      .catch(() => {
        if (isMounted) setServerWphReport(null)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const guilds = useMemo(
    () =>
      guildConfigs.map((config) => {
        const cutScore = cutScores[config.guildName] ?? config.defaultCutScore
        const hasApiData = Boolean(guildData[config.guildName])
        const data = guildData[config.guildName] || getFallbackGuild(config, cutScore)
        const history = historyByGuild[config.guildName] || {}
        const wphRecords = wphRecordsByGuild[config.guildName] || {}
        const seasonStart = parseSeasonStart(data.seasonPeriod)

        return {
          ...data,
          apiState: apiStates[config.guildName] || { status: 'idle' },
          cutScore,
          defaultCutScore: config.defaultCutScore,
          type: config.type,
          hasApiData,
          lastRefreshedAt: lastRefreshedAtByGuild[config.guildName] || null,
          members: hasApiData
            ? mergeMembersWithHistory(data.members || [], history, cutScore).map((member) => {
                const wph = wphRecords[member.nickname] || {
                  apiDate: null,
                  checkedAt: null,
                  fetchStatus: 'error',
                  lastRecordDate: null,
                  scoreDelta: null,
                  wave: null,
                  waveDelta: null,
                  wph: null,
                  wphStatus: '기록 확인 불가',
                }
                const cutMeta = getMemberCutMeta(member, data, cutScore)

                return {
                  ...member,
                  ...cutMeta,
                  lastRecordDate: wph.apiDate,
                  nicknameFormatOk: hasValidGuildNickname(member.nickname),
                  wph,
                  staffStatus: getStaffStatus({ ...member, ...cutMeta, wph }, cutScore, seasonStart),
                }
              })
            : [],
          order: config.order,
        }
      }),
    [apiStates, cutScores, guildData, historyByGuild, lastRefreshedAtByGuild, wphRecordsByGuild],
  )

  const staffByGuild = useMemo(
    () => Object.fromEntries(guilds.map((guild) => [guild.guildName, getGuildStaffData(guild, cutScores, serverWphReport)])),
    [cutScores, guilds, serverWphReport],
  )

  const guildStats = useMemo(
    () =>
      guilds.map((guild) => {
        const staffData = staffByGuild[guild.guildName]
        return {
          guild,
          hasApiData: guild.hasApiData,
          staffData,
          stats: getGuildStats(guild, staffData),
        }
      }),
    [guilds, staffByGuild],
  )

  const activeGuilds = useMemo(() => guilds.filter((guild) => guild.type === 'active'), [guilds])
  const activeGuildStats = useMemo(() => guildStats.filter(({ guild }) => guild.type === 'active'), [guildStats])

  const selectedConfig = activeGuildConfigs.find((config) => config.guildName === selectedGuildName) || activeGuildConfigs[0]
  const selectedEntry =
    activeGuildStats.find(({ guild }) => guild.guildName === selectedGuildName) ||
    activeGuildStats.find(({ guild }) => guild.guildName === selectedConfig.guildName)

  const updateApiState = useCallback((guildName, nextState) => {
    setApiStates((current) => ({ ...current, [guildName]: nextState }))
  }, [])

  const fetchPlayerRecordsForGuild = useCallback(async (guildName, members) => {
    const checkedAt = new Date().toISOString()
    const settled = await Promise.allSettled(members.map((member) => fetchPlayerSeason(member.nickname)))
    const nextRecords = {}
    let failedCount = 0

    settled.forEach((result, index) => {
      const member = members[index]
      if (result.status === 'fulfilled' && getValidRecordTime(result.value.apiDate) !== null) {
        nextRecords[member.nickname] = {
          apiDate: result.value.apiDate,
          checkedAt,
          fetchStatus: 'success',
          lastRecordDate: result.value.apiDate,
          personalScore: result.value.personalScore ?? null,
          score: member.score,
          wave: result.value.wave,
          wphStatus: '상세 확인 완료',
        }
      } else {
        failedCount += 1
        nextRecords[member.nickname] = {
          apiDate: null,
          checkedAt,
          errorMessage: result.reason?.message || '기록 확인 불가',
          fetchStatus: 'error',
          lastRecordDate: null,
          score: member.score,
          wave: null,
          wphStatus: '기록 확인 불가',
        }
      }
    })

    setWphRecordsByGuild((current) => ({ ...current, [guildName]: nextRecords }))
    return { failedCount, records: nextRecords }
  }, [])

  const refreshGuild = useCallback(
    async (config) => {
      if (loadingGuildsRef.current.has(config.guildName)) return null

      loadingGuildsRef.current.add(config.guildName)
      const cutScore = cutScores[config.guildName] ?? config.defaultCutScore
      updateApiState(config.guildName, { status: 'loading' })

      try {
        const data = await fetchGuildSeason(config, cutScore)
        const checkedAt = new Date().toISOString()
        const { failedCount: failedDetailCount, records: playerRecords } = await fetchPlayerRecordsForGuild(config.guildName, data.members)
        const membersWithLatestScore = data.members.map((member) => {
          const playerRecord = playerRecords[member.nickname] || {}
          return {
            ...member,
            lastRecordAt: playerRecord.apiDate || null,
            personalScore: typeof playerRecord.personalScore === 'number' ? playerRecord.personalScore : null,
            wave: typeof playerRecord.wave === 'number' ? playerRecord.wave : null,
          }
        })
        const nextData = { ...data, members: membersWithLatestScore }
        const nextHistory = compareAndSaveScoreHistory(config.guildName, membersWithLatestScore, {
          checkedAt,
          playerRecords,
          seasonEndAt: data.seasonEndAt,
        })
        setGuildData((current) => ({ ...current, [config.guildName]: nextData }))
        setHistoryByGuild((current) => ({ ...current, [config.guildName]: nextHistory }))
        setLastRefreshedAtByGuild((current) => ({ ...current, [config.guildName]: checkedAt }))
        updateApiState(config.guildName, {
          status: data.members.length === 0 ? 'empty' : 'success',
          title: data.members.length === 0 ? '데이터 없음' : '갱신 완료',
          message:
            failedDetailCount > 0
              ? `${config.guildName} 갱신 완료 · ${failedDetailCount}명 기록 확인 불가`
              : `${config.guildName} 최신 데이터입니다.`,
        })
        return nextData
      } catch (error) {
        updateApiState(config.guildName, {
          status: 'error',
          title: error.code === 'API_SHAPE' ? 'API 응답 이상' : '데이터 불러오기 실패',
          message:
            error.code === 'CORS_OR_NETWORK'
              ? '브라우저에서 API 호출이 차단되었습니다. 프록시 연결이 필요합니다.'
              : error.message || '데이터 불러오기 실패',
        })
        return null
      } finally {
        loadingGuildsRef.current.delete(config.guildName)
      }
    },
    [cutScores, fetchPlayerRecordsForGuild, updateApiState],
  )

  const saveSeasonArchive = useCallback(
    async () => {
      if (archiveSavingRef.current) return

      archiveSavingRef.current = true
      setArchiveStatus('자동 시즌 기록 저장 중...')

      try {
        const settled = await Promise.allSettled(activeGuildConfigs.map((config) => refreshGuild(config)))
        const archiveGuilds = settled.map((result, index) => {
          const config = activeGuildConfigs[index]
          const cutScore = cutScores[config.guildName] ?? config.defaultCutScore

          if (result.status === 'fulfilled' && result.value) {
            return {
              ...result.value,
              cutScore,
            }
          }

          return {
            cutScore,
            error: '데이터 불러오기 실패',
            guildName: config.guildName,
            members: [],
            seasonEndAt: null,
            seasonStartAt: null,
          }
        })
        const archive = createSeasonArchive(archiveGuilds, 'auto')
        const nextArchives = upsertSeasonArchive(archive)
        setArchives(nextArchives)
        setArchiveStatus('시즌 기록 저장 완료')
        window.setTimeout(() => setArchiveStatus(''), 2200)
      } catch {
        setArchiveStatus('시즌 기록 저장 실패')
      } finally {
        archiveSavingRef.current = false
      }
    },
    [cutScores, refreshGuild],
  )

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      refreshGuild(activeGuildConfigs[0])
    }, 0)
    return () => window.clearTimeout(timerId)
  }, [refreshGuild])

  useEffect(() => {
    const timerId = window.setInterval(() => setClockNow(Date.now()), 60 * 1000)
    return () => window.clearInterval(timerId)
  }, [])

  useEffect(() => {
    let isMounted = true
    fetchSharedSeasonArchives().then((sharedArchives) => {
      if (isMounted && sharedArchives.length > 0) setArchives(sharedArchives)
    })
    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (activePage !== 'status') return
    const config = activeGuildConfigs.find((item) => item.guildName === selectedGuildName) || activeGuildConfigs[0]
    const timerId = window.setTimeout(() => refreshGuild(config), 0)
    return () => window.clearTimeout(timerId)
  }, [activePage, refreshGuild, selectedGuildName])

  useEffect(() => {
    if (activePage !== 'attention' && activePage !== 'new-members' && activePage !== 'moves') return
    activeGuildConfigs.forEach((config) => {
      if (!guildData[config.guildName]) refreshGuild(config)
    })
  }, [activePage, guildData, refreshGuild])

  useEffect(() => {
    if (activePage !== 'members') return
    guildConfigs.forEach((config) => {
      if (!guildData[config.guildName]) refreshGuild(config)
    })
  }, [activePage, guildData, refreshGuild])

  useEffect(() => {
    if (activePage !== 'attention') return
    if (!shouldAutoArchive(guilds, archives)) return
    const timerId = window.setTimeout(() => saveSeasonArchive(), 0)
    return () => window.clearTimeout(timerId)
  }, [activePage, archives, guilds, saveSeasonArchive])

  const handleGuildChange = (guildName) => {
    if (guildName === MOVE_SCOPE_ALL) {
      setMoveScope(MOVE_SCOPE_ALL)
      activeGuildConfigs.forEach((config) => {
        if (!guildData[config.guildName]) refreshGuild(config)
      })
      return
    }

    setMoveScope(guildName)
    setSelectedGuildName(guildName)
    const nextConfig = activeGuildConfigs.find((config) => config.guildName === guildName)
    if (nextConfig) refreshGuild(nextConfig)
  }

  const handleSelectPage = (pageId) => {
    setActivePage(pageId)
    setIsMenuOpen(false)

    if (pageId === 'moves') {
      setMoveScope(MOVE_SCOPE_ALL)
      activeGuildConfigs.forEach((config) => refreshGuild(config))
    } else if (pageId === 'status') {
      refreshGuild(selectedConfig)
    }

    if (pageId === 'new-members') {
      activeGuildConfigs.forEach((config) => refreshGuild(config))
    }

    if (pageId === 'members') {
      guildConfigs.forEach((config) => refreshGuild(config))
    }
  }

  return (
    <div className="app">
      <AppHeader isMenuOpen={isMenuOpen} onLogoClick={() => handleSelectPage('status')} onMenuToggle={() => setIsMenuOpen((open) => !open)} />
      <MenuDrawer activePage={activePage} isOpen={isMenuOpen} items={menuItems} onSelect={handleSelectPage} />
      {isMenuOpen && <button type="button" className="drawer-backdrop" aria-label="메뉴 닫기" onClick={() => setIsMenuOpen(false)} />}

      <main className="main-content">
        {activePage !== 'attention' && activePage !== 'new-members' && activePage !== 'members' && activePage !== 'wph' && (
          <>
            {activePage === 'moves' && (
              <button
                type="button"
                className={`move-scope-strip ${moveScope === MOVE_SCOPE_ALL ? 'active' : ''}`}
                onClick={() => handleGuildChange(MOVE_SCOPE_ALL)}
              >
                총 요약 · 1~4군 전체 이동 후보
              </button>
            )}
            <GuildSelector
              guilds={activeGuilds}
              selectedGuildName={activePage === 'moves' && moveScope === MOVE_SCOPE_ALL ? '' : selectedGuildName}
              onChange={handleGuildChange}
            />
            {!(activePage === 'moves' && moveScope === MOVE_SCOPE_ALL) && (
              <DataNotice state={getApiNotice(selectedGuildName, selectedEntry.guild.apiState)} />
            )}
          </>
        )}

        {activePage === 'status' && (
          <GuildStatusPage
            guildStats={activeGuildStats}
            now={clockNow}
            selectedEntry={selectedEntry}
            selectedGuildName={selectedGuildName}
          />
        )}
        {activePage === 'new-members' && <NewMembersPage guildStats={activeGuildStats} />}
        {activePage === 'members' && <MembersPage guilds={guilds} />}
        {activePage === 'attention' && (
          <AttentionPage
            archiveStatus={archiveStatus}
            archives={archives}
          />
        )}
        {activePage === 'moves' && (
          <MoveCandidatesPage
            guildStats={activeGuildStats}
            isAllScope={moveScope === MOVE_SCOPE_ALL}
            selectedEntry={selectedEntry}
            selectedGuildName={selectedGuildName}
          />
        )}
        {activePage === 'wph' && <WphReportPage />}
      </main>
    </div>
  )
}

export default App
