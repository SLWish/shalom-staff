/* global process */

import { fetchGuildRoster, fetchGuildSeason, guildConfigs } from './_shared/growCastle.js'
import { insertRows, selectRows } from './_shared/supabaseRest.js'

const MAX_MEMBERS = 20
const INACTIVE_HOURS = 6

function json(statusCode, body) {
  return {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    statusCode,
  }
}

function isAuthorized(event) {
  const secret = process.env.COLLECT_SECRET
  const headerSecret = event.headers.authorization?.replace(/^Bearer\s+/i, '')
  const querySecret = event.queryStringParameters?.secret
  const isScheduled = event.headers['x-netlify-event'] === 'schedule'

  return isScheduled || !secret || headerSecret === secret || querySecret === secret
}

function getSeasonKey(guilds) {
  const seasonStart = guilds.find((guild) => guild.seasonStartAt)?.seasonStartAt || 'unknown-start'
  const seasonEnd = guilds.find((guild) => guild.seasonEndAt)?.seasonEndAt || 'unknown-end'
  return `${String(seasonStart).slice(0, 10)}_${String(seasonEnd).slice(0, 10)}`
}

function getInactiveMinutes(apiDate, capturedAt) {
  if (!apiDate) return null
  const diffMs = new Date(capturedAt).getTime() - new Date(apiDate).getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) return null
  return Math.floor(diffMs / 60000)
}

function buildRows(guilds, capturedAt) {
  const seasonKey = getSeasonKey(guilds)
  const guildRows = []
  const memberRows = []

  guilds.forEach((guild) => {
    const members = guild.members || []
    const totalScore = members.reduce((sum, member) => sum + (Number(member.score) || 0), 0)
    const achievedCount = members.filter((member) => Number(member.score) >= guild.cutScore).length
    const inactiveCount = members.filter((member) => {
      const inactiveMinutes = getInactiveMinutes(member.apiDate, capturedAt)
      return inactiveMinutes !== null && inactiveMinutes >= INACTIVE_HOURS * 60
    }).length

    guildRows.push({
      achieved_count: achievedCount,
      average_score: members.length > 0 ? Math.round(totalScore / members.length) : 0,
      captured_at: capturedAt,
      cut_score: guild.cutScore,
      failed_count: members.length - achievedCount,
      guild_name: guild.guildName,
      inactive_count: inactiveCount,
      max_members: MAX_MEMBERS,
      member_count: members.length,
      move_candidate_count: 0,
      raw_json: guild,
      season_key: seasonKey,
      total_score: totalScore,
    })

    members.forEach((member) => {
      const score = Number(member.score) || 0
      const inactiveMinutes = getInactiveMinutes(member.apiDate, capturedAt)
      memberRows.push({
        achieved: score >= guild.cutScore,
        api_date: member.apiDate,
        captured_at: capturedAt,
        cut_score: guild.cutScore,
        guild_name: guild.guildName,
        inactive_minutes: inactiveMinutes,
        inactive_over_six_hours: inactiveMinutes !== null && inactiveMinutes >= INACTIVE_HOURS * 60,
        nickname: member.nickname,
        raw_json: member,
        score,
        season_key: seasonKey,
        shortage: Math.max(0, guild.cutScore - score),
        wave: member.wave,
      })
    })
  })

  return { guildRows, memberRows }
}

async function getLatestKnownNicknames(guildName) {
  const [latestGuild] = await selectRows(
    `guild_snapshots?select=captured_at&guild_name=eq.${encodeURIComponent(guildName)}&order=captured_at.desc&limit=1`,
  )

  if (!latestGuild?.captured_at) return null

  const members = await selectRows(
    `member_snapshots?select=nickname&guild_name=eq.${encodeURIComponent(guildName)}&captured_at=eq.${encodeURIComponent(latestGuild.captured_at)}`,
  )

  return new Set(members.map((member) => member.nickname).filter(Boolean))
}

async function detectRosterChanges(rosters) {
  const changes = []

  for (const roster of rosters) {
    const previousNicknames = await getLatestKnownNicknames(roster.guildName)
    if (!previousNicknames) {
      changes.push({
        guildName: roster.guildName,
        reason: 'no_previous_snapshot',
        newMembers: roster.members.map((member) => member.nickname),
      })
      continue
    }

    const currentNicknames = new Set(roster.members.map((member) => member.nickname).filter(Boolean))
    const newMembers = [...currentNicknames].filter((nickname) => !previousNicknames.has(nickname))
    const departedMembers = [...previousNicknames].filter((nickname) => !currentNicknames.has(nickname))

    if (newMembers.length > 0 || departedMembers.length > 0) {
      changes.push({
        departedMembers,
        guildName: roster.guildName,
        reason: newMembers.length > 0 && departedMembers.length > 0 ? 'roster_changed' : newMembers.length > 0 ? 'new_member_detected' : 'member_departed_detected',
        newMembers,
      })
    }
  }

  return changes
}

export async function handler(event) {
  if (!isAuthorized(event)) {
    return json(401, { error: 'Unauthorized' })
  }

  try {
    const rosterSettled = await Promise.allSettled(guildConfigs.map((config) => fetchGuildRoster(config)))
    const rosters = rosterSettled
      .map((result) => (result.status === 'fulfilled' ? result.value : null))
      .filter(Boolean)

    const changes = await detectRosterChanges(rosters)
    if (changes.length === 0) {
      return json(200, {
        checkedAt: new Date().toISOString(),
        refreshed: false,
        changes,
      })
    }

    const capturedAt = new Date().toISOString()
    const settled = await Promise.allSettled(guildConfigs.map((config) => fetchGuildSeason(config)))
    const guilds = settled
      .map((result, index) => {
        if (result.status === 'fulfilled') return result.value
        return {
          cutScore: guildConfigs[index].cutScore,
          error: result.reason?.message || 'Fetch failed',
          guildName: guildConfigs[index].guildName,
          members: [],
          seasonEndAt: null,
          seasonStartAt: null,
          type: guildConfigs[index].type,
        }
      })
      .sort((a, b) => guildConfigs.find((config) => config.guildName === a.guildName).order - guildConfigs.find((config) => config.guildName === b.guildName).order)

    const { guildRows, memberRows } = buildRows(guilds, capturedAt)
    await insertRows('guild_snapshots', guildRows)
    await insertRows('member_snapshots', memberRows)

    return json(200, {
      capturedAt,
      changes,
      guildCount: guildRows.length,
      memberCount: memberRows.length,
      refreshed: true,
    })
  } catch (error) {
    return json(500, { error: error.message || 'Roster change collect failed' })
  }
}
