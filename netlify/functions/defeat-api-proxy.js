/* global process */

const DEFAULT_UPSTREAM = 'https://shalom-staff.netlify.app/.netlify/functions'
const ALLOWED_ENDPOINTS = new Set([
  'defeat-admin',
  'defeat-manage',
  'defeat-nickname-search',
  'defeat-status',
  'defeat-subscribe',
])

function response(statusCode, body, headers = {}) {
  return {
    statusCode,
    body,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  }
}

export async function handler(event) {
  const endpoint = String(event.queryStringParameters?.endpoint || '').trim()
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return response(404, JSON.stringify({ error: 'Unknown defeat API endpoint.' }))
  }

  const upstream = String(process.env.DEFEAT_API_UPSTREAM || DEFAULT_UPSTREAM).replace(/\/$/, '')
  const headers = { 'Content-Type': event.headers?.['content-type'] || 'application/json' }
  if (event.headers?.authorization) headers.Authorization = event.headers.authorization

  try {
    const query = endpoint === 'defeat-nickname-search'
      ? `?q=${encodeURIComponent(String(event.queryStringParameters?.q || ''))}`
      : ''
    const upstreamResponse = await fetch(`${upstream}/${endpoint}${query}`, {
      method: event.httpMethod,
      headers,
      ...(!['GET', 'HEAD'].includes(event.httpMethod) && event.body ? { body: event.body } : {}),
    })
    const body = await upstreamResponse.text()
    return response(upstreamResponse.status, body, {
      'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8',
    })
  } catch (error) {
    console.error('[defeat-api-proxy]', error)
    return response(502, JSON.stringify({ error: '디핏 알림 서버에 연결하지 못했습니다.' }))
  }
}
