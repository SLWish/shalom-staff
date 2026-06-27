import { selectRows } from './_shared/supabaseRest.js'

function json(statusCode, body) {
  return {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    statusCode,
  }
}

function latestByGuild(rows) {
  const result = {}
  rows.forEach((row) => {
    if (!result[row.guild_name]) result[row.guild_name] = row
  })
  return Object.values(result)
}

export async function handler() {
  try {
    const guildRows = await selectRows('guild_snapshots?select=*&order=captured_at.desc&limit=80')
    const latestGuilds = latestByGuild(guildRows)
    const latestMemberRows = []

    for (const guild of latestGuilds) {
      const members = await selectRows(
        `member_snapshots?select=*&guild_name=eq.${encodeURIComponent(guild.guild_name)}&captured_at=eq.${encodeURIComponent(guild.captured_at)}&order=score.desc`,
      )
      latestMemberRows.push(...members)
    }

    const archives = await selectRows('season_archives?select=*&order=saved_at.desc&limit=3')

    return json(200, {
      archives: archives.map((archive) => ({
        ...(archive.archive_json || {}),
        id: archive.id,
        savedAt: archive.saved_at,
        saveType: archive.save_type,
        seasonEndAt: archive.season_end_at,
        seasonKey: archive.season_key,
        seasonStartAt: archive.season_start_at,
        totalFailedCount: archive.total_failed_count,
      })),
      guilds: latestGuilds,
      members: latestMemberRows,
    })
  } catch (error) {
    return json(500, { error: error.message || 'History fetch failed' })
  }
}
