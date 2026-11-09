import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const project = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
const tarball = resolve(process.argv[2] ?? join(project, 'artifacts', `${manifest.name}-${manifest.version}.tgz`))
assert.ok(existsSync(tarball), 'Pack the plugin before running host smoke.')
const parent = resolve(process.env.DSH_SMOKE_TMP ?? tmpdir())
const root = await mkdtemp(join(parent, 'dsh-plugin-smoke-'))
assert.equal(dirname(root), parent)
const nodeDirectory = dirname(process.execPath)
const npmCandidates = [
  join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
  join(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
]
const npmLink = join(nodeDirectory, 'npm')
if (existsSync(npmLink)) npmCandidates.push(realpathSync(npmLink))
const npmCli = npmCandidates.find(existsSync)
assert.ok(npmCli, 'The Node installation must include npm.')

// Capture subprocess output: a Harness launch URL contains a process secret.
async function run(label, script, args, env = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: project, env: { ...process.env, ...env }, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', () => {})
  const result = await new Promise((accept, reject) => {
    child.once('error', () => reject(new Error(`${label}: could not start subprocess.`)))
    child.once('exit', code => accept(code))
  })
  if (result !== 0) throw new Error(`${label}: command failed with exit code ${result}; raw output withheld because it can contain launch credentials.`)
  return output
}

async function freePort() {
  const server = createServer()
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept) })
  const port = server.address().port
  await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()))
  return port
}

