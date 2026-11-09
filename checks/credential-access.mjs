import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { windowsPrivateAccess } from '../src/credential-access.ts'

async function isolated(operation) {
  const parent = resolve(process.env.DSH_CREDENTIAL_TEST_TMP ?? tmpdir())
  const root = await mkdtemp(join(parent, 'dsh acl 环境 '))
  assert.equal(dirname(root), parent)
  try {
    assert.equal(await windowsPrivateAccess(root, 'directory', true), true)
    await operation(root)
  } finally {
    assert.equal(dirname(root), parent)
    await rm(root, { recursive: true, force: true })
  }
}

test('Windows ACL verification ignores incompatible inherited module-path casing', { skip: process.platform !== 'win32' }, async t => {
  const candidates = [...(process.env.PSModulePath ?? '').split(';'), join(process.env.ProgramFiles ?? 'C:/Program Files', 'PowerShell', '7', 'Modules')]
  const ps7Modules = candidates.find(directory => {
    const manifest = join(directory, 'Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Security.psd1')
    if (!existsSync(manifest)) return false
    const bytes = readFileSync(manifest)
    const text = bytes.toString(bytes[0] === 255 && bytes[1] === 254 ? 'utf16le' : 'utf8')
    return /CompatiblePSEditions\s*=\s*@\(\s*['"]Core['"]\s*\)/.test(text)
  })
  if (!ps7Modules) { t.skip('No incompatible PowerShell 7 module path is present.'); return }
  await isolated(async root => {
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key]
    const systemModules = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')
    env.PSMODULEPATH = `${ps7Modules};${systemModules}`
    env.DSH_TEST_ACL_DIRECTORY = root
    env.DSH_TEST_ACL_HELPER = pathToFileURL(resolve(import.meta.dirname, '../src/credential-access.ts')).href
    const code = `
      const { windowsPrivateAccess } = await import(process.env.DSH_TEST_ACL_HELPER)
      const safe = await windowsPrivateAccess(process.env.DSH_TEST_ACL_DIRECTORY, 'directory', false)
      process.stdout.write(String(safe))
      if (safe !== true) process.exitCode = 1
    `
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
      windowsHide: true, env, timeout: 30_000,
    })
    assert.equal(result.stdout, 'true')
  })
})

test('Windows ACL verification distinguishes policy denial from checker execution failure', { skip: process.platform !== 'win32' }, async () => isolated(async root => {
  const icacls = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'icacls.exe')
  await promisify(execFile)(icacls, [root, '/grant', '*S-1-1-0:R'], { windowsHide: true })
  assert.equal(await windowsPrivateAccess(root, 'directory', false), false)
  assert.equal(await windowsPrivateAccess(join(root, 'missing item'), 'file', false), undefined)
}))
