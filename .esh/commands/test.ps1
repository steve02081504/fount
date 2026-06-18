$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $RepoRoot

$changed = @(
	& git diff --name-only 2>$null
	& git ls-files --others --exclude-standard 2>$null
) | Where-Object { $_ } | ForEach-Object { $_.Replace('\', '/') } | Sort-Object -Unique

if ($changed.Count -eq 0) {
	Write-Host 'No uncommitted changes — running all shell test suites.' -ForegroundColor Yellow
	$env:FOUNT_TEST_RUN_ALL = '1'
}
else {
	$env:FOUNT_TEST_CHANGED_FILES = ($changed -join "`n")
	Write-Host "Uncommitted changes ($($changed.Count) files) — selecting suites by manifest triggers."
}

deno run --allow-scripts --allow-all -c "./deno.json" ./.github/workflows/verify_shells.mjs
exit $LASTEXITCODE