let server
let diagnostics = ''
try {
  const host = join(root, 'host')
  const version = process.env.DSH_VERSION ?? manifest.engines.dsh
  console.log(`Installing published Harness ${version} into an isolated directory.`)
  await run('Install published Harness', npmCli, ['install', '--prefix', host, '--prefer-offline', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${version}`])
  const hostPackageDirectory = join(host, 'node_modules/@deepseek-ai/dsh')
  const hostManifest = JSON.parse(await readFile(join(hostPackageDirectory, 'package.json'), 'utf8'))
  const hostCli = resolve(hostPackageDirectory, typeof hostManifest.bin === 'string' ? hostManifest.bin : hostManifest.bin.dsh)
  const home = join(root, 'web-home')
  const env = { DSH_HOME: home }
  await run('Register Web plugin', hostCli, ['plugin', '--profile', 'web', 'add', tarball], env)
  const dump = await run('Compose Web configuration', hostCli, ['--profile', 'web', '--dump-config'], env)
  assert.equal((dump.match(/name: dsh-openai-oauth(?:\s|$)/g) ?? []).length, 1, 'Plugin must be composed exactly once.')
  assert.ok(dump.includes('openai-codex-search'), 'Search provider must be selected.')
  const workspace = await readFile(join(home, 'profiles/web/pnpm-workspace.yaml'), 'utf8')
  assert.ok(!workspace.includes('set this to true or false'), 'Installation must not need new lifecycle approvals.')
  const login = join(home, 'profiles/web/node_modules/dsh-openai-oauth/lib/login.js')
  assert.ok((await run('Check Web login command', login, ['--help'], env)).startsWith('Usage: dsh-openai-login'))

  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  let startup = ''
  let collectStartup = true
  server = spawn(process.execPath, [hostCli, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: project, env: { ...process.env, ...env }, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', chunk => {
    if (collectStartup) startup = (startup + chunk).slice(-1000000)
    diagnostics = (diagnostics + chunk).slice(-20000)
  })
  server.stderr.on('data', chunk => {
    if (collectStartup) startup = (startup + chunk).slice(-1000000)
    diagnostics = (diagnostics + chunk).slice(-20000)
  })
  let launchUrl
  for (let attempt = 0; attempt < 90; attempt++) {
    if (server.exitCode !== null) throw new Error('Isolated Harness exited before becoming ready; launch output withheld.')
    const plain = startup.replace(/\x1b\[[0-9;]*m/g, '')
    const candidate = plain.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/)
    if (candidate) { launchUrl = candidate[0]; break }
    await delay(1000)
  }
  assert.ok(launchUrl, 'Harness must report its authenticated local launch URL.')
  collectStartup = false
  startup = ''
  const bootstrap = await fetch(launchUrl, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
  launchUrl = undefined
  const cookie = bootstrap.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
  assert.ok(cookie.length > 0, 'Launch exchange must issue an authenticated browser cookie.')
  let rpcResponse
  for (let attempt = 0; attempt < 30; attempt++) {
    rpcResponse = await fetch(`${base}/openai-oauth/status`, {
      method: 'POST',
      headers: { cookie, origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'synthetic-smoke', method: 'status', payload: {} }),
      signal: AbortSignal.timeout(15000),
    })
    if (rpcResponse.status === 200) break
    if (attempt === 0) {
      const legacyProbe = await fetch(`${base}/api/plugins/openai-oauth/status`, { signal: AbortSignal.timeout(15000) })
      console.log(`Waiting for plugin readiness (RPC ${rpcResponse.status}, legacy route ${legacyProbe.status}).`)
    }
    if (server.exitCode !== null) throw new Error('Isolated Harness exited during plugin initialization.')
    await rpcResponse.body?.cancel()
    await delay(1000)
  }
  assert.equal(rpcResponse.status, 200, 'Authenticated private RPC must be reachable.')
  const rpc = await rpcResponse.json()
  assert.deepEqual(rpc.result, { ok: true, value: { state: 'disconnected' } })
  // DSH 0.2.2-rc.1 publishes its module graph in the served HTML, not a JSON index route.
  const indexResponse = await fetch(`${base}/`, { headers: { cookie }, signal: AbortSignal.timeout(15000) })
  assert.equal(indexResponse.status, 200, 'Authenticated client index must be served.')
  assert.match(indexResponse.headers.get('content-type') ?? '', /^text\/html(?:;|$)/)
  const indexHtml = await indexResponse.text()
  const bootGlobals = [...indexHtml.matchAll(/<script>globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/g)]
  assert.equal(bootGlobals.length, 1, 'Client index must publish exactly one module graph.')
  const boot = JSON.parse(bootGlobals[0][1])
  assert.ok(Array.isArray(boot.entries), 'Client module graph must expose its registered entries.')
  const clientRows = boot.entries.filter(entry => entry.id === manifest.name)
  assert.equal(clientRows.length, 1, 'Host must discover the installed client module exactly once.')
  const clientModule = clientRows[0]
  // Platform is filtered by the Host rather than repeated in its public graph rows.
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.deepEqual(clientModule.inject ?? [], manifest.dsh.client.inject ?? [], 'Host must preserve the client dependency declarations.')
  assert.equal(typeof clientModule.rev, 'string')
  assert.ok(clientModule.rev.length > 0, 'Client module must have a resource revision.')
  assert.equal(clientModule.url, `plugins/??${manifest.name}/client.js&rev=${clientModule.rev}`)
  const clientUrl = new URL(clientModule.url, `${base}/`)
  assert.equal(clientUrl.origin, base, 'Client module must be served by the isolated Host.')
  const clientResponse = await fetch(clientUrl, { headers: { cookie }, signal: AbortSignal.timeout(15000) })
  assert.equal(clientResponse.status, 200, 'Discovered client module URL must be served.')
  assert.match(clientResponse.headers.get('content-type') ?? '', /^(?:text|application)\/javascript(?:;|$)/)
  const clientScript = await clientResponse.text()
  assert.ok(clientScript.includes('window.__ModuleLoader__.load'), 'Served client script must register with the module loader.')
  assert.match(clientScript, /id:\s*["']dsh-openai-oauth["']/, 'Served script must register this plugin module.')
  const unauthenticated = await fetch(`${base}/openai-oauth/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000),
  })
  assert.ok([401, 403].includes(unauthenticated.status), 'Private channel must reject anonymous calls.')
  const legacy = await fetch(`${base}/api/plugins/openai-oauth/status`, { signal: AbortSignal.timeout(15000) })
  assert.equal(legacy.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await legacy.json(), { state: 'disconnected' })
  const exited = new Promise(accept => server.once('exit', accept))
  server.kill()
  await exited
  server = undefined
  await run('Remove Web plugin', hostCli, ['plugin', '--profile', 'web', 'remove', manifest.name], env)
  assert.ok(!existsSync(login), 'Removing plugin must remove its command.')
  const headlessEnv = { DSH_HOME: join(root, 'headless-home') }
  await run('Register headless plugin', hostCli, ['plugin', '--profile', 'headless', 'add', tarball], headlessEnv)
  const headlessDump = await run('Compose headless configuration', hostCli, ['--profile', 'headless', '--dump-config'], headlessEnv)
  assert.ok(headlessDump.includes('dsh-openai-oauth') && headlessDump.includes('openai-codex-search'))
  const headlessLogin = join(headlessEnv.DSH_HOME, 'profiles/headless/node_modules/dsh-openai-oauth/lib/login.js')
  assert.ok((await run('Check headless login command', headlessLogin, ['--help'], headlessEnv)).startsWith('Usage: dsh-openai-login'))
  await run('Remove headless plugin', hostCli, ['plugin', '--profile', 'headless', 'remove', manifest.name], headlessEnv)
  assert.ok(!existsSync(headlessLogin))
  console.log('Packed plugin registration, configuration, served client module, authenticated RPC, Web status, CLI help, and removal passed. No real OAuth login was attempted.')
} catch (error) {
  // Print only failure lines, never the Host's tokenized launch URL or raw log.
  const safe = diagnostics.replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/).filter(line => /\berror\b|\bfailed\b/i.test(line))
    .map(line => line.replace(/(?:https?|dsh-app):\/\/\S+/gi, '<URL>')
      .replace(/\b(?:token|cookie|authorization)\s*[:=]\s*\S+/gi, '<REDACTED>'))
    .slice(-5).join('\n')
  if (safe) console.error(safe)
  throw error
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise(accept => server.once('exit', accept))
    server.kill()
    await exited
  }
  // Only this mkdtemp child is ever removed, never an existing Harness home.
  assert.equal(dirname(root), parent)
  await rm(root, { recursive: true, force: true })
}
