import { json } from './_shared/defeatAlerts.js'
import { selectRows } from './_shared/supabaseRest.js'

const GUILD_ORDER = new Map([
  ['ShaLom', 1],
  ['ShaLom2', 2],
  ['ShaLom3', 3],
  ['ShaLom4', 4],
])

export async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET 요청만 지원합니다.' })

  try {
    const [rows, stateRows] = await Promise.all([
      selectRows('defeat_member_status?select=guild_name,nickname,wave,api_date,inactive_minutes,is_defeated,checked_at&is_defeated=eq.true'),
      selectRows('defeat_monitor_state?select=source_status,last_checked_at,last_success_at,error_message&id=eq.global&limit=1'),
    ])

    const defeated = rows
      .map((row) => ({
        apiDate: row.api_date,
        checkedAt: row.checked_at,
        guildName: row.guild_name,
        inactiveMinutes: row.inactive_minutes,
        nickname: row.nickname,
        wave: row.wave,
      }))
      .sort((a, b) =>
        (GUILD_ORDER.get(a.guildName) || 99) - (GUILD_ORDER.get(b.guildName) || 99) ||
        b.inactiveMinutes - a.inactiveMinutes ||
        a.nickname.localeCompare(b.nickname),
      )

    const state = stateRows[0]
    return json(200, {
      defeated,
      monitor: state ? {
        error: state.error_message,
        lastCheckedAt: state.last_checked_at,
        lastSuccessAt: state.last_success_at,
        sourceStatus: state.source_status,
      } : {
        error: null,
        lastCheckedAt: null,
        lastSuccessAt: null,
        sourceStatus: 'idle',
      },
    })
  } catch (error) {
    console.error('[defeat-status]', error)
    return json(500, { error: '디핏 현황을 불러오지 못했습니다.' })
  }
}
