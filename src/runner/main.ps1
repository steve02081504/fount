#!pwsh
#_pragma icon $PSScriptRoot/../../src/public/pages/favicon.ico
#_pragma title "fount"

if (!$env:FOUNT_BRANCH) {
	$env:FOUNT_BRANCH = "master"
}

# 任务栏进度
$script:TaskbarProgressEnabled = $Host.UI.SupportsVirtualTerminal -and -not [System.Console]::IsOutputRedirected
$script:TaskbarProgressEsc = [char]27
$script:TaskbarProgressBel = [char]7
function Write-TaskbarProgress([int]$Percent) {
	if (-not $script:TaskbarProgressEnabled) { return }
	if ($PSBoundParameters.ContainsKey('Percent')) {
		$p = [Math]::Max(0, [Math]::Min(100, $Percent))
		Write-Host -NoNewline ($script:TaskbarProgressEsc + "]9;4;1;$p" + $script:TaskbarProgressBel)
	}
	else {
		Write-Host -NoNewline ($script:TaskbarProgressEsc + "]9;4;3" + $script:TaskbarProgressBel)
	}
}
function Write-TaskbarProgressClear {
	if ($script:TaskbarProgressEnabled) {
		Write-Host -NoNewline ($script:TaskbarProgressEsc + "]9;4;0" + $script:TaskbarProgressBel)
	}
}
function Write-TaskbarProgressError {
	if ($script:TaskbarProgressEnabled) {
		Write-Host -NoNewline ($script:TaskbarProgressEsc + "]9;4;2;100" + $script:TaskbarProgressBel)
	}
}

