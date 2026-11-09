import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AuthController, AuthControllerError, createOAuthRpcHandler } from '../lib/index.js'

const owner = { principal: { kind: 'owner' } }
const signal = new AbortController().signal
const synthetic = {
  type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh',
  expires: 4_000_000_000_000, accountId: 'synthetic-account',
}

function fixture(options = {}) {
  let credential
  let reads = 0
  let controllerCalls = 0
  let finish
  const store = {
    async read() { reads++; if (options.storageFailure) throw new Error('synthetic-private-storage-detail'); return credential },
    async list() { return [] },
    async modify(_provider, update) {
      if (options.storageWriteFailure) throw new Error('synthetic-private-storage-detail')
      credential = await update(credential); return credential
    },
    async delete() { if (options.storageFailure) throw new Error('synthetic-private-storage-detail'); credential = undefined },
  }
  const controller = new AuthController(store, {
    login: async interaction => {
      const method = await interaction.prompt({ type: 'select', message: '', options: [] })
      if (method === 'browser') interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/oauth/authorize?state=synthetic' })
      else interaction.notify({ type: 'device_code', verificationUri: 'https://auth.openai.com/codex/device', userCode: 'SYNTHETIC' })
      return new Promise((resolve, reject) => {
        finish = () => resolve(synthetic)
        interaction.signal.addEventListener('abort', () => reject(new Error('synthetic cancellation')), { once: true })
      })
    },
  })
  const handler = createOAuthRpcHandler({
    status: () => { controllerCalls++; return controller.status() },
    start: method => { controllerCalls++; return controller.start(method) },
    cancel: attemptId => { controllerCalls++; return controller.cancel(attemptId) },
    logout: () => { controllerCalls++; return controller.logout() },
  })
  return {
    controller, get reads() { return reads },
    get controllerCalls() { return controllerCalls },
    call: (endpoint, payload = {}, peer = owner) => handler(endpoint, payload, signal, peer),
    async complete(attemptId) { finish(); return controller.waitForAttempt(attemptId) },
  }
}

function error(result, code) {
  assert.equal(result.ok, false)
  assert.equal(result.error.code, code)
  assert.equal(typeof result.error.message, 'string')
}

test('all OAuth RPC operations reject non-owner peers before touching storage', async t => {
  const f = fixture()
  t.after(() => f.controller.dispose())
  for (const peer of [undefined, {}, { principal: { kind: 'anonymous' } }, { principal: { kind: 'agent' } }]) {
    for (const endpoint of ['status', 'start', 'cancel', 'logout', 'unknown']) {
      const result = await f.call(endpoint, {}, peer ?? {})
      error(result, 'OWNER_REQUIRED')
    }
  }
  assert.equal(f.reads, 0)
  assert.equal(f.controllerCalls, 0)
})

test('RPC endpoints require exact bounded input objects', async t => {
  const f = fixture()
  t.after(() => f.controller.dispose())
  error(await f.call('unknown'), 'NOT_FOUND')
  for (const endpoint of ['status', 'logout']) {
    for (const payload of [null, [], 'invalid', { extra: true }]) error(await f.call(endpoint, payload), 'INVALID_BODY')
  }
  for (const payload of [{}, { method: 'invalid' }, { method: 'browser', extra: true }, { method: 'x'.repeat(5000) }]) {
    error(await f.call('start', payload), 'INVALID_LOGIN_METHOD')
  }
  for (const payload of [{}, { attemptId: '' }, { attemptId: 'x'.repeat(201) }, { attemptId: 'synthetic', extra: true }]) {
    error(await f.call('cancel', payload), 'INVALID_ATTEMPT_ID')
  }
  assert.equal(f.reads, 0)
  assert.equal(f.controllerCalls, 0)
})

test('shared controller supports browser cancellation, device completion and logout', async t => {
  const f = fixture()
  t.after(() => f.controller.dispose())
  assert.deepEqual(await f.call('status'), { ok: true, value: { state: 'disconnected' } })
  const browser = await f.call('start', { method: 'browser' })
  assert.equal(browser.ok, true)
  assert.equal(browser.value.method, 'browser')
  assert.deepEqual((await f.call('status')).value, browser.value)
  error(await f.call('start', { method: 'device_code' }), 'AUTH_IN_PROGRESS')
  error(await f.call('cancel', { attemptId: 'stale' }), 'STALE_ATTEMPT')
  assert.deepEqual((await f.call('cancel', { attemptId: browser.value.attemptId })).value, { state: 'disconnected' })
  const device = await f.call('start', { method: 'device_code' })
  assert.equal(device.ok, true)
  assert.equal(device.value.method, 'device_code')
  assert.deepEqual(await f.complete(device.value.attemptId), { state: 'connected' })
  const connected = await f.call('status')
  assert.deepEqual(connected.value, { state: 'connected' })
  assert.doesNotMatch(JSON.stringify(connected), /synthetic-access|synthetic-refresh|synthetic-account/)
  assert.deepEqual((await f.call('logout')).value, { state: 'disconnected' })
})

test('storage failures return only a fixed redacted error', async t => {
  const f = fixture({ storageFailure: true })
  t.after(() => f.controller.dispose())
  for (const [endpoint, payload] of [['status', {}], ['start', { method: 'browser' }], ['logout', {}]]) {
    const result = await f.call(endpoint, payload)
    error(result, 'OAUTH_INTERNAL_ERROR')
    assert.equal(result.error.message, 'OpenAI OAuth operation failed.')
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private-storage-detail/)
  }
})

test('credential persistence failures remain redacted in subsequent status', async t => {
  const f = fixture({ storageWriteFailure: true })
  t.after(() => f.controller.dispose())
  const pending = await f.call('start', { method: 'device_code' })
  await f.complete(pending.value.attemptId)
  const failed = await f.call('status')
  assert.equal(failed.ok, true)
  assert.equal(failed.value.state, 'failed')
  assert.equal(failed.value.error.code, 'OAUTH_LOGIN_FAILED')
  assert.doesNotMatch(JSON.stringify(failed), /synthetic-private-storage-detail|synthetic-access|synthetic-refresh|synthetic-account/)
})

test('RPC error mapping never reflects arbitrary controller exception text', async () => {
  const fail = async () => { throw new AuthControllerError('AUTH_IN_PROGRESS', 'synthetic-private-error-detail') }
  const handler = createOAuthRpcHandler({ status: fail, start: fail, cancel: fail, logout: fail })
  const result = await handler('status', {}, signal, owner)
  error(result, 'AUTH_IN_PROGRESS')
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private-error-detail/)
})
