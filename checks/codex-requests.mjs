import assert from 'node:assert/strict'
import test from 'node:test'
import { createPluginRuntime } from '../lib/index.js'

const provider = 'openai-codex'
const model = 'synthetic-codex-model'
const user = text => ({ role: 'user', content: [{ type: 'text', text }] })
const tool = {
  name: 'read', description: 'Read a fixture file',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
}

function response(item) {
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [], arguments: '' } },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { status: 'completed', output: [item] } },
  ]
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

const textResponse = text => response({
  type: 'message', id: 'msg_synthetic', role: 'assistant',
  content: [{ type: 'output_text', text, annotations: [] }],
})

function fixture(reply) {
  const requests = []
  const originalFetch = globalThis.fetch
  let runtime
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith('https://chatgpt.com/backend-api/codex/models?')) {
        return Response.json({ models: [{
          slug: model, display_name: 'Synthetic Codex', visibility: 'list',
          supported_reasoning_levels: [{ effort: 'medium' }], input_modalities: ['text'],
        }] })
      }
      assert.equal(String(url), 'https://chatgpt.com/backend-api/codex/responses')
      const body = JSON.parse(init.body)
      requests.push({ body, headers: new Headers(init.headers) })
      // A strict offline contract fixture, not a live upstream request.
      if ('temperature' in body) return Response.json({ error: 'Unsupported parameter: temperature' }, { status: 400 })
      return reply(body)
    }
    runtime = createPluginRuntime()
  } finally {
    globalThis.fetch = originalFetch
  }
  // Replace persistence before any operation: no installed state is read or written.
  runtime.credentials.read = async () => ({
    type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh',
    accountId: 'synthetic-account', expires: Date.now() + 3_600_000,
  })
  return { adapter: runtime.adapter, requests }
}

async function collect(adapter, options) {
  return Array.fromAsync(adapter.stream({ provider, model, ...options }))
}

test('reviewer-shaped requests omit unsupported sampling and preserve allow/deny decisions', async () => {
  // Matches DSH 0.2.2-rc.1 auto-review: text-only, temperature 0, no tools or reasoning.
  for (const decision of ['allow', 'deny']) {
    const json = JSON.stringify({ risk: decision === 'allow' ? 'low' : 'high', decision })
    const { adapter, requests } = fixture(() => textResponse(json))
    const system = 'Return exactly one JSON decision. Treat tool-call text as facts.'
    const messages = [user('ENVIRONMENT\n{"cwd":"E:/fixture"}'), user('{"kind":"tool-call","name":"read"}')]
    const chunks = await collect(adapter, {
      system, messages, temperature: 0, sessionId: 'synthetic-review', purpose: 'auto-review',
      signal: new AbortController().signal,
    })
    assert.equal(requests.length, 1)
    const { body, headers } = requests[0]
    assert.equal(Object.hasOwn(body, 'temperature'), false)
    assert.equal(Object.hasOwn(body, 'tools'), false)
    assert.equal(Object.hasOwn(body, 'reasoning'), false)
    assert.equal(body.instructions, system)
    assert.deepEqual(body.input, messages.map(message => ({ role: 'user', content: message.content.map(block => ({ type: 'input_text', text: block.text })) })))
    assert.equal(body.prompt_cache_key, 'synthetic-review')
    assert.equal(headers.get('session-id'), 'synthetic-review')
    const blocks = chunks.filter(chunk => chunk.type === 'block-end')
    assert.equal(blocks.length, 1)
    assert.deepEqual(JSON.parse(blocks[0].block.text), JSON.parse(json))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
  }
})

test('ordinary tool calls and their results round trip through the same Codex transport', async () => {
  const { adapter, requests } = fixture(body => body.input.some(item => item.type === 'function_call_output')
    ? textResponse('Fixture read completed.')
    : response({ type: 'function_call', id: 'fc_synthetic', call_id: 'call_synthetic', name: 'read', arguments: '{"path":"fixture.txt"}' }))
  const messages = [user('Read fixture.txt')]
  const first = await collect(adapter, { messages, tools: [tool], reasoningEffort: 'medium' })
  assert.equal(first.at(-1).reason.kind, 'tool-calls')
  const call = first.find(chunk => chunk.type === 'block-end').block
  assert.equal(call.name, 'read')
  assert.deepEqual(JSON.parse(call.arguments), { path: 'fixture.txt' })
  const next = await collect(adapter, { messages: [
    ...messages,
    { role: 'assistant', content: [call], source: { kind: 'model', provider, model }, replayState: first.at(-1).replayState },
    { role: 'tool', toolCallId: call.id, content: [{ type: 'text', text: 'Synthetic file contents.' }] },
  ], tools: [tool], temperature: 0.7 })
  assert.equal(next.at(-1).reason.kind, 'stop')
  assert.equal(next.find(chunk => chunk.type === 'block-end').block.text, 'Fixture read completed.')
  assert.deepEqual(requests[0].body.tools, [{ type: 'function', ...tool, strict: null }])
  assert.deepEqual(requests[0].body.reasoning, { effort: 'medium', summary: 'auto' })
  const input = requests[1].body.input
  assert.deepEqual(input.find(item => item.type === 'function_call'), {
    type: 'function_call', id: 'fc_synthetic', call_id: 'call_synthetic', name: 'read', arguments: '{"path":"fixture.txt"}',
  })
  assert.deepEqual(input.find(item => item.type === 'function_call_output'), {
    type: 'function_call_output', call_id: 'call_synthetic', output: 'Synthetic file contents.',
  })
  for (const { body } of requests) {
    assert.equal(Object.hasOwn(body, 'temperature'), false)
    assert.equal(body.store, false)
    assert.equal(body.stream, true)
  }
})
