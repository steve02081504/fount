# Path CLI smoke (PowerShell): server / background / log / reboot / install (init).
# Requires install-hooks.sh to have swapped JS entrypoints first.
# Windows hosts use Windows PowerShell 5.1 (`powershell`); non-Windows keeps `pwsh`.

$ErrorActionPreference = 'Stop'

# pwsh 7.3+ turns stderr from native commands (deno install / fount server) into a
# terminating NativeCommandError when $PSNativeCommandUseErrorActionPreference is
# true and stderr is redirected (we do 2>&1 to capture output). deno writes harmless
# warnings to stderr (e.g. skipped optional deps), so disable that so a warning never
# kills a native call under $ErrorActionPreference = 'Stop'.
if ($PSNativeCommandUseErrorActionPreference) { $PSNativeCommandUseErrorActionPreference = $false }

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
	if ($LastExitCode -ne 0) {
		throw "fount $($FountArgs -join ' ') exited with $LastExitCode`n--- captured output ---`n$output"
	}
	return $output
}

Write-Host "path smoke: repo=$Root"
$env:FOUNT_ACCEPT_EULA = '1'

foreach ($flag in '.noupdate', '.noautoboot') {
	$path = Join-Path $Root $flag
	if (-not (Test-Path -LiteralPath $path)) {
		[System.IO.File]::WriteAllText($path, [string]::Empty)
	}
}

if (-not (Test-Path -LiteralPath node_modules)) {
	Write-Host 'path smoke: seeding node_modules via deno install (hooked entrypoint)'
	deno install --prod --allow-scripts -c (Join-Path $Root 'deno.json') --entrypoint (Join-Path $Root 'src/server/index.mjs')
	if ($LastExitCode -ne 0) { exit $LastExitCode }
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
if ($LastExitCode -ne 0) { exit $LastExitCode }
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

$clickHelper = Join-Path $PSScriptRoot 'smoke-fount-click.ps1'
if ($env:OS -eq 'Windows_NT') {
	Write-Host '== wt start =='
	$capturePath = [System.IO.Path]::GetTempFileName()
	try {
		& powershell -NoProfile -File $clickHelper -Mode Windows -FountPath $Fount -RepoRoot $Root -CapturePath $capturePath
		if ($LastExitCode -ne 0) {
			throw "FOUNT_CLICK open exited with $LastExitCode"
		}
		if (-not (Test-Path -LiteralPath $capturePath) -or (Get-Item -LiteralPath $capturePath).Length -eq 0) {
			throw '[wt start] Start-Process was not called'
		}
		$windowsTerminalStartCaptured = Get-Content -LiteralPath $capturePath -Raw | ConvertFrom-Json
		if ($windowsTerminalStartCaptured.ArgumentList -notlike "*fount.ps1*open*") {
			throw "[wt start] unexpected ArgumentList: $($windowsTerminalStartCaptured.ArgumentList)"
		}
	}
	finally {
		Remove-Item -LiteralPath $capturePath -Force -ErrorAction SilentlyContinue
	}
	Write-Host '[wt start] ok'
}
else {
	Write-Host '== FOUNT_CLICK unix passthrough =='
	$capturePath = [System.IO.Path]::GetTempFileName()
	try {
		& pwsh -NoProfile -File $clickHelper -Mode Unix -FountPath $Fount -RepoRoot $Root -CapturePath $capturePath
		if ($LastExitCode -ne 0) {
			throw "FOUNT_CLICK open exited with $LastExitCode"
		}
		if (-not (Test-Path -LiteralPath $capturePath) -or (Get-Item -LiteralPath $capturePath).Length -eq 0) {
			throw '[FOUNT_CLICK unix] bash was not invoked'
		}
		$unixPassthroughBashArgs = @((Get-Content -LiteralPath $capturePath -Raw | ConvertFrom-Json).Args)
		$bashScript = [string]$unixPassthroughBashArgs[0]
		if ($bashScript -notlike '*path/fount.sh' -and $bashScript -notlike '*path\fount.sh') {
			throw "[FOUNT_CLICK unix] unexpected bash script: $bashScript"
		}
		if ($unixPassthroughBashArgs -notcontains 'open') {
			throw "[FOUNT_CLICK unix] unexpected bash args: $($unixPassthroughBashArgs -join ' ')"
		}
	}
	finally {
		Remove-Item -LiteralPath $capturePath -Force -ErrorAction SilentlyContinue
	}
	Write-Host '[FOUNT_CLICK unix] ok'
}

Write-Host '== install (init) =='
Remove-Item -LiteralPath node_modules -Recurse -Force -ErrorAction SilentlyContinue
& $Fount init
if ($LastExitCode -ne 0) { exit $LastExitCode }
if (-not (Test-Path -LiteralPath node_modules)) {
	Write-Error '[install] node_modules missing after init'
}
$out = Invoke-FountCapture server
Assert-OutputContains install $Marker $out

Write-Host 'path smoke: all passed'
