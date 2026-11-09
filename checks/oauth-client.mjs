import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'

const source = await readFile(new URL('../src/client/transport.ts', import.meta.url), 'utf8')
const transport = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`)

test('OAuth settings call the private Connection channel with explicit empty payloads', async () => {
  const calls = []
  const request = transport.createOAuthRequest(async (...args) => {
    calls.push(args)
    return { ok: true, value: { state: 'disconnected' } }
  })
  assert.deepEqual(await request('status'), { state: 'disconnected' })
  await request('start', { method: 'device_code' })
  assert.deepEqual(calls, [
    ['/openai-oauth', 'status', {}],
    ['/openai-oauth', 'start', { method: 'device_code' }],
  ])
  const failure = transport.createOAuthRequest(async () => ({ ok: false, error: { message: 'Fixed safe failure.' } }))
  await assert.rejects(failure('status'), { message: 'Fixed safe failure.' })
})

test('browser login opens the validated HTTPS URL directly with safe window features', () => {
  const calls = []
  const url = 'https://auth.openai.com/oauth/authorize?state=synthetic'
  transport.openAuthorizationUrl(url, (...args) => { calls.push(args); return null })
  assert.deepEqual(calls, [[url, '_blank', 'noopener,noreferrer']])
  for (const raw of ['about:blank', 'javascript:alert(1)', 'http://auth.openai.com', 'https://evil.example', 'https://auth.openai.com.evil.example', 'https://user@auth.openai.com', 'https://auth.openai.com:444']) {
    assert.throws(() => transport.openAuthorizationUrl(raw, () => assert.fail('unsafe URL was opened')))
  }
  assert.doesNotThrow(() => transport.openAuthorizationUrl(url, () => { throw new Error('popup blocked') }))
})
