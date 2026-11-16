import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function runFile(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

export async function scheduleRestart({ log } = {}) {
  if (process.platform !== 'win32') return false
  const exe = process.execPath
  if (!exe || path.extname(exe).toLowerCase() !== '.exe') return false
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (!(await fs.stat(powershell).catch(() => null))) return false

  const directory = path.join(os.homedir(), '.dsh', 'profile-sync', 'restart')
  const restartPath = path.join(directory, 'restart.ps1')
  const bootstrapPath = path.join(directory, 'bootstrap.ps1')
  const logPath = path.join(directory, 'restart.log')
  const appName = path.basename(exe)
  const quote = value => String(value).replace(/'/g, "''")

  const restartScript = [
    "$ErrorActionPreference = 'Stop'",
    `$log = '${quote(logPath)}'`,
    "function Write-Log([string]$m) { Add-Content -LiteralPath $log -Value ((Get-Date).ToString('s') + ' ' + $m) -Encoding utf8 }",
    'try {',
    "  Write-Log 'restart requested'",
    '  Start-Sleep -Seconds 2',
    `  Write-Log 'stopping ${quote(appName)}'`,
    `  & "$env:SystemRoot\\System32\\taskkill.exe" /F /IM "${quote(appName)}" /T | Out-Null`,
    '  Start-Sleep -Seconds 3',
    `  Write-Log 'starting ${quote(exe)}'`,
    `  Start-Process -FilePath '${quote(exe)}' -WorkingDirectory '${quote(path.dirname(exe))}'`,
    "  Write-Log 'started'",
    '} catch {',
    '  Write-Log ("error: " + $_.Exception.Message)',
    '  exit 1',
    '}',
  ].join('\n')

  const bootstrapScript = [
    "$ErrorActionPreference = 'Stop'",
    `$ps = '${quote(powershell)}'`,
    `$file = '${quote(restartPath)}'`,
    '$cmd = \'"\' + $ps + \'" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "\' + $file + \'"\'',
    '$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }',
    'if ($result.ReturnValue -ne 0) { exit 1 }',
  ].join('\n')

  try {
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(restartPath, restartScript, 'utf8')
    await fs.writeFile(bootstrapPath, bootstrapScript, 'utf8')
    await runFile(powershell, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      bootstrapPath,
    ])
    log?.(`[profile-sync] restart scheduled via WMI; log: ${logPath}`)
    return 'wmi'
  } catch (error) {
    log?.(`[profile-sync] restart bootstrap failed: ${error?.message || error}`)
    return false
  }
}
