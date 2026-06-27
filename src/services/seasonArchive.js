const ARCHIVE_KEY = 'shalomInfo_seasonArchives'
const MAX_ARCHIVE_COUNT = 10

function toTime(value) {
  const text = String(value || '')
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
  const normalized = text.includes('T') && !hasExplicitTimezone ? `${text}Z` : value
  const time = new Date(normalized).getTime()
  return Number.isFinite(time) ? time : null
}

function formatDateKey(value) {
  const time = toTime(value)
  if (time === null) return 'unknown-season'
  return new Date(time).toISOString().slice(0, 10)
}

export function getArchiveTargetAt(seasonEndAt) {
  const seasonEndTime = toTime(seasonEndAt)
  if (seasonEndTime === null) return null
  return new Date(seasonEndTime - 60 * 1000).toISOString()
}

export function getSeasonKey(seasonStartAt, seasonEndAt) {
  return `${formatDateKey(seasonStartAt)}_${formatDateKey(seasonEndAt)}`
}

export function readSeasonArchives() {
  if (typeof window === 'undefined') return []

  try {
    const archives = JSON.parse(window.localStorage.getItem(ARCHIVE_KEY) || '[]')
    return Array.isArray(archives) ? archives : []
  } catch {
    return []
  }
}

export function writeSeasonArchives(archives) {
  window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archives))
}

export function createSeasonArchive(guilds, saveType = 'auto') {
  const firstSeasonEndAt = guilds.find((guild) => guild?.seasonEndAt)?.seasonEndAt || null
  const firstSeasonStartAt = guilds.find((guild) => guild?.seasonStartAt)?.seasonStartAt || null
  const seasonStartAt = firstSeasonStartAt || null
  const seasonEndAt = firstSeasonEndAt
  const archiveTargetAt = getArchiveTargetAt(seasonEndAt)

  return {
    archiveTargetAt,
    guilds: guilds.map((guild, index) => {
      const members = Array.isArray(guild.members) ? guild.members : []
      const failedMembers = members
        .filter((member) => Number(member.score) < guild.cutScore)
        .map((member) => ({
          cutScore: guild.cutScore,
          nickname: member.nickname,
          score: Number(member.score) || 0,
          shortage: guild.cutScore - (Number(member.score) || 0),
        }))
        .sort((a, b) => b.shortage - a.shortage || a.score - b.score)
      const clearedCount = members.length - failedMembers.length

      return {
        clearRate: members.length > 0 ? Math.round((clearedCount / members.length) * 100) : 0,
        clearedCount,
        cutScore: guild.cutScore,
        error: guild.error || null,
        failedCount: failedMembers.length,
        failedMembers,
        guildName: guild.guildName,
        tierLabel: `${index + 1}군`,
        totalMembers: members.length,
      }
    }),
    savedAt: new Date().toISOString(),
    saveType,
    seasonEndAt,
    seasonKey: getSeasonKey(seasonStartAt, seasonEndAt),
    seasonStartAt,
  }
}

export function upsertSeasonArchive(archive) {
  const archives = readSeasonArchives()
  const withoutSameSeason = archives.filter((item) => item.seasonKey !== archive.seasonKey)
  const nextArchives = [archive, ...withoutSameSeason]
    .sort((a, b) => toTime(b.savedAt) - toTime(a.savedAt))
    .slice(0, MAX_ARCHIVE_COUNT)

  writeSeasonArchives(nextArchives)
  return nextArchives
}

export function shouldAutoArchive(guilds, archives) {
  const seasonEndAt = guilds.find((guild) => guild?.seasonEndAt)?.seasonEndAt || null
  const seasonEndTime = toTime(seasonEndAt)
  if (seasonEndTime === null) return false

  const now = Date.now()
  const archiveTargetTime = seasonEndTime - 60 * 1000
  if (now < archiveTargetTime || now > seasonEndTime) return false

  const seasonKey = getSeasonKey(guilds.find((guild) => guild?.seasonStartAt)?.seasonStartAt || null, seasonEndAt)
  return !archives.some((archive) => archive.seasonKey === seasonKey)
}
