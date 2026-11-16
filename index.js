import { ProfileSyncEngine } from './lib/engine.js'
import { scheduleRestart } from './lib/restart.js'

export const name = 'dsh-profile-sync'
export const inject = ['webServer']

const API_PREFIX = '/profile-sync/api'
const MAX_BODY = 32 * 1024

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

async function readBody(req) {
  let total = 0
  const chunks = []
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function assertLocalRequest(req) {
  const headers = req.headers || {}
  const host = String(headers.host || '')
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)) {
    throw Object.assign(new Error('profile sync only accepts loopback requests'), { status: 403 })
  }
  if (headers['sec-fetch-site'] === 'cross-site') {
    throw Object.assign(new Error('cross-site request rejected'), { status: 403 })
  }
  const origin = headers.origin
  if (origin) {
    let originHost = ''
    try {
      originHost = new URL(origin).host
    } catch {}
    if (originHost !== host) throw Object.assign(new Error('origin mismatch'), { status: 403 })
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const type = String(headers['content-type'] || '')
    if (!type.toLowerCase().startsWith('application/json')) {
      throw Object.assign(new Error('mutations require application/json'), { status: 415 })
    }
  }
}

export function createHandler(engine, { restart = scheduleRestart } = {}) {
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost')
    const route = url.pathname.slice(API_PREFIX.length) || '/'
    try {
      assertLocalRequest(req)
      if (req.method === 'GET' && route === '/status') {
        json(res, 200, await engine.status())
        return
      }
      if (req.method === 'POST' && route === '/snapshot') {
        json(res, 200, await engine.snapshot())
        return
      }
      if (req.method === 'GET' && route === '/devices') {
        json(res, 200, { ok: true, devices: await engine.devices() })
        return
      }
      if (req.method === 'GET' && route === '/diff') {
        const device = url.searchParams.get('device')
        if (!device) {
          json(res, 400, { ok: false, error: 'device is required' })
          return
        }
        json(res, 200, { ok: true, diff: await engine.diff(device) })
        return
      }
      if (req.method === 'POST' && route === '/restart') {
        const mode = await restart()
        if (!mode) {
          json(res, 501, { ok: false, error: 'Could not start the Windows restart helper. Close DSH manually and reopen it.' })
          return
        }
        json(res, 200, { ok: true, restarting: true, mode })
        return
      }
      if (req.method === 'POST' && route === '/apply') {
        const body = await readBody(req)
        if (!body.deviceId) {
          json(res, 400, { ok: false, error: 'deviceId is required' })
          return
        }
        json(res, 200, await engine.apply(body.deviceId))
        return
      }
      json(res, 404, { ok: false, error: 'unknown profile sync endpoint' })
    } catch (error) {
      json(res, Number(error?.status) || 500, { ok: false, error: String(error?.message || error) })
    }
  }
}

export async function apply(ctx) {
  const engine = new ProfileSyncEngine()
  const handler = createHandler(engine)
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler,
      }),
    'profile-sync: http api',
  )
}

export default { apply, name, inject }
