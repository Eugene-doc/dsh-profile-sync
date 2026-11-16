$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
node --test
if ($LASTEXITCODE -ne 0) { throw 'tests failed' }
node --check index.js
node --check client.js
node --check lib/engine.js
Write-Host 'profile-sync smoke: ok'
