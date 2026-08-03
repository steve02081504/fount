# Path CLI smoke (pwsh): server / background / log / reboot / install (init).
# Requires install-hooks.sh to have swapped JS entrypoints first.

$ErrorActionPreference = 'Stop'

$Root = if ($env:FOUNT_REPO_ROOT) { $env:FOUNT_REPO_ROOT } else { (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path }
Set-Location $Root

$Fount = Join-Path $Root 'path/fount.ps1'
$Marker = 'FOUNT_CI_HOOK:server'

function Assert-OutputContains {
	param(
		[string]$Name,
		[string]$Expected,
		[string]$Output
	)
	if ($Output -notlike "*$Expected*") {
		Write-Error "[$Name] expected output to contain: $Expected`n--- captured output ---`n$Output"
	}
	Write-Host "[$Name] ok"
}

function Invoke-FountCapture {
	param([Parameter(ValueFromRemainingArguments = $true)][string[]]$FountArgs)
	$output = & $Fount @FountArgs 2>&1 | Out-String
	if ($LASTEXITCODE -ne 0) {
		throw "fount @FountArgs exited with $LASTEXITCODE"
	}
	return $output
}

Write-Host "path smoke pwsh: repo=$Root"

foreach ($flag in '.noupdate', '.noautoboot') {
	$path = Join-Path $Root $flag
	if (-not (Test-Path -LiteralPath $path)) {
		[System.IO.File]::WriteAllText($path, [string]::Empty)
	}
}

if (-not (Test-Path -LiteralPath node_modules)) {
	Write-Host 'path smoke: seeding node_modules via deno install (hooked entrypoint)'
	deno install --prod --allow-scripts --allow-all -c (Join-Path $Root 'deno.json') --entrypoint (Join-Path $Root 'src/server/index.mjs')
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host '== server =='
$out = Invoke-FountCapture server
Assert-OutputContains server $Marker $out

Write-Host '== reboot =='
$out = Invoke-FountCapture reboot
Assert-OutputContains reboot $Marker $out
Assert-OutputContains reboot reboot $out

Write-Host '== log =='
$out = Invoke-FountCapture log
Assert-OutputContains log 'FOUNT_CI_HOOK:log' $out

Write-Host '== background =='
$markerFile = [System.IO.Path]::GetTempFileName()
$env:FOUNT_CI_HOOK_MARKER_FILE = $markerFile
& $Fount background server
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$found = $false
foreach ($attempt in 1..60) {
	if ((Test-Path -LiteralPath $markerFile) -and (Get-Item -LiteralPath $markerFile).Length -gt 0) {
		$text = Get-Content -LiteralPath $markerFile -Raw
		if ($text -like "*$Marker*") {
			$found = $true
			break
		}
	}
	Start-Sleep -Milliseconds 500
}
Remove-Item -LiteralPath $markerFile -Force -ErrorAction SilentlyContinue
Remove-Item Env:FOUNT_CI_HOOK_MARKER_FILE -ErrorAction SilentlyContinue
if (-not $found) {
	Write-Error '[background] timed out waiting for hook marker'
}
Write-Host '[background] ok'

Write-Host '== wt start =='
$script:WtStartCaptured = $null
function Start-Process {
	param(
		[Parameter(Mandatory)][AllowNull()][string]$FilePath,
		$ArgumentList
	)
	if ($FilePath -isnot [string]) {
		Write-Error "[wt start] FilePath must be string, got $($FilePath.GetType().FullName)"
	}
	$script:WtStartCaptured = @{
		FilePath     = $FilePath
		ArgumentList = $ArgumentList
	}
}
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$env:FOUNT_DIR = $Root
$env:FOUNT_CLICK = '1'
try {
	. $Fount open
	if ($LastExitCode -ne 0) {
		throw "FOUNT_CLICK open exited with $LastExitCode"
	}
	if (-not $script:WtStartCaptured) {
		Write-Error '[wt start] Start-Process was not called'
	}
	if ($script:WtStartCaptured.ArgumentList -notlike "*fount.ps1*open*") {
		Write-Error "[wt start] unexpected ArgumentList: $($script:WtStartCaptured.ArgumentList)"
	}
}
finally {
	Remove-Item function:Start-Process -ErrorAction SilentlyContinue
	Remove-Item Env:FOUNT_CLICK -ErrorAction SilentlyContinue
	$ErrorActionPreference = $prevEap
}
Write-Host '[wt start] ok'

Write-Host '== install (init) =='
Remove-Item -LiteralPath node_modules -Recurse -Force -ErrorAction SilentlyContinue
& $Fount init
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path -LiteralPath node_modules)) {
	Write-Error '[install] node_modules missing after init'
}
$out = Invoke-FountCapture server
Assert-OutputContains install $Marker $out

Write-Host 'path smoke pwsh: all passed'
