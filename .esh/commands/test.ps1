$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $RepoRoot

& "$RepoRoot/path/fount.ps1" test @args
exit $LASTEXITCODE