#_if PSScript
function Set-MissingVariablesForWindowsPowershell {
	[System.Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidAssignmentToAutomaticVariable', '', Justification = 'all assignments to "automatic" variables are safe in this function')]
	param()
	if ($PSEdition -eq "Desktop") {
		try { $global:IsWindows = $true } catch {}
	}
}
Set-MissingVariablesForWindowsPowershell
#_endif

function Test-FountTree([string]$Dir) {
	return (Test-Path -LiteralPath "$Dir/run.bat" -PathType Leaf) -and
		(Test-Path -LiteralPath "$Dir/path/fount.ps1" -PathType Leaf) -and
		(Test-Path -LiteralPath "$Dir/path/src/i18n.ps1" -PathType Leaf) -and
		(Test-Path -LiteralPath "$Dir/path/src/eula.ps1" -PathType Leaf)
}

function Test-FountInstallTarget([string]$Dir) {
	if (Test-FountTree $Dir) { return $true }
	$target = Get-Item -LiteralPath $Dir -Force -ErrorAction Ignore
	if ($target -and (-not $target.PSIsContainer -or (Get-ChildItem -LiteralPath $Dir -Force -ErrorAction Stop | Select-Object -First 1))) {
		throw "$Dir is not an empty directory or a fount installation. Choose another FOUNT_DIR; existing files were left untouched."
	}
	return $false
}

# PATH registration is optional; an explicit target always takes precedence.
if (!$env:FOUNT_DIR) {
	$launcherName = if ($env:OS -eq 'Windows_NT') { 'fount.ps1' } else { 'fount.sh' }
	$fountCommand = Get-Command $launcherName -ErrorAction Ignore
	if ($fountCommand) {
		$env:FOUNT_DIR = $fountCommand.Path | Split-Path -Parent | Split-Path -Parent
	}
	elseif ($env:OS -eq 'Windows_NT') {
		$env:FOUNT_DIR = "$env:LOCALAPPDATA/fount"
	}
	else {
		$env:FOUNT_DIR = "$HOME/.local/share/fount"
	}
}
$existingInstall = Test-FountInstallTarget $env:FOUNT_DIR
Write-TaskbarProgress -Percent 0

if ((Get-Culture).Name -match '-(CN|KP|RU)$') {
	Start-Job {
		# 随手之劳之经验医学之clash的tun没开
		if ((Test-Connection "github.com", "cdn.jsdelivr.net" -Count 1 -Quiet -ErrorAction SilentlyContinue) -contains $false) {
			Invoke-RestMethod http://127.0.0.1:9090/configs -Method Patch -Body '{"tun":{"enable":true}}' -ErrorAction SilentlyContinue
			Invoke-RestMethod http://127.0.0.1:9097/configs -Method Patch -Body '{"tun":{"enable":true}}' -ErrorAction SilentlyContinue
		}
	} | Out-Null
}

#_if PSScript
if (!$IsWindows) {
	function install_package {
		param(
			[string]$CommandName,
			[string[]]$PackageNames
		)
		if ((Get-Command -Name $CommandName -ErrorAction Ignore)) { return $true }

		$hasSudo = (Get-Command -Name "sudo" -ErrorAction Ignore)

		foreach ($package in $PackageNames) {
			if (Get-Command -Name "apt-get" -ErrorAction Ignore) {
				if ($hasSudo) { sudo apt-get update -y > $null; sudo apt-get install -y $package }
				else { apt-get update -y > $null; apt-get install -y $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "pacman" -ErrorAction Ignore) {
				if ($hasSudo) { sudo pacman -S --needed --noconfirm $package }
				else { pacman -S --needed --noconfirm $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "dnf" -ErrorAction Ignore) {
				if ($hasSudo) { sudo dnf install -y $package } else { dnf install -y $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "yum" -ErrorAction Ignore) {
				if ($hasSudo) { sudo yum install -y $package } else { yum install -y $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "zypper" -ErrorAction Ignore) {
				if ($hasSudo) { sudo zypper install -y --no-confirm $package } else { zypper install -y --no-confirm $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "apk" -ErrorAction Ignore) {
				if ($hasSudo) { sudo apk add --update $package } else { apk add --update $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "brew" -ErrorAction Ignore) {
				if (-not (brew list --formula $package -ErrorAction Ignore)) {
					brew install $package
				}
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "pkg" -ErrorAction Ignore) {
				if ($hasSudo) { sudo pkg install -y $package } else { pkg install -y $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "snap" -ErrorAction Ignore) {
				if ($hasSudo) { sudo snap install $package } else { snap install $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
		}

		if (Get-Command -Name $CommandName -ErrorAction Ignore) {
			$currentPackages = $env:FOUNT_AUTO_INSTALLED_PACKAGES -split ';' | Where-Object { $_ }
			if ($package -notin $currentPackages) {
				$env:FOUNT_AUTO_INSTALLED_PACKAGES = ($currentPackages + $package) -join ';'
			}
			return $true
		}
		else {
			Write-Error "Error: $package installation failed."
			return $false
		}
	}
	install_package "bash" @("bash", "gnu-bash")
	Write-TaskbarProgress -Percent 5
	Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/$env:FOUNT_BRANCH/src/runner/main.sh | bash -s -- $args
	exit $LastExitCode
}
#_endif

$script:AcceptEula = $env:FOUNT_ACCEPT_EULA -match '^(?i)(1|true|yes)$'
$forwardedArgs = @($args)
if ($forwardedArgs.Count -eq 0) {
	$forwardedArgs = @("open", "keepalive")
}

function RefreshPath {
	$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}
function Test-Winget {
	try {
		if (!(Get-Command winget -ErrorAction SilentlyContinue)) {
			Import-Module Appx
			try {
				Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
			}
			catch {
				try {
					Invoke-WebRequest -Uri https://aka.ms/getwinget -OutFile "$env:TEMP/winget.msixbundle"
					Add-AppxPackage -Path "$env:TEMP/winget.msixbundle"
				}
				catch {
					Add-AppxPackage -Path https://cdn.winget.microsoft.com/cache/source.msix
				}
				finally {
					Remove-Item "$env:TEMP/winget.msixbundle" -Force -ErrorAction SilentlyContinue
				}
			}
			RefreshPath
			if ($env:FOUNT_DIR -and (Test-Path $env:FOUNT_DIR)) {
				New-Item -Path "$env:FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
				Set-Content "$env:FOUNT_DIR/data/installer/auto_installed_winget" '1'
			}
		}
	} catch { <# ignore #> }
}

function Install-FountTree {
	param([string]$Dir, [string]$Branch)
	$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("fount-install-" + [guid]::NewGuid().ToString('N'))
	New-Item -Path $temporaryDirectory -ItemType Directory -ErrorAction Stop | Out-Null
	try {
		$sourceDirectory = $null
		if (Get-Command git -ErrorAction Ignore) {
			$cloneUrls = @("https://github.com/steve02081504/fount")
			if ((Get-Culture).Name -match '-(CN|KP|RU)$') {
				$cloneUrls += "https://gh-proxy.org/github.com/steve02081504/fount"
				$cloneUrls += "https://gitclone.com/github.com/steve02081504/fount.git"
			}
			$cloneAttempt = 0
			foreach ($url in $cloneUrls) {
				$cloneAttempt++
				$cloneDirectory = Join-Path $temporaryDirectory "clone-$cloneAttempt"
				git clone -c core.autocrlf=false -c http.lowSpeedLimit=1 -c http.lowSpeedTime=30 $url $cloneDirectory --depth 1 --single-branch --branch $Branch
				if ($LastExitCode -eq 0) {
					$sourceDirectory = $cloneDirectory
					break
				}
			}
		}
		if (-not $sourceDirectory) {
			$zipUrls = @("https://github.com/steve02081504/fount/archive/refs/heads/$Branch.zip")
			if ((Get-Culture).Name -match '-(CN|KP|RU)$') {
				$zipUrls += "https://gh-proxy.org/https://github.com/steve02081504/fount/archive/refs/heads/$Branch.zip"
			}
			$zipFile = Join-Path $temporaryDirectory 'fount.zip'
			$downloaded = $false
			$lastError = $null
			foreach ($zipUrl in $zipUrls) {
				try {
					Invoke-WebRequest $zipUrl -OutFile $zipFile -ErrorAction Stop
					$downloaded = $true
					break
				}
				catch { $lastError = $_.Exception.Message }
			}
			if (-not $downloaded) { throw "Failed to download fount: $lastError" }
			Expand-Archive -LiteralPath $zipFile -DestinationPath "$temporaryDirectory/archive" -ErrorAction Stop
			$sourceDirectory = (Get-ChildItem -LiteralPath "$temporaryDirectory/archive" -Directory -Filter 'fount-*' | Select-Object -First 1).FullName
		}
		if (-not $sourceDirectory -or -not (Test-FountTree $sourceDirectory)) { throw "Failed to install fount" }
		if (Test-FountInstallTarget $Dir) { throw "$Dir is no longer empty; existing files were left untouched." }
		# Move contents, including dotfiles, without replacing a caller's cwd inode.
		New-Item -Path $Dir -ItemType Directory -Force -ErrorAction Stop | Out-Null
		Get-ChildItem -LiteralPath $sourceDirectory -Force | Move-Item -Destination $Dir -ErrorAction Stop
	}
	finally {
		Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
	}
	Get-ChildItem -Path $Dir -Recurse -File -Filter '*.ps1' -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
}

function Import-FountLocale([string]$Dir) {
	$script:FOUNT_DIR = $Dir
	. (Join-Path $Dir 'path/src/i18n.ps1')
	. (Join-Path $Dir 'path/src/eula.ps1')
}

$statusServerJob = $null
$fountExitCode = 1
$eulaAcceptFile = $null
try {
	if (-not $existingInstall) {
		Write-TaskbarProgress -Percent 0
		Install-FountTree -Dir $env:FOUNT_DIR -Branch $env:FOUNT_BRANCH
		Write-TaskbarProgress -Percent 50
		if (!(Test-Path $env:FOUNT_DIR)) {
			Write-TaskbarProgressError
			$Host.UI.WriteErrorLine("Failed to install fount")
			exit 1
		}
		$Script:fountDir = $env:FOUNT_DIR
		Import-FountLocale $env:FOUNT_DIR
		. (Join-Path $env:FOUNT_DIR 'path/src/browser.ps1')
		Write-TaskbarProgress -Percent 60
		if (-not $script:AcceptEula) {
			$eulaAcceptFile = Join-Path ([IO.Path]::GetTempPath()) "fount-eula-accepted-$PID"
			if (-not (Test-FountConsoleInput)) {
				$Host.UI.WriteErrorLine((Get-I18n -key 'eula.required'))
				$Host.UI.WriteErrorLine($script:FountEulaUrl)
				exit 1
			}
			Remove-Item -LiteralPath $eulaAcceptFile -Force -ErrorAction Ignore
			$statusServerJob = Start-FountStatusServer -AcceptFile $eulaAcceptFile
			Test-Browser
			Begin-FountInstallWait
			Open-FountInstallWaitPage
			if (-not (Confirm-FountEula -AcceptFile $eulaAcceptFile)) {
				Write-Host (Get-I18n -key 'eula.declined')
				exit 1
			}
		}
		Copy-FountDefaultConfig
		Write-TaskbarProgress -Percent 70
	}
	else {
		$Script:fountDir = $env:FOUNT_DIR
		Import-FountLocale $Script:fountDir
	}

	try { Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope CurrentUser -Force -ErrorAction Ignore }
	catch { <# ignore #> }
	#_if PSEXE
		#_!! if (Test-Path "${PSCommandPath}.old") {
			#_!! Remove-Item "${PSCommandPath}.old"
		#_!! }
		#_!! $(if ((Get-Command ps12exe -ErrorAction Ignore) -and ($PSEXEscript -ne (ps12exe -inputFile "$Script:fountDir/src/runner/main.ps1" -PreprocessOnly))) {
			#_!! Write-Host (Get-I18n -key 'install.runnerUpdating')
			#_!! Move-Item "$PSCommandPath" "${PSCommandPath}.old"
			#_!! & "$Script:fountDir/run.bat" geneexe "$PSCommandPath"
		#_!! }) 6> $null
	#_else
		# 仅当脚本来自可写文件时才执行自更新；例如 IEX/curl 管道执行时 $PSCommandPath 可能为空。
		$canSelfModify = $PSCommandPath -and (Test-Path -LiteralPath $PSCommandPath -PathType Leaf)
		if ($canSelfModify) {
			$sourceFile = "$Script:fountDir/src/runner/main.ps1"
			if ((Get-FileHash -LiteralPath $PSCommandPath).Hash -ne (Get-FileHash -LiteralPath $sourceFile).Hash) {
				Write-Host (Get-I18n -key 'install.runnerUpdating')
				try { Copy-Item -LiteralPath $sourceFile -Destination $PSCommandPath -Force }
				catch { <# 文件无写权限时静默跳过 #> }
			}
		}
	#_endif
	$OutputEncoding = [console]::OutputEncoding = [System.Text.Encoding]::UTF8
	& "$Script:fountDir/run.bat" @forwardedArgs
	$fountExitCode = $LastExitCode
}
finally {
	Write-TaskbarProgressClear
	if ($null -ne $statusServerJob) {
		$statusServerJob | Stop-Job
		$statusServerJob | Remove-Job
	}
	if ($eulaAcceptFile) {
		Remove-Item -LiteralPath $eulaAcceptFile -Force -ErrorAction Ignore
	}
}

#_if PSEXE
	#_!! if (Test-Path "${PSCommandPath}.old") {
		#_!! Start-Process powerShell @("-NoProfile";"-c";"sleep 1;Remove-Item `"${PSCommandPath}.old`"") -WindowStyle Hidden
	#_!! }
	#_!! if ($args[0] -eq 'remove') {
		#_balus $fountExitCode
	#_!! }
#_else
	if (($args[0] -eq 'remove') -and $canSelfModify) {
		Remove-Item -LiteralPath $PSCommandPath -Force
	}
#_endif
exit $fountExitCode
