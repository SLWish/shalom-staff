import { guildConfigs } from './_shared/growCastle.js'
import { selectRows } from './_shared/supabaseRest.js'

function json(statusCode, body) {
  return {
    body: JSON.stringify(body),
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
    statusCode,
  }
}

export function getLatestGuildRows(rows) {
  const latest = new Map()
  rows.forEach((row) => {
    if (row?.guild_name && !latest.has(row.guild_name)) latest.set(row.guild_name, row)
  })
  return [...latest.values()]
}

export async function handler() {
  try {
    const guildFilter = guildConfigs.map((guild) => guild.guildName).join(',')
    const rows = await selectRows(
      `guild_snapshots?select=guild_name,captured_at,raw_json&guild_name=in.(${guildFilter})&order=captured_at.desc&limit=120`,
    )
    const guilds = getLatestGuildRows(rows)
      .filter((row) => row.raw_json && Array.isArray(row.raw_json.members))
      .map((row) => ({
        capturedAt: row.captured_at,
        data: row.raw_json,
        guildName: row.guild_name,
      }))

    return json(200, { guilds })
  } catch (error) {
    return json(500, { error: error.message || 'Latest snapshot fetch failed' })
  }
}
