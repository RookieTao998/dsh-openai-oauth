import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, lstat, chmod, symlink, link, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { CredentialStoreError, SecureCredentialStore } from '../lib/index.js'

const provider = 'openai-codex'
const fixture = (access = 'synthetic-access') => ({ type: 'oauth', access, refresh: 'synthetic-refresh', expires: 2000000000000, accountId: 'synthetic-account' })

async function windowsAcl(path, action) {
  if (action === 'permit') {
    await promisify(execFile)(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe'), [path, '/grant', '*S-1-1-0:R'], { windowsHide: true })
    return
  }
  const script = `
$ErrorActionPreference = 'Stop'
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:DSH_TEST_ACL_PATH))
$acl = Get-Acl -LiteralPath $path
if ($env:DSH_TEST_ACL_ACTION -eq 'private') {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if (!$acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { exit 1 }
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.IdentityReference.Value -ne $sid.Value -or $rule.AccessControlType -ne 'Allow') { exit 1 }
  }
} else { [Console]::Out.Write($acl.Sddl) }
`
  const { stdout } = await promisify(execFile)(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true,
    env: { ...process.env, PSModulePath: join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'), DSH_TEST_ACL_PATH: Buffer.from(path, 'utf8').toString('base64'), DSH_TEST_ACL_ACTION: action },
  })
  return stdout
}

async function isolated(fn) {
  const root = await mkdtemp(join(process.env.DSH_CREDENTIAL_TEST_TMP || tmpdir(), 'dsh credential 空间 '))
  try { await fn(new SecureCredentialStore(join(root, 'Harness home')), root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('credentials create, read, atomically replace, list and delete', async () => isolated(async store => {
  assert.equal(await store.read(provider), undefined)
  await store.modify(provider, async () => fixture())
  assert.deepEqual(await store.read(provider), fixture())
  const first = await readFile(store.credentialFile, 'utf8')
  assert.equal(JSON.parse(first).version, 1)
  await store.modify(provider, async () => fixture('replacement'))
  assert.deepEqual(await store.read(provider), fixture('replacement'))
  assert.deepEqual(await store.list(), [{ providerId: provider, type: 'oauth' }])
  await store.delete(provider)
  assert.equal(await store.read(provider), undefined)
}))

test('concurrent modifications serialize across store instances', async () => isolated(async store => {
  await store.modify(provider, async () => fixture('0'))
  await Promise.all(Array.from({ length: 4 }, () => new SecureCredentialStore(join(store.stateDirectory, '..', '..')).modify(provider, async current => {
    await new Promise(resolve => setTimeout(resolve, 10))
    return fixture(String(Number(current.access) + 1))
  })))
  assert.equal((await store.read(provider)).access, '4')
}))

test('Windows cold reads never observe another instance before its directory ACL is protected', { skip: process.platform !== 'win32' }, async () => {
  for (let round = 0; round < 6; round++) {
    await isolated(async store => {
      const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () =>
        new SecureCredentialStore(join(store.stateDirectory, '..', '..')).read(provider)))
      assert.deepEqual(outcomes.map(outcome => outcome.status), ['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'])
      assert.ok(outcomes.every(outcome => outcome.value === undefined))
    })
  }
})

test('Windows independent processes initialize the same private store safely', { skip: process.platform !== 'win32' }, async () => isolated(async store => {
  const entry = pathToFileURL(join(import.meta.dirname, '..', 'lib', 'index.js')).href
  const code = `
    const { SecureCredentialStore } = await import(process.env.DSH_TEST_STORE_ENTRY)
    try {
      await new SecureCredentialStore(process.env.DSH_TEST_STORE_HOME).read('openai-codex')
      process.stdout.write('ok')
    } catch (error) {
      process.stdout.write(error.code || 'CHECK_FAILED')
      process.exitCode = 1
    }
  `
  const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath,
    ['--input-type=module', '-e', code], {
      windowsHide: true,
      timeout: 90_000,
      env: { ...process.env, DSH_TEST_STORE_ENTRY: entry, DSH_TEST_STORE_HOME: join(store.stateDirectory, '..', '..') },
    })))
  assert.deepEqual(outcomes.map(outcome => outcome.status), ['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'])
  assert.ok(outcomes.every(outcome => outcome.value.stdout === 'ok'))
}))

test('Windows checker failures are reported separately and preserve the saved credential', { skip: process.platform !== 'win32' }, async () => isolated(async (store, root) => {
  await store.modify(provider, async () => fixture())
  const originalRoot = process.env.SystemRoot
  try {
    process.env.SystemRoot = join(root, 'missing Windows installation')
    await assert.rejects(store.read(provider), error => error instanceof CredentialStoreError
      && error.code === 'WINDOWS_CREDENTIAL_CHECK_FAILED'
      && !error.message.includes('permissions are unsafe'))
  } finally {
    if (originalRoot === undefined) delete process.env.SystemRoot
    else process.env.SystemRoot = originalRoot
  }
  assert.deepEqual(await store.read(provider), fixture())
}))

