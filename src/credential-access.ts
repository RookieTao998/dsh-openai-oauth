import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'

// Keep executable code fixed: paths travel as base64-encoded JSON on stdin.
const ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())) | ConvertFrom-Json
  $item = Get-Item -LiteralPath $data.path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 2 }
  $directory = $data.kind -eq 'directory'
  if ($item.PSIsContainer -ne $directory) { exit 2 }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = Get-Acl -LiteralPath $data.path
  if ($data.protect) {
    if ($directory) {
      $acl = New-Object Security.AccessControl.DirectorySecurity
      $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
    } else {
      $acl = New-Object Security.AccessControl.FileSecurity
      $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
    }
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $data.path -AclObject $acl
    $acl = Get-Acl -LiteralPath $data.path
  }
  if (!$acl.AreAccessRulesProtected) { exit 2 }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { exit 2 }
  $fullControl = [Security.AccessControl.FileSystemRights]::FullControl
  $granted = $false
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.IdentityReference.Value -ne $sid.Value -or $rule.AccessControlType -ne 'Allow') { exit 2 }
    if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
    if (($rule.FileSystemRights -band $fullControl) -eq $fullControl) { $granted = $true }
  }
  if (!$granted) { exit 2 }
  [Console]::Out.Write('protected')
} catch { exit 3 }
`

/** Return true for a private DACL, false for a rejected ACL, or undefined when verification cannot run. */
export async function windowsPrivateAccess(
  path: string,
  kind: 'directory' | 'file',
  protect: boolean,
): Promise<boolean | undefined> {
  const command = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const environment = { ...process.env }
  // Windows de-duplicates child environment keys case-insensitively, so remove every old spelling first.
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === 'psmodulepath') delete environment[key]
  }
  environment['PSModulePath'] = join(dirname(command), 'Modules')
  return new Promise(resolve => {
    const child = execFile(command, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(ACL_SCRIPT, 'utf16le').toString('base64'),
    ], {
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 16 * 1024,
      env: environment,
    }, (error, stdout) => {
      if (error === null && stdout === 'protected') resolve(true)
      else if (error?.code === 2) resolve(false)
      else resolve(undefined)
    })
    child.stdin?.on('error', () => resolve(undefined))
    child.stdin?.end(Buffer.from(JSON.stringify({ path, kind, protect }), 'utf8').toString('base64'))
  })
}
