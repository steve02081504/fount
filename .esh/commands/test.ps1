$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path

& "$RepoRoot/path/fount.ps1" test @args
exit $LastExitCode
