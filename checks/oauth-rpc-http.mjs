import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { AuthController, oauthRpcRoute } from '../lib/index.js'

async function fixture(t, options = {}) {
  let reads = 0
  const controller = new AuthController({
    async read() { reads++; if (options.storageFailure) throw new Error('synthetic-private-storage-detail'); return undefined },
    async list() { return [] },
    async modify(_provider, update) { return update(undefined) },
    async delete() {},
  }, {
    login: async interaction => {
      interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/oauth/authorize?state=synthetic' })
      return new Promise((_, reject) => interaction.signal.addEventListener('abort', () => reject(new Error('synthetic cancellation')), { once: true }))
    },
  })
  let connection
  const ctx = new Context()
  const fiber = ctx.plugin(context => {
    connection = new HostConnectionService(context, [], {
      isAuthenticated: req => req.headers.cookie === 'synthetic-owner',
      authenticateApi: () => undefined,
    })
  })
  await fiber
  const route = oauthRpcRoute(controller, options.admit ? { admit: options.admit } : connection)
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await controller.dispose()
    await fiber.dispose()
  })
  const post = (endpoint = 'status', envelope = { type: 'client-request', rpcId: 'synthetic-rpc', method: endpoint, payload: {} }, init = {}) => fetch(`${base}/openai-oauth/${endpoint}`, {
    method: 'POST',
    ...init,
    headers: { cookie: 'synthetic-owner', 'content-type': 'application/json', ...init.headers },
    body: typeof envelope === 'string' ? envelope : JSON.stringify(envelope),
    signal: AbortSignal.timeout(3000),
  })
  return { base, post, get reads() { return reads } }
}

test('real HTTP bridge uses published Connection admission and returns its wire envelope', async t => {
  const f = await fixture(t)
  const response = await f.post()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(await response.json(), {
    type: 'server-response', rpcId: 'synthetic-rpc', result: { ok: true, value: { state: 'disconnected' } },
  })
  const start = await f.post('start', { type: 'client-request', rpcId: 'synthetic-start', method: 'start', payload: { method: 'browser' } })
  const pending = await start.json()
  assert.equal(pending.result.value.state, 'pending')
  assert.equal(pending.result.value.method, 'browser')
  const cancel = await f.post('cancel', { type: 'client-request', rpcId: 'synthetic-cancel', method: 'cancel', payload: { attemptId: pending.result.value.attemptId } })
  assert.deepEqual((await cancel.json()).result, { ok: true, value: { state: 'disconnected' } })
})

test('Connection rejects unauthenticated requests before any body read', async t => {
  const f = await fixture(t)
  const result = await new Promise((resolve, reject) => {
    const req = request(`${f.base}/openai-oauth/status`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '4097' },
    }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => { resolve({ status: res.statusCode, text }); req.destroy() })
    })
    req.on('error', reject)
    req.setTimeout(2000, () => { req.destroy(); reject(new Error('Admission must not wait for a request body.')) })
    req.flushHeaders()
  })
  assert.equal(result.status, 401)
  assert.equal(JSON.parse(result.text).result.error.code, 'UNAUTHENTICATED')
  assert.equal(f.reads, 0)
  const crossOrigin = await f.post('status', undefined, { headers: { origin: 'https://untrusted.example', 'sec-fetch-site': 'cross-site' } })
  assert.equal(crossOrigin.status, 403)
  assert.equal(f.reads, 0)
})

test('admitted non-owner peers cannot reach OAuth controls', async t => {
  const f = await fixture(t, { admit: () => ({ peer: { principal: { kind: 'synthetic-non-owner' } } }) })
  const response = await f.post()
  assert.equal(response.status, 403)
  assert.equal((await response.json()).result.error.code, 'OWNER_REQUIRED')
  assert.equal(f.reads, 0)
})

test('HTTP bridge rejects malformed, oversized and mismatched envelopes', async t => {
  const f = await fixture(t)
  const valid = { type: 'client-request', rpcId: 'synthetic-rpc', method: 'status', payload: {} }
  for (const body of [null, [], {}, { ...valid, extra: true }, { ...valid, type: 'server-response' }, { ...valid, rpcId: '' }, { ...valid, rpcId: 'x'.repeat(201) }, { ...valid, method: 'logout' }, { ...valid, payload: undefined }]) {
    const response = await f.post('status', body)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).result.error.code, body === null || Array.isArray(body) ? 'INVALID_BODY' : 'INVALID_ENVELOPE')
  }
  assert.equal((await f.post('status', '{')).status, 400)
  assert.equal((await f.post('status', 'x'.repeat(4097))).status, 413)
  assert.equal((await f.post('status', valid, { headers: { 'content-type': 'text/plain' } })).status, 415)
  const wrongMethod = await fetch(`${f.base}/openai-oauth/status`, { headers: { cookie: 'synthetic-owner' }, signal: AbortSignal.timeout(3000) })
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'POST')
  assert.equal((await f.post('unknown')).status, 404)
  assert.equal(f.reads, 0)
})

test('HTTP bridge redacts admission and durable-store exceptions', async t => {
  const f = await fixture(t, { storageFailure: true })
  const response = await f.post()
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.equal(JSON.parse(body).result.error.code, 'OAUTH_INTERNAL_ERROR')
  assert.doesNotMatch(body, /synthetic-private-storage-detail/)
  const admissionFailure = await fixture(t, { admit: () => { throw new Error('synthetic-private-admission-detail') } })
  const failed = await admissionFailure.post()
  assert.equal(failed.status, 500)
  assert.doesNotMatch(await failed.text(), /synthetic-private-admission-detail/)
})
