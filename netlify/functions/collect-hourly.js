/* global process */

import { fetchGuildSeason, guildConfigs } from './_shared/growCastle.js'
import { insertRows, upsertRows } from './_shared/supabaseRest.js'

const MAX_MEMBERS = 20
const INACTIVE_HOURS = 6

function json(statusCode, body) {
  return {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    statusCode,
  }
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

function getArchiveTargetAt(seasonEndAt) {
  if (!seasonEndAt) return null
  return new Date(new Date(seasonEndAt).getTime() - 60 * 1000).toISOString()
}

function shouldArchiveNow(guilds, capturedAt) {
  const seasonEndAt = guilds.find((guild) => guild.seasonEndAt)?.seasonEndAt
  const seasonEndTime = new Date(seasonEndAt).getTime()
  if (!Number.isFinite(seasonEndTime)) return false

  const now = new Date(capturedAt).getTime()
  const archiveTargetTime = seasonEndTime - 60 * 1000
  return now >= archiveTargetTime && now <= seasonEndTime
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
    const failedCount = members.length - achievedCount

    guildRows.push({
      achieved_count: achievedCount,
      average_score: members.length > 0 ? Math.round(totalScore / members.length) : 0,
      captured_at: capturedAt,
      cut_score: guild.cutScore,
      failed_count: failedCount,
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

  return { guildRows, memberRows, seasonKey }
}

function buildSeasonArchive(guilds, capturedAt, seasonKey) {
  const seasonStartAt = guilds.find((guild) => guild.seasonStartAt)?.seasonStartAt || null
  const seasonEndAt = guilds.find((guild) => guild.seasonEndAt)?.seasonEndAt || null
  const archiveGuilds = guilds.map((guild, index) => {
    const failedMembers = (guild.members || [])
      .filter((member) => Number(member.score) < guild.cutScore)
      .map((member) => ({
        cutScore: guild.cutScore,
        nickname: member.nickname,
        score: Number(member.score) || 0,
        shortage: guild.cutScore - (Number(member.score) || 0),
      }))
      .sort((a, b) => b.shortage - a.shortage || a.score - b.score)
    const clearedCount = (guild.members || []).length - failedMembers.length

    return {
      clearRate: guild.members.length > 0 ? Math.round((clearedCount / guild.members.length) * 100) : 0,
      clearedCount,
      cutScore: guild.cutScore,
      failedCount: failedMembers.length,
      failedMembers,
      guildName: guild.guildName,
      members: guild.members,
      tierLabel: `${index + 1}군`,
      totalMembers: guild.members.length,
    }
  })
  const totalFailedCount = archiveGuilds.reduce((sum, guild) => sum + guild.failedCount, 0)

  return {
    archive_json: {
      archiveTargetAt: getArchiveTargetAt(seasonEndAt),
      guilds: archiveGuilds,
      savedAt: capturedAt,
      saveType: 'auto',
      seasonEndAt,
      seasonKey,
      seasonStartAt,
    },
    archive_target_at: getArchiveTargetAt(seasonEndAt),
    saved_at: capturedAt,
    save_type: 'auto',
    season_end_at: seasonEndAt,
    season_key: seasonKey,
    season_start_at: seasonStartAt,
    total_failed_count: totalFailedCount,
    updated_at: capturedAt,
  }
}

function isAuthorized(event) {
  const secret = process.env.COLLECT_SECRET
  const headerSecret = event.headers.authorization?.replace(/^Bearer\s+/i, '')
  const querySecret = event.queryStringParameters?.secret
  const isScheduled = event.headers['x-netlify-event'] === 'schedule'

  return isScheduled || !secret || headerSecret === secret || querySecret === secret
}

export async function handler(event) {
  if (!isAuthorized(event)) {
    return json(401, { error: 'Unauthorized' })
  }

  try {
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
        }
      })
      .sort((a, b) => guildConfigs.find((config) => config.guildName === a.guildName).order - guildConfigs.find((config) => config.guildName === b.guildName).order)
    const { guildRows, memberRows, seasonKey } = buildRows(guilds, capturedAt)

    await insertRows('guild_snapshots', guildRows)
    await insertRows('member_snapshots', memberRows)

    if (shouldArchiveNow(guilds, capturedAt)) {
      await upsertRows('season_archives', [buildSeasonArchive(guilds, capturedAt, seasonKey)], 'season_key')
    }

    return json(200, {
      capturedAt,
      guildCount: guildRows.length,
      memberCount: memberRows.length,
      seasonKey,
    })
  } catch (error) {
    return json(500, { error: error.message || 'Collect failed' })
  }
}
