/* global process */

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return {
    serviceKey,
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
  }
}

async function request(path, options = {}) {
  const { serviceKey, supabaseUrl } = getSupabaseConfig()
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(data?.message || `Supabase request failed: ${response.status}`)
  }

  return data
}

export function insertRows(table, rows) {
  if (!rows.length) return []
  return request(table, {
    body: JSON.stringify(rows),
    method: 'POST',
  })
}

export function upsertRows(table, rows, onConflict) {
  if (!rows.length) return []
  return request(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    body: JSON.stringify(rows),
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    method: 'POST',
  })
}

export function selectRows(path) {
  return request(path, {
    headers: { Prefer: undefined },
    method: 'GET',
  })
}