test('malformed envelopes fail with redacted diagnostics', async () => isolated(async store => {
  await store.modify(provider, async () => fixture())
  await writeFile(store.credentialFile, 'synthetic-secret invalid JSON')
  await assert.rejects(store.read(provider), error => error instanceof CredentialStoreError && error.code === 'INVALID_CREDENTIAL_FILE' && !error.message.includes('synthetic-secret'))
}))

test('credential directories and links cannot replace regular files', async () => isolated(async (store, root) => {
  await store.read(provider)
  await mkdir(store.credentialFile)
  await assert.rejects(store.read(provider), { code: 'UNSAFE_CREDENTIAL_PATH' })
  await rm(store.credentialFile, { recursive: true })
  const target = join(root, 'link target')
  await mkdir(target)
  await symlink(target, store.credentialFile, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(store.read(provider), { code: 'UNSAFE_CREDENTIAL_PATH' })
  await assert.rejects(store.delete(provider), { code: 'UNSAFE_CREDENTIAL_PATH' })
}))

test('plugin state directory junctions or symlinks are rejected', async () => isolated(async (store, root) => {
  await mkdir(join(root, 'Harness home', 'plugins'), { recursive: true })
  const target = join(root, 'outside')
  await mkdir(target)
  await symlink(target, store.stateDirectory, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(store.modify(provider, async () => fixture()), { code: 'UNSAFE_CREDENTIAL_PATH' })
  assert.equal(await lstat(target).then(info => info.isDirectory()), true)
}))

test('permissive POSIX credential mode is rejected', { skip: process.platform === 'win32' }, async () => isolated(async store => {
  await store.modify(provider, async () => fixture())
  await chmod(store.credentialFile, 0o644)
  await assert.rejects(store.read(provider), { code: 'UNSAFE_CREDENTIAL_PERMISSIONS' })
}))

test('hard-linked credential files are rejected', async () => isolated(async (store, root) => {
  await store.modify(provider, async () => fixture())
  await link(store.credentialFile, join(root, 'hardlink'))
  await assert.rejects(store.read(provider), { code: 'UNSAFE_CREDENTIAL_PATH' })
}))

test('Windows protects owned paths without changing shared Harness ACLs', { skip: process.platform !== 'win32' }, async () => isolated(async (store, root) => {
  const home = join(root, 'Harness home')
  const plugins = join(home, 'plugins')
  await mkdir(plugins, { recursive: true })
  const before = [await windowsAcl(home, 'sddl'), await windowsAcl(plugins, 'sddl')]
  await store.modify(provider, async () => fixture())
  await windowsAcl(store.stateDirectory, 'private')
  await windowsAcl(store.credentialFile, 'private')
  assert.deepEqual([await windowsAcl(home, 'sddl'), await windowsAcl(plugins, 'sddl')], before)
}))

test('Windows rejects an existing credential file with an additional principal', { skip: process.platform !== 'win32' }, async () => isolated(async store => {
  await store.modify(provider, async () => fixture())
  await windowsAcl(store.credentialFile, 'permit')
  await assert.rejects(store.read(provider), { code: 'UNSAFE_CREDENTIAL_PERMISSIONS' })
  await assert.rejects(store.modify(provider, async () => fixture('must-not-overwrite')), { code: 'UNSAFE_CREDENTIAL_PERMISSIONS' })
  await assert.rejects(store.delete(provider), { code: 'UNSAFE_CREDENTIAL_PERMISSIONS' })
}))

test('Windows rejects an existing permissive state directory without repairing it', { skip: process.platform !== 'win32' }, async () => isolated(async store => {
  await store.modify(provider, async () => fixture())
  await windowsAcl(store.stateDirectory, 'permit')
  const before = await windowsAcl(store.stateDirectory, 'sddl')
  await assert.rejects(store.read(provider), { code: 'UNSAFE_CREDENTIAL_PERMISSIONS' })
  assert.equal(await windowsAcl(store.stateDirectory, 'sddl'), before)
}))

test('Windows rejects a junction in the Harness home path', { skip: process.platform !== 'win32' }, async () => isolated(async (store, root) => {
  const target = join(root, 'outside home')
  await mkdir(target)
  await symlink(target, join(root, 'Harness home'), 'junction')
  await assert.rejects(store.read(provider), { code: 'UNSAFE_CREDENTIAL_PATH' })
}))
