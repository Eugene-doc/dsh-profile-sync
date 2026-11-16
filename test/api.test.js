import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createHandler } from '../index.js'

function fakeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value },
    end(value) { this.body = value || '' },
  }
}

async function call(handler, method, url, body) {
  const res = fakeResponse()
  const req = {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(JSON.stringify(body))
    },
  }
  await handler(req, res)
  return { status: res.statusCode, body: JSON.parse(res.body) }
}

test('status route returns device and local inventory', async () => {
  const engine = {
    status: async () => ({ ok: true, device: { deviceName: 'home5070' }, local: { plugins: 2, skills: 1 } }),
  }
  const handler = createHandler(engine)
  const result = await call(handler, 'GET', '/profile-sync/api/status')
  assert.equal(result.status, 200)
  assert.equal(result.body.device.deviceName, 'home5070')
})

test('apply route requires a device id', async () => {
  const engine = { apply: async () => ({ ok: true }) }
  const handler = createHandler(engine)
  const result = await call(handler, 'POST', '/profile-sync/api/apply', {})
  assert.equal(result.status, 400)
  assert.match(result.body.error, /device/i)
})
