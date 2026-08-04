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

if ($env:OS -eq 'Windows_NT') {
	Write-Host '== wt start =='
	$global:WindowsTerminalStartCaptured = $null
	function global:Start-Process {
		param(
			[Parameter(Mandatory)][AllowNull()][string]$FilePath,
			$ArgumentList
		)
		if ((Split-Path -Leaf $FilePath) -notin @('powershell.exe', 'wt.exe')) {
			throw "[wt start] unsupported FilePath: $FilePath"
		}
		$global:WindowsTerminalStartCaptured = @{
			FilePath     = $FilePath
			ArgumentList = $ArgumentList
		}
	}
	$previousErrorActionPreference = $ErrorActionPreference
	$ErrorActionPreference = 'Continue'
	$hadFountDirectory = Test-Path Env:FOUNT_DIR
	$previousFountDirectory = $env:FOUNT_DIR
	$hadFountClick = Test-Path Env:FOUNT_CLICK
	$previousFountClick = $env:FOUNT_CLICK
	$env:FOUNT_DIR = $Root
	$env:FOUNT_CLICK = '1'
	try {
		& $Fount open
		if ($LastExitCode -ne 0) {
			throw "FOUNT_CLICK open exited with $LastExitCode"
		}
		if (-not $global:WindowsTerminalStartCaptured) {
			throw '[wt start] Start-Process was not called'
		}
		if ($global:WindowsTerminalStartCaptured.ArgumentList -notlike "*fount.ps1*open*") {
			throw "[wt start] unexpected ArgumentList: $($global:WindowsTerminalStartCaptured.ArgumentList)"
		}
	}
	finally {
		Remove-Item function:global:Start-Process -ErrorAction SilentlyContinue
		Remove-Variable -Name WindowsTerminalStartCaptured -Scope Global -ErrorAction SilentlyContinue
		if ($hadFountClick) { $env:FOUNT_CLICK = $previousFountClick } else { Remove-Item Env:FOUNT_CLICK -ErrorAction SilentlyContinue }
		if ($hadFountDirectory) { $env:FOUNT_DIR = $previousFountDirectory } else { Remove-Item Env:FOUNT_DIR -ErrorAction SilentlyContinue }
		$ErrorActionPreference = $previousErrorActionPreference
	}
	Write-Host '[wt start] ok'
}
else {
	Write-Host '== FOUNT_CLICK unix passthrough =='
	$global:UnixPassthroughBashArgs = $null
	function global:bash {
		param([Parameter(ValueFromRemainingArguments = $true)]$BashArgs)
		if (Test-Path Env:FOUNT_CLICK) {
			throw '[FOUNT_CLICK unix] FOUNT_CLICK still set when bash invoked'
		}
		$global:UnixPassthroughBashArgs = @($BashArgs)
		$global:LASTEXITCODE = 0
	}
	$hadFountDirectory = Test-Path Env:FOUNT_DIR
	$previousFountDirectory = $env:FOUNT_DIR
	$hadFountClick = Test-Path Env:FOUNT_CLICK
	$previousFountClick = $env:FOUNT_CLICK
	$env:FOUNT_DIR = $Root
	$env:FOUNT_CLICK = '1'
	try {
		& $Fount open
		if ($LastExitCode -ne 0) {
			throw "FOUNT_CLICK open exited with $LastExitCode"
		}
		if (Test-Path Env:FOUNT_CLICK) {
			throw '[FOUNT_CLICK unix] FOUNT_CLICK was not cleared'
		}
		if (-not $global:UnixPassthroughBashArgs) {
			throw '[FOUNT_CLICK unix] bash was not invoked'
		}
		$bashScript = [string]$global:UnixPassthroughBashArgs[0]
		if ($bashScript -notlike '*path/fount.sh' -and $bashScript -notlike '*path\fount.sh') {
			throw "[FOUNT_CLICK unix] unexpected bash script: $bashScript"
		}
		if ($global:UnixPassthroughBashArgs -notcontains 'open') {
			throw "[FOUNT_CLICK unix] unexpected bash args: $($global:UnixPassthroughBashArgs -join ' ')"
		}
	}
	finally {
		Remove-Item function:global:bash -ErrorAction SilentlyContinue
		Remove-Variable -Name UnixPassthroughBashArgs -Scope Global -ErrorAction SilentlyContinue
		if ($hadFountClick) { $env:FOUNT_CLICK = $previousFountClick } else { Remove-Item Env:FOUNT_CLICK -ErrorAction SilentlyContinue }
		if ($hadFountDirectory) { $env:FOUNT_DIR = $previousFountDirectory } else { Remove-Item Env:FOUNT_DIR -ErrorAction SilentlyContinue }
	}
	Write-Host '[FOUNT_CLICK unix] ok'
}

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
