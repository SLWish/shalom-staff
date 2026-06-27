import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import AppHeader from './components/AppHeader.jsx'
import CutScorePanel from './components/CutScorePanel.jsx'
import DataNotice from './components/DataNotice.jsx'
import GuildSelector from './components/GuildSelector.jsx'
import GuildSummaryCard from './components/GuildSummaryCard.jsx'
import MenuDrawer from './components/MenuDrawer.jsx'
import PageShell from './components/PageShell.jsx'
import { guildConfigs, menuItems } from './config/guildConfig.js'
import { fallbackGuilds } from './data/fallbackGuilds.js'
import { fetchGuildSeason, fetchPlayerSeason } from './services/growCastleApi.js'
import {
  clearAllScoreHistory,
  compareAndSaveScoreHistory,
  mergeMembersWithHistory,
  readScoreHistory,
} from './services/scoreHistory.js'
import { createSeasonArchive, readSeasonArchives, shouldAutoArchive, upsertSeasonArchive } from './services/seasonArchive.js'
import { fetchSharedSeasonArchives } from './services/serverHistoryApi.js'
import { clearWphHistory, getLatestWphRecords } from './services/wphHistory.js'

const CUT_SCORE_STORAGE_KEY = 'shalom-info-cut-scores'
const INACTIVE_HOURS_THRESHOLD = 6
const GUILD_ORDER = ['ShaLom', 'ShaLom2', 'ShaLom3', 'ShaLom4']
const MAX_GUILD_MEMBERS = 20
const SHOW_PROJECTION_DEBUG = false

function createDefaultCutScores() {
  return Object.fromEntries(guildConfigs.map((config) => [config.guildName, config.defaultCutScore]))
}

function readSavedCutScores() {
  if (typeof window === 'undefined') return createDefaultCutScores()

  try {
    return {
      ...createDefaultCutScores(),
      ...JSON.parse(window.localStorage.getItem(CUT_SCORE_STORAGE_KEY) || '{}'),
    }
  } catch {
    return createDefaultCutScores()
  }
}


