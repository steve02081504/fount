#!pwsh
# fount 开发环境检查（Windows）

$RepoRoot = (Resolve-Path "$PSScriptRoot/../../..").Path
Set-Location $RepoRoot

$supportsVt = $Host.UI.SupportsVirtualTerminal -and -not [System.Console]::IsOutputRedirected
$logoName = if ($supportsVt) { 'icon_ansi.txt' } else { 'icon_ascii.txt' }
[Console]::Write([IO.File]::ReadAllText((Join-Path $RepoRoot "imgs/$logoName")))

function Test-CmdInPath([string]$Name) {
	[bool](Get-Command $Name -ErrorAction Ignore)
}

$allSet = $true
$checks = @(
	@{
		Command        = 'git'
		GetDescription = 'install from https://git-scm.com/downloads'
	}
	@{
		Command        = 'deno'
		GetDescription = 'run fount and itll be auto-installed'
	}
	@{
		Command        = 'gh'
		GetDescription = 'install from https://github.com/cli/cli/releases'
		Next           = {
			$status = gh auth status 2>&1 | Out-String
			if ($status -match 'Logged in') {
				Write-Host '  ✔ gh logged in'
			}
			else {
				Write-Host '  ✘ gh not logged in'
				Write-Host '   run `gh auth login` to login' -ForegroundColor Red
				$script:allSet = $false
			}
		}
	}
	@{
		Command        = 'fount'
		GetDescription = 'run fount and itll be auto-added to path'
	}
)

foreach ($check in $checks) {
	if (-not (Test-CmdInPath $check.Command)) {
		Write-Host "✘ $($check.Command) is not in path"
		Write-Host $check.GetDescription -ForegroundColor Red
		$allSet = $false
	}
	else {
		Write-Host "✔ $($check.Command) is in path"
		if ($check.Next) { & $check.Next }
	}
}

if ($allSet) {
	Write-Host '🥳 All commands are usable, your dev environment is ready!'
}
else {
	Write-Host '❌ Some commands are not correctly configured, please check the output above'
}

if (-not (Test-Path './data/test/report.md')) {
	Write-Host '🔥 Creating test cache...'
	& fount test --no-parallel
	if ($LASTEXITCODE -eq 0) {
		Write-Host '🥳 Test cache created successfully'
	}
}
