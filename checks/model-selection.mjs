import assert from 'node:assert/strict'
import test from 'node:test'
import { createPluginRuntime } from '../lib/index.js'

const provider = 'openai-codex'
const model = 'synthetic-model-a'
const credential = () => ({
  type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh',
  accountId: 'synthetic-account', expires: Date.now() + 3_600_000,
})
const catalogModel = (slug, visibility = 'list', efforts = ['medium', 'high']) => ({
  slug, display_name: slug, visibility, input_modalities: ['text'],
  supported_reasoning_levels: efforts.map(effort => ({ effort })),
})

function fixture() {
  const state = {
    credential: credential(), reads: 0, catalogRequests: 0, refreshRequests: 0, generationRequests: 0,
    storageError: false, generationStatus: 200,
    catalog: [catalogModel(model), catalogModel('synthetic-model-b'), catalogModel('synthetic-hidden', 'hide')],
  }
  const originalFetch = globalThis.fetch
  let runtime
  try {
    globalThis.fetch = async (url, init) => {
      const path = String(url)
      if (path.startsWith('https://chatgpt.com/backend-api/codex/models?')) {
        state.catalogRequests++
        return Response.json({ models: state.catalog })
      }
      if (path === 'https://auth.openai.com/oauth/token') {
        state.refreshRequests++
        assert.equal(new URLSearchParams(init.body).get('grant_type'), 'refresh_token')
        const payload = Buffer.from(JSON.stringify({
          'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' },
        })).toString('base64url')
        return Response.json({ access_token: `synthetic.${payload}.signature`, refresh_token: 'synthetic-refreshed', expires_in: 3600 })
      }
      assert.equal(path, 'https://chatgpt.com/backend-api/codex/responses')
      state.generationRequests++
      if (state.generationStatus !== 200) return new Response(null, { status: state.generationStatus })
      const events = [
        { type: 'response.output_item.added', output_index: 0, item: { type: 'message' } },
        { type: 'response.output_item.done', output_index: 0, item: {
          type: 'message', content: [{ type: 'output_text', text: 'Synthetic reply' }],
        } },
        { type: 'response.completed', response: { status: 'completed', usage: {
          input_tokens: 25, output_tokens: 40, output_tokens_details: { reasoning_tokens: 30 },
        } } },
      ]
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
    }
    runtime = createPluginRuntime()
  } finally {
    globalThis.fetch = originalFetch
  }
  // Replace persistence before first use: no installed credentials or real HTTP requests.
  runtime.credentials.read = async () => {
    state.reads++
    if (state.storageError) throw new Error('Synthetic storage unavailable')
    return state.credential
  }
  runtime.credentials.modify = async (_provider, update) => {
    state.credential = await update(state.credential)
    return state.credential
  }
  return { ...runtime, state }
}

const generate = adapter => Array.fromAsync(adapter.stream({
  provider, model, reasoningEffort: 'medium',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic prompt' }] }],
}))

test('warm model and effort selection performs zero credential reads or remote requests', async () => {
  const { adapter, state } = fixture()
  const visible = await adapter.listModels(provider)
  const before = { reads: state.reads, catalogs: state.catalogRequests }
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const entry of visible) {
      const resolved = await adapter.resolveModel(provider, entry.id)
      assert.deepEqual(resolved.reasoning.efforts.map(effort => effort.id), ['medium', 'high'])
    }
  }
  assert.equal(state.reads - before.reads, 0, 'switching known models must not read credentials')
  assert.equal(state.catalogRequests - before.catalogs, 0)
  assert.equal(state.refreshRequests, 0)
  assert.equal(state.generationRequests, 0)
})

test('warm selection remains available when credential storage is slow or unavailable', async () => {
  const { adapter, state } = fixture()
  await adapter.listModels(provider)
  state.storageError = true
  assert.equal((await adapter.resolveModel(provider, model)).id, model)
})

test('cold concurrent resolution shares discovery, filters hidden models, and resolves historical IDs', async () => {
  const { adapter, models, state } = fixture()
  const resolved = await Promise.all([adapter.resolveModel(provider, model), adapter.resolveModel(provider, 'synthetic-model-b')])
  assert.deepEqual(resolved.map(entry => entry.id), [model, 'synthetic-model-b'])
  assert.equal(state.catalogRequests, 1)
  assert.equal((await adapter.resolveModel(provider, 'synthetic-hidden')).id, 'synthetic-hidden')
  assert.equal(await models.getModel('other-provider', model), undefined)
  assert.equal(await models.getModel(provider, 'synthetic-unknown'), undefined)
  await assert.rejects(adapter.resolveModel(provider, 'synthetic-unknown'), { code: 'UNKNOWN_MODEL' })
  const visible = await adapter.listModels(provider)
  assert.deepEqual(visible.map(entry => entry.id), [model, 'synthetic-model-b'])
})

test('explicit discovery replaces cached capabilities and clears signed-out metadata', async () => {
  const { adapter, models, state } = fixture()
  await adapter.listModels(provider)
  state.catalog = [catalogModel(model, 'list', ['low'])]
  state.credential = { ...credential(), accountId: 'synthetic-other-account', access: 'synthetic-other-access' }
  await adapter.listModels(provider)
  assert.deepEqual((await adapter.resolveModel(provider, model)).reasoning.efforts.map(effort => effort.id), ['low'])
  assert.equal(await models.getModel(provider, 'synthetic-model-b'), undefined)
  state.credential = undefined
  assert.deepEqual(await adapter.listModels(provider), [])
  await assert.rejects(adapter.resolveModel(provider, model), { code: 'UNKNOWN_MODEL' })
  assert.equal(state.catalogRequests, 2)
})

test('cached metadata does not authorize generation after logout', async () => {
  const { adapter, state } = fixture()
  await adapter.listModels(provider)
  state.credential = undefined
  assert.equal((await adapter.resolveModel(provider, model)).id, model)
  await assert.rejects(generate(adapter), { code: 'MISSING_CREDENTIAL' })
  assert.equal(state.generationRequests, 0)
})

test('token refresh is deferred until generation rather than warm selection', async () => {
  const { adapter, state } = fixture()
  await adapter.listModels(provider)
  state.credential = { ...credential(), expires: 1 }
  assert.equal((await adapter.resolveModel(provider, model)).id, model)
  assert.equal(state.refreshRequests, 0)
  const chunks = await generate(adapter)
  assert.equal(state.refreshRequests, 1)
  assert.equal(state.generationRequests, 1)
  assert.equal(state.catalogRequests, 1)
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.deepEqual(chunks.find(chunk => chunk.type === 'usage').usage, {
    inputTokens: 25, outputTokens: 40, reasoningTokens: 30,
  })
})

test('upstream model rejection remains an error without retry or fallback', async () => {
  const { adapter, state } = fixture()
  await adapter.listModels(provider)
  state.generationStatus = 400
  await assert.rejects(generate(adapter), { code: 'CODEX_ERROR' })
  assert.equal(state.generationRequests, 1)
  assert.equal(state.catalogRequests, 1)
})