function getFallbackGuild(config, cutScore) {
  const fallback = fallbackGuilds.find((guild) => guild.guildName === config.guildName)
  return {
    guildName: config.guildName,
    seasonEndAt: fallback?.seasonEndAt || null,
    seasonPeriod: fallback?.seasonPeriod || '현재 시즌',
    cutScore,
    members: fallback?.members || [],
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

function getDiffHoursFromApiDate(apiDate) {
  const recordTime = getValidRecordTime(apiDate)
  if (recordTime === null) return null
  return Math.max(0, (Date.now() - recordTime) / 36e5)
}

function formatInactiveDuration(diffHours) {
  if (diffHours === null) return '기록 확인 불가'
  const totalMinutes = Math.max(0, Math.floor(diffHours * 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 1) return `${minutes}분`
  if (hours < 24) return `${hours}시간 ${minutes}분`
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간`
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
  if (activity.activityStatus === '기록 확인 불가') return '기록 확인 불가'
  if (activity.seasonNotJoined) return '시즌 미참여'
  if (member.score < cutScore) return '컷 미달'
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

function getCapacityStatus(memberCount) {
  const availableSlots = MAX_GUILD_MEMBERS - memberCount
  if (availableSlots > 0) return `${availableSlots}자리 남음`
  if (availableSlots === 0) return '만원'
  return '정원 초과'
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

function getTargetLabel(guildName) {
  const order = GUILD_ORDER.indexOf(guildName)
  return order >= 0 ? `${order + 1}군` : guildName
}

function getMoveTarget(guildName, currentScore, trend, cutScores) {
  const currentIndex = GUILD_ORDER.indexOf(guildName)
  if (currentIndex <= 0) return null

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
  return null
}

function getMoveCandidatesForGuild(guild, cutScores) {
  const remainingHours = getRemainingHours(guild.seasonEndAt)

  return sortByScore(guild.members)
    .map((member) => {
      const trend = getScoreTrend(member)
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
}

function getGuildStaffData(guild, cutScores) {
  const seasonStart = parseSeasonStart(guild.seasonPeriod)
  const shortageMembers = sortShortageMembers(
    guild.members
      .filter((member) => member.score < guild.cutScore)
      .map((member) => ({
        ...member,
        shortage: guild.cutScore - member.score,
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
    moveCandidates: getMoveCandidatesForGuild(guild, cutScores),
    seasonNotJoinedMembers: sortInactiveMembers(activityMembers.filter((member) => member.seasonNotJoined)),
    shortageMembers,
    unverifiedMembers: sortByScore(activityMembers.filter((member) => member.diffHours === null)),
  }
}

function getGuildStats(guild, staffData) {
  const totalScore = guild.members.reduce((sum, member) => sum + member.score, 0)
  const memberCount = guild.members.length
  const achievedCount = guild.members.filter((member) => member.score >= guild.cutScore).length
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

function getFailureSummaryText(groups, title = '현재 시즌 미달자 요약') {
  const totalFailed = groups.reduce((sum, group) => sum + group.failedMembers.length, 0)
  const countLine = groups.map((group) => `${group.tierLabel} ${group.failedMembers.length}명`).join(' · ')
  const groupLines = groups
    .map((group) => {
      const memberLines =
        group.failedMembers.length === 0
          ? ['전원 기준 달성']
          : group.failedMembers.map((member) => `${member.nickname} ${formatNumber(member.score)}점 / ${formatNumber(member.shortage)} 부족`)

      return [`[${group.tierLabel} ${group.guildName} / 기준 ${formatNumber(group.cutScore)}]`, ...memberLines].join('\n')
    })
    .join('\n\n')

  return [`[${title}]`, `총 미달자: ${totalFailed}명`, countLine, '', groupLines].join('\n')
}

function getSelectedGuildEntry(guildStats, selectedGuildName) {
  return guildStats.find(({ guild }) => guild.guildName === selectedGuildName) || guildStats[0]
}

function getSelectedGuildIndex(guildStats, selectedGuildName) {
  const index = guildStats.findIndex(({ guild }) => guild.guildName === selectedGuildName)
  return index >= 0 ? index : 0
}

function getRiskNoticeForEntry(entry, index, now) {
  const { guild, staffData, stats } = entry
  const seasonEndAt = guild.seasonEndAt
  const seasonEndTime = getValidRecordTime(seasonEndAt)
  const remainingText = seasonEndTime === null ? '확인 불가' : formatCountdown(seasonEndTime - now)
  const shortageLines =
    staffData.shortageMembers.length === 0
      ? ['전원 기준 달성']
      : staffData.shortageMembers.map((member) => `${member.nickname} ${formatNumber(member.score)}점 / ${formatNumber(member.shortage)} 부족`)
  const inactiveLines =
    staffData.inactiveMembers.length === 0
      ? ['없음']
      : staffData.inactiveMembers.map((member) => `${member.nickname} ${member.inactiveText}`)

  return [
    `[${getTierLabel(index)} ${guild.guildName} 컷 체크]`,
    `시즌 종료까지: ${remainingText}`,
    `기준: ${formatNumber(guild.cutScore)} / 정원 ${stats.memberCount}/${stats.maxMembers} · ${getCapacityStatus(stats.memberCount)}`,
    '',
    '미달자:',
    ...shortageLines,
    '',
    '6시간 이상 미활동:',
    ...inactiveLines,
  ].join('\n')
}

function getDashboardNoticeText(guildStats, now) {
  const seasonEndAt = getFirstSeasonEndAt(guildStats)
  const seasonEndTime = getValidRecordTime(seasonEndAt)
  const remainingText = seasonEndTime === null ? '확인 불가' : formatCountdown(seasonEndTime - now)
  const cutLine = guildStats
    .map(({ guild }, index) => `${getTierLabel(index)} ${formatNumber(guild.cutScore)}`)
    .join(' / ')
  const guildLines = guildStats
    .map(({ guild, staffData, stats }, index) => {
      const shortageLines =
        staffData.shortageMembers.length === 0
          ? ['전원 기준 달성']
          : staffData.shortageMembers.map(
              (member) => `${member.nickname} ${formatNumber(member.score)}점 / ${formatNumber(member.shortage)} 부족`,
            )
      const inactiveLines =
        staffData.inactiveMembers.length === 0
          ? ['없음']
          : staffData.inactiveMembers.map((member) => `${member.nickname} ${member.inactiveText}`)

      return [
        `[${getTierLabel(index)} ${guild.guildName} / 기준 ${formatNumber(guild.cutScore)} / 정원 ${stats.memberCount}/${stats.maxMembers} · ${getCapacityStatus(stats.memberCount)}]`,
        '미달자:',
        ...shortageLines,
        '',
        '6시간 이상 미활동:',
        ...inactiveLines,
      ].join('\n')
    })
    .join('\n\n')

  return ['[ShaLom 시즌 컷 체크]', '', `시즌 종료까지: ${remainingText}`, `기준: ${cutLine}`, '', guildLines].join('\n')
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

function StaffNoticeBox({ guildStats, now, selectedGuildName }) {
  const noticeText = getDashboardNoticeText(guildStats, now)
  const selectedEntry = getSelectedGuildEntry(guildStats, selectedGuildName)
  const selectedIndex = getSelectedGuildIndex(guildStats, selectedGuildName)
  const selectedNoticeText = getRiskNoticeForEntry(selectedEntry, selectedIndex, now)
  const totalShortage = guildStats.reduce((sum, entry) => sum + entry.staffData.shortageMembers.length, 0)
  const totalInactive = guildStats.reduce((sum, entry) => sum + entry.staffData.inactiveMembers.length, 0)
  const totalMoveCandidates = guildStats.reduce((sum, entry) => sum + entry.staffData.moveCandidates.length, 0)
  const { guild: selectedGuild, staffData: selectedStaffData, stats: selectedStats } = selectedEntry

  return (
    <PageShell eyebrow="Staff Notice" title="위험도 요약">
      <section className="risk-overview-grid">
        <article>
          <span>컷 미달</span>
          <strong>{totalShortage}명</strong>
        </article>
        <article>
          <span>6시간 미활동</span>
          <strong>{totalInactive}명</strong>
        </article>
        <article>
          <span>이동 후보</span>
          <strong>{totalMoveCandidates}명</strong>
        </article>
      </section>
      <section className="staff-section selected-risk-panel">
        <div className="copy-box-head">
          <div className="section-title">
            <span>상단 길드 탭 선택 기준</span>
            <h2>
              {getTierLabel(selectedIndex)} {selectedGuild.guildName} 요약
            </h2>
          </div>
          <CopyButton text={selectedNoticeText} />
        </div>
        <div className="risk-guild-card selected">
          <p>
            기준 {formatNumber(selectedGuild.cutScore)} · 정원 {selectedStats.memberCount}/{selectedStats.maxMembers} · 미달{' '}
            {selectedStaffData.shortageMembers.length}명 · 미활동 {selectedStaffData.inactiveMembers.length}명
          </p>
          <pre>{selectedNoticeText}</pre>
        </div>
      </section>
      <section className="staff-section notice-generator">
        <div className="section-title">
          <span>길드별 확인 대상</span>
          <h2>길드별 위험도</h2>
        </div>
        <div className="risk-guild-list">
          {guildStats.map(({ guild, staffData, stats }, index) => (
            <article className="risk-guild-card" key={guild.guildName}>
              <h3>
                {getTierLabel(index)} {guild.guildName}
              </h3>
              <p>
                기준 {formatNumber(guild.cutScore)} · 정원 {stats.memberCount}/{stats.maxMembers} · 미달 {staffData.shortageMembers.length}명 · 미활동{' '}
                {staffData.inactiveMembers.length}명
              </p>
              <div>
                <strong>미달자</strong>
                {staffData.shortageMembers.length === 0 ? (
                  <span>전원 기준 달성</span>
                ) : (
                  <ul>
                    {staffData.shortageMembers.map((member) => (
                      <li key={`${guild.guildName}-short-${member.nickname}`}>
                        {member.nickname} {formatNumber(member.score)}점 / {formatNumber(member.shortage)} 부족
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <strong>6시간 이상 미활동</strong>
                {staffData.inactiveMembers.length === 0 ? (
                  <span>없음</span>
                ) : (
                  <ul>
                    {staffData.inactiveMembers.map((member) => (
                      <li key={`${guild.guildName}-inactive-${member.nickname}`}>
                        {member.nickname} {member.inactiveText}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="staff-section notice-generator">
      <div className="copy-box-head">
        <div className="section-title">
          <span>4개 길드 전체 기준</span>
          <h2>복붙용 공지</h2>
        </div>
        <CopyButton text={noticeText} />
      </div>
      <pre>{noticeText}</pre>
      </section>
    </PageShell>
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

function CopyButton({ text }) {
  const [copyStatus, setCopyStatus] = useState('')

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('복사 완료')
      window.setTimeout(() => setCopyStatus(''), 1800)
    } catch {
      setCopyStatus('복사 실패')
      window.setTimeout(() => setCopyStatus(''), 1800)
    }
  }

  return (
    <div className="copy-actions">
      <button type="button" onClick={handleCopy}>
        복사
      </button>
      {copyStatus && <span>{copyStatus}</span>}
    </div>
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
  if (!archive) return null

  const groups = getArchiveFailureGroups(archive)
  const summaryText = getFailureSummaryText(groups, `${formatSeasonButtonLabel(archive)} 미달자 기록`)
  const failedCount = groups.reduce((sum, group) => sum + group.failedMembers.length, 0)

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
      <div className="copy-box">
        <div className="copy-box-head">
          <strong>복붙용 요약</strong>
          <CopyButton text={summaryText} />
        </div>
        <pre>{summaryText}</pre>
      </div>
    </section>
  )
}

function AttentionPage({ archiveStatus, archives }) {
  const [selectedArchiveKey, setSelectedArchiveKey] = useState(null)
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
        <p className="page-note">최대 5시즌까지 보관하며, 현재 시즌이 아닌 저장된 과거 시즌 미달자만 보여줍니다.</p>
        {archiveStatus && <p className="archive-status">{archiveStatus}</p>}
        {archives.length === 0 ? (
          <div className="empty-state compact-empty">
            저장된 과거 시즌 기록 없음
            <br />
            시즌 종료 직전 자동 스냅샷 저장 후 확인할 수 있습니다.
          </div>
        ) : (
          <div className="archive-card-list">
            {archives.map((archive) => {
              const groups = getArchiveFailureGroups(archive)
              const failedCount = groups.reduce((sum, group) => sum + group.failedMembers.length, 0)
              return (
                <button
                  type="button"
                  className={`archive-card ${selectedArchive?.seasonKey === archive.seasonKey ? 'active' : ''}`}
                  key={archive.seasonKey}
                  onClick={() => setSelectedArchiveKey(archive.seasonKey)}
                >
                  <strong>{formatSeasonButtonLabel(archive)}</strong>
                  <span>총 미달자 {failedCount}명</span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <ArchiveDetail archive={selectedArchive} />
      <StaffNotice />
    </PageShell>
  )
}

function MoveCandidatesPage({ selectedEntry, selectedGuildName }) {
  const { guild, staffData } = selectedEntry
  return (
    <PageShell eyebrow="Move Candidates" title="이동 후보">
      <section className="staff-section">
        <div className="section-title">
          <span>확정이 아닌 참고 후보</span>
          <h2>
            {selectedGuildName} · {staffData.moveCandidates.length}명
          </h2>
        </div>
        {staffData.moveCandidates.length === 0 ? (
          <EmptyState>이동 후보 없음</EmptyState>
        ) : (
          <div className="staff-card-list compact-list">
            {staffData.moveCandidates.map((member) => (
              <article className="staff-row-card move-card" key={`${member.currentGuild}-${member.nickname}-${member.recommendedGuild}`}>
                <div className="member-title-row">
                  <strong>{member.nickname}</strong>
                  <span className="status-badge">{member.currentGuild} → {member.recommendedGuild}</span>
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
      </section>
      <p className="selected-debug">현재 선택 길드: {guild.guildName}</p>
      <StaffNotice />
    </PageShell>
  )
}

function SettingsPage({
  cutScores,
  onClearActivityCache,
  onClearPredictionHistory,
  onClearScoreAndWphHistory,
  onCutScoreChange,
  onCutScoreReset,
  onRefreshAllGuilds,
  onRefreshSelectedGuild,
  selectedGuildName,
}) {
  return (
    <PageShell eyebrow="Staff Settings" title="설정">
      <section className="settings-grid">
        {guildConfigs.map((config) => (
          <CutScorePanel
            cutScore={cutScores[config.guildName] ?? config.defaultCutScore}
            defaultCutScore={config.defaultCutScore}
            guildName={config.guildName}
            key={config.guildName}
            onChange={(value) => onCutScoreChange(config.guildName, value)}
            onReset={() => onCutScoreReset(config)}
          />
        ))}
      </section>
      <section className="refresh-panel settings-actions">
        <button type="button" onClick={onRefreshSelectedGuild}>
          {selectedGuildName} 새로고침
        </button>
        <button type="button" onClick={onRefreshAllGuilds}>
          전체 길드 새로고침
        </button>
        <button type="button" className="danger-button" onClick={onClearActivityCache}>
          활동 기록 캐시 초기화
        </button>
        <button type="button" className="danger-button" onClick={onClearPredictionHistory}>
          예측 기록 초기화
        </button>
        <button type="button" className="danger-button" onClick={onClearScoreAndWphHistory}>
          WPH/score 기록 초기화
        </button>
        <p className="page-note">1분 자동 새로고침은 사용하지 않습니다.</p>
      </section>
    </PageShell>
  )
}

function App() {
  const [activePage, setActivePage] = useState('status')
  const [apiStates, setApiStates] = useState({})
  const [archiveStatus, setArchiveStatus] = useState('')
  const [archives, setArchives] = useState(readSeasonArchives)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [cutScores, setCutScores] = useState(readSavedCutScores)
  const [guildData, setGuildData] = useState({})
  const [historyByGuild, setHistoryByGuild] = useState(() =>
    Object.fromEntries(guildConfigs.map((config) => [config.guildName, readScoreHistory(config.guildName)])),
  )
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [lastRefreshedAtByGuild, setLastRefreshedAtByGuild] = useState({})
  const [selectedGuildName, setSelectedGuildName] = useState(guildConfigs[0].guildName)
  const [wphRecordsByGuild, setWphRecordsByGuild] = useState(() =>
    Object.fromEntries(guildConfigs.map((config) => [config.guildName, getLatestWphRecords(config.guildName)])),
  )
  const archiveSavingRef = useRef(false)
  const loadingGuildsRef = useRef(new Set())

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

                return {
                  ...member,
                  lastRecordDate: wph.apiDate,
                  wph,
                  staffStatus: getStaffStatus({ ...member, wph }, cutScore, seasonStart),
                }
              })
            : [],
          order: config.order,
        }
      }),
    [apiStates, cutScores, guildData, historyByGuild, lastRefreshedAtByGuild, wphRecordsByGuild],
  )

  const staffByGuild = useMemo(
    () => Object.fromEntries(guilds.map((guild) => [guild.guildName, getGuildStaffData(guild, cutScores)])),
    [cutScores, guilds],
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

  const selectedConfig = guildConfigs.find((config) => config.guildName === selectedGuildName) || guildConfigs[0]
  const selectedEntry =
    guildStats.find(({ guild }) => guild.guildName === selectedGuildName) ||
    guildStats.find(({ guild }) => guild.guildName === selectedConfig.guildName)

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
          score: result.value.score ?? member.score,
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
          const playerScore = Number(playerRecord.score)
          return {
            ...member,
            lastRecordAt: playerRecord.apiDate || null,
            score: Number.isFinite(playerScore) ? playerScore : member.score,
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

  const refreshAllGuilds = useCallback(() => {
    guildConfigs.forEach((config) => refreshGuild(config))
  }, [refreshGuild])

  const saveSeasonArchive = useCallback(
    async () => {
      if (archiveSavingRef.current) return

      archiveSavingRef.current = true
      setArchiveStatus('자동 시즌 기록 저장 중...')

      try {
        const settled = await Promise.allSettled(guildConfigs.map((config) => refreshGuild(config)))
        const archiveGuilds = settled.map((result, index) => {
          const config = guildConfigs[index]
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
      refreshGuild(guildConfigs[0])
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
    if (activePage !== 'status' && activePage !== 'risk') return
    guildConfigs.forEach((config) => {
      if (!guildData[config.guildName]) refreshGuild(config)
    })
  }, [activePage, guildData, refreshGuild])

  useEffect(() => {
    if (activePage !== 'attention') return
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
    setSelectedGuildName(guildName)
    const nextConfig = guildConfigs.find((config) => config.guildName === guildName)
    if (nextConfig) refreshGuild(nextConfig)
  }

  const handleCutScoreChange = (guildName, value) => {
    const nextScores = { ...cutScores, [guildName]: Math.max(0, Math.round(value)) }
    setCutScores(nextScores)
    window.localStorage.setItem(CUT_SCORE_STORAGE_KEY, JSON.stringify(nextScores))
  }

  const handleCutScoreReset = (config) => handleCutScoreChange(config.guildName, config.defaultCutScore)

  const clearScoreHistoryState = () => {
    clearAllScoreHistory(guildConfigs.map((config) => config.guildName))
    setHistoryByGuild(Object.fromEntries(guildConfigs.map((config) => [config.guildName, {}])))
  }

  const clearProjectionStorageState = () => {
    if (typeof window === 'undefined') return
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('shalomInfo_projectionHistory_'))
      .forEach((key) => window.localStorage.removeItem(key))
  }

  const clearWphHistoryState = () => {
    guildConfigs.forEach((config) => clearWphHistory(config.guildName))
    setWphRecordsByGuild(Object.fromEntries(guildConfigs.map((config) => [config.guildName, {}])))
  }

  const handleClearActivityCache = () => {
    clearWphHistoryState()
  }

  const handleClearScoreAndWphHistory = () => {
    clearScoreHistoryState()
    clearProjectionStorageState()
    clearWphHistoryState()
  }

  const handleClearPredictionHistory = () => {
    clearScoreHistoryState()
    clearProjectionStorageState()
  }

  const handleSelectPage = (pageId) => {
    setActivePage(pageId)
    setIsMenuOpen(false)
  }

  return (
    <div className="app">
      <AppHeader isMenuOpen={isMenuOpen} onLogoClick={() => handleSelectPage('status')} onMenuToggle={() => setIsMenuOpen((open) => !open)} />
      <MenuDrawer activePage={activePage} isOpen={isMenuOpen} items={menuItems} onSelect={handleSelectPage} />
      {isMenuOpen && <button type="button" className="drawer-backdrop" aria-label="메뉴 닫기" onClick={() => setIsMenuOpen(false)} />}

      <main className="main-content">
        <GuildSelector guilds={guilds} selectedGuildName={selectedGuildName} onChange={handleGuildChange} />
        <DataNotice state={getApiNotice(selectedGuildName, selectedEntry.guild.apiState)} />

        {activePage === 'status' && (
          <GuildStatusPage
            guildStats={guildStats}
            now={clockNow}
            selectedEntry={selectedEntry}
            selectedGuildName={selectedGuildName}
          />
        )}
        {activePage === 'risk' && <StaffNoticeBox guildStats={guildStats} now={clockNow} selectedGuildName={selectedGuildName} />}
        {activePage === 'attention' && (
          <AttentionPage
            archiveStatus={archiveStatus}
            archives={archives}
          />
        )}
        {activePage === 'moves' && <MoveCandidatesPage selectedEntry={selectedEntry} selectedGuildName={selectedGuildName} />}
        {activePage === 'settings' && (
          <SettingsPage
            cutScores={cutScores}
            onClearActivityCache={handleClearActivityCache}
            onClearPredictionHistory={handleClearPredictionHistory}
            onClearScoreAndWphHistory={handleClearScoreAndWphHistory}
            onCutScoreChange={handleCutScoreChange}
            onCutScoreReset={handleCutScoreReset}
            onRefreshAllGuilds={refreshAllGuilds}
            onRefreshSelectedGuild={() => refreshGuild(selectedConfig)}
            selectedGuildName={selectedGuildName}
          />
        )}
      </main>
    </div>
  )
}

export default App
