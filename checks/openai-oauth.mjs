import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createOpenAiOAuth } from '../lib/index.js'

const claim = 'https://api.openai.com/auth'
const access = `synthetic.${Buffer.from(JSON.stringify({ [claim]: { chatgpt_account_id: 'synthetic-account' } })).toString('base64url')}.signature`
const token = () => Response.json({ access_token: access, refresh_token: 'synthetic-replacement', expires_in: 60 })

test('browser PKCE exchanges only the state-bound callback using the matching verifier', async () => {
  let callbackState
  let notices = 0
  const oauth = createOpenAiOAuth({
    now: () => 1000,
    randomBytes: length => new Uint8Array(length).fill(7),
    waitForCallback: async state => { callbackState = state; return 'synthetic-code' },
    fetch: async (url, init) => {
      assert.equal(url, 'https://auth.openai.com/oauth/token')
      const body = new URLSearchParams(init.body)
      assert.equal(body.get('grant_type'), 'authorization_code')
      assert.equal(body.get('code'), 'synthetic-code')
      assert.equal(body.get('redirect_uri'), 'http://localhost:1455/auth/callback')
      assert.equal(body.get('code_verifier'), Buffer.alloc(32, 7).toString('base64url'))
      return token()
    },
  })
  const credential = await oauth.login({
    prompt: async () => 'browser',
    notify: notice => {
      assert.equal(notice.type, 'auth_url')
      const url = new URL(notice.url)
      assert.equal(url.origin, 'https://auth.openai.com')
      assert.equal(url.searchParams.get('state'), callbackState)
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
      assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(Buffer.alloc(32, 7).toString('base64url')).digest('base64url'))
      notices++
    },
  })
  assert.equal(notices, 1)
  assert.equal(credential.expires, 61000)
  assert.equal(credential.refresh, 'synthetic-replacement')
})

test('Device Code waits through pending and slow_down before exchanging its authorization', async () => {
  const delays = []
  let polls = 0
  let notices = 0
  const oauth = createOpenAiOAuth({
    now: () => 1000,
    sleep: async ms => { delays.push(ms) },
    fetch: async (url, init) => {
      if (url.endsWith('/usercode')) return Response.json({ device_auth_id: 'synthetic-device', user_code: 'ABCD-EFGH', interval: '1' })
      if (url.endsWith('/deviceauth/token')) {
        polls++
        assert.deepEqual(JSON.parse(init.body), { device_auth_id: 'synthetic-device', user_code: 'ABCD-EFGH' })
        if (polls === 1) return Response.json({ error: 'deviceauth_authorization_pending' }, { status: 400 })
        if (polls === 2) return Response.json({ error: 'slow_down' }, { status: 429 })
        return Response.json({ authorization_code: 'synthetic-code', code_verifier: 'synthetic-verifier' })
      }
      assert.equal(url, 'https://auth.openai.com/oauth/token')
      const body = new URLSearchParams(init.body)
      assert.equal(body.get('code_verifier'), 'synthetic-verifier')
      assert.equal(body.get('redirect_uri'), 'https://auth.openai.com/deviceauth/callback')
      return token()
    },
  })
  const credential = await oauth.login({
    prompt: async () => 'device_code',
    notify: notice => { assert.equal(notice.type, 'device_code'); notices++ },
  })
  assert.deepEqual(delays, [1000, 1000, 6000])
  assert.equal(notices, 1)
  assert.equal(credential.expires, 61000)
})

test('refresh replaces the full credential and rejects raw upstream failure details', async () => {
  const credential = { type: 'oauth', access: 'synthetic-old', refresh: 'synthetic-refresh', expires: 1, accountId: 'synthetic-account' }
  const oauth = createOpenAiOAuth({
    now: () => 5000,
    fetch: async (url, init) => {
      assert.equal(url, 'https://auth.openai.com/oauth/token')
      const body = new URLSearchParams(init.body)
      assert.equal(body.get('grant_type'), 'refresh_token')
      assert.equal(body.get('refresh_token'), 'synthetic-refresh')
      return token()
    },
  })
  const refreshed = await oauth.refresh(credential)
  assert.equal(refreshed.refresh, 'synthetic-replacement')
  assert.equal(refreshed.expires, 65000)
  const failed = createOpenAiOAuth({ fetch: async () => new Response('synthetic-sensitive-response', { status: 401 }) })
  await assert.rejects(failed.refresh(credential), error => error.message.includes('401') && !error.message.includes('synthetic-sensitive-response'))
})
