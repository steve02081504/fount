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
function Set-MissingVariablesForWindowsPowershell {
	[System.Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidAssignmentToAutomaticVariable', '', Justification = 'all assignments to "automatic" variables are safe in this function')]
	param()
	if ($PSEdition -eq "Desktop") {
		try { $global:IsWindows = $true } catch {}
	}
}
Set-MissingVariablesForWindowsPowershell

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
				if ($hasSudo) { sudo pacman -Syy --noconfirm > $null; sudo pacman -S --needed --noconfirm $package }
				else { pacman -Syy --noconfirm > $null; pacman -S --needed --noconfirm $package }
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

if (!$env:FOUNT_DIR) {
	$env:FOUNT_DIR = "$env:LOCALAPPDATA/fount"
}

$script:AcceptEula = $env:FOUNT_ACCEPT_EULA -match '^(?i)1|true|yes$'
$newargs = @($args)
if ($newargs.Count -eq 0) {
	$newargs = @("open", "keepalive")
}

$Script:Installed_winget = 0
$Script:Installed_chrome = 0

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
			$Script:Installed_winget = 1
			RefreshPath
		}
	} catch { <# ignore #> }
}

function Get-Browser {
	try {
		$progId = (Get-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice" -Name "ProgId" -ErrorAction Stop).'ProgId'

		if ($progId) {
			(Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -Name "(default)" -ErrorAction Stop).'(default)'
		}
	} catch { <# ignore #> }
}

function Test-Browser {
	if (Get-Browser) { return }
	try {
		Test-Winget
		winget install --id Google.Chrome -e --source winget
	} catch { <# ignore #> }
	if (!(Get-Browser)) {
		try {
			$ChromeSetup = "ChromeSetup.exe"
			Invoke-WebRequest -Uri 'https://dl.google.com/chrome/install/chrome_installer.exe' -OutFile "$env:TEMP\$ChromeSetup"
			$installer = Start-Process -FilePath "$env:TEMP\$ChromeSetup" -ArgumentList '/install' -PassThru
			do {
				Start-Sleep -Seconds 2
			} while (-not $installer.HasExited)
			Remove-Item "$env:TEMP\$ChromeSetup" -ErrorAction SilentlyContinue
		} catch { <# ignore #> }
	}

	if (Get-Browser) {
		$Script:Installed_chrome = 1
		RefreshPath
	}
}

$script:EulaUrl = 'https://steve02081504.github.io/fount/EULA/'
$script:InstallWaitUrl = 'https://steve02081504.github.io/fount/wait/install/?from=runner'
$script:EulaAcceptFile = Join-Path ([IO.Path]::GetTempPath()) "fount-eula-accepted-$PID"

function Start-FountStatusServer {
	param([string]$AcceptFile)
	$scriptBlock = {
		param($AcceptFile)
		$listener = [System.Net.HttpListener]::new()
		$listener.Prefixes.Add("http://localhost:8930/")
		$listener.Start()
		try {
			while ($true) {
				$context = $listener.GetContext()
				$response = $context.Response
				$response.AddHeader("Access-Control-Allow-Origin", "*")
				$path = $context.Request.Url.AbsolutePath.TrimEnd('/')
				if ($path -eq '/eula') {
					Set-Content -LiteralPath $AcceptFile -Value '1' -Encoding ascii
				}
				$eula = if (Test-Path -LiteralPath $AcceptFile) { 'accepted' } else { 'pending' }
				$message = if ($path -eq '/eula') { 'accepted' } else { 'pong' }
				$buffer = [System.Text.Encoding]::UTF8.GetBytes("{`"message`":`"$message`",`"eula`":`"$eula`"}")
				$response.ContentType = "application/json"
				$response.ContentLength64 = $buffer.Length
				$response.OutputStream.Write($buffer, 0, $buffer.Length)
				$response.Close()
			}
		}
		finally {
			$listener.Stop()
			$listener.Close()
		}
	}
	return Start-Job -ScriptBlock $scriptBlock -ArgumentList $AcceptFile
}

function Format-FountOsc8Link([string]$Url) {
	if (-not ($Host.UI.SupportsVirtualTerminal -and -not [System.Console]::IsOutputRedirected)) {
		return $Url
	}
	$esc = [char]27
	return "${esc}]8;;${Url}${esc}\${Url}${esc}]8;;${esc}\"
}

function Test-FountConsoleInput {
	try {
		$null = [Console]::KeyAvailable
		return $true
	}
	catch { return $false }
}

function Install-FountTree {
	param([string]$Dir, [string]$Branch)
	Remove-Item $Dir -Force -ErrorAction Ignore -Recurse
	if (Get-Command git -ErrorAction Ignore) {
		git clone -c core.autocrlf=false https://github.com/steve02081504/fount $Dir --depth 1 --single-branch --branch $Branch
		if ($LastExitCode) {
			Remove-Item $Dir -Force -ErrorAction Ignore -Recurse
		}
	}
	if (!(Test-Path $Dir)) {
		Remove-Item "$env:TEMP/fount-$Branch" -Force -ErrorAction Ignore -Recurse
		try { Invoke-WebRequest https://github.com/steve02081504/fount/archive/refs/heads/$Branch.zip -OutFile $env:TEMP/fount.zip }
		catch {
			throw "Failed to download fount: $($_.Exception.Message)"
		}
		Expand-Archive $env:TEMP/fount.zip $env:TEMP -Force
		Remove-Item $env:TEMP/fount.zip -Force
		New-Item $(Split-Path -Parent $Dir) -ItemType Directory -Force -ErrorAction Ignore
		Move-Item "$env:TEMP/fount-$Branch" $Dir -Force
	}
	if (!(Test-Path $Dir)) {
		throw "Failed to install fount"
	}
}

function Copy-FountDefaultConfig([string]$Dir) {
	$dest = Join-Path $Dir 'data/config.json'
	if (Test-Path -LiteralPath $dest) { return }
	New-Item -Path (Join-Path $Dir 'data') -ItemType Directory -Force | Out-Null
	Copy-Item -LiteralPath (Join-Path $Dir 'default/config.json') -Destination $dest
}

function Remove-FountAfterEulaDecline {
	$fountPs1 = Join-Path $env:FOUNT_DIR 'path/fount.ps1'
	if (Test-Path -LiteralPath $fountPs1) {
		& $fountPs1 remove
	}
	else {
		Remove-Item $env:FOUNT_DIR -Force -ErrorAction Ignore -Recurse
	}
}

function Confirm-FountEula {
	param([string]$AcceptFile)
	if ($script:AcceptEula) { return $true }
	if (Test-Path -LiteralPath $AcceptFile) { return $true }
	if (-not (Test-FountConsoleInput)) {
		$Host.UI.WriteErrorLine("EULA acceptance is required. Re-run with FOUNT_ACCEPT_EULA=1, or from an interactive terminal.")
		$Host.UI.WriteErrorLine($script:EulaUrl)
		return $false
	}
	Write-Host "Do you accept the fount End-User License Agreement (EULA)?"
	Write-Host (Format-FountOsc8Link $script:EulaUrl)
	Write-Host -NoNewline "[Y/N] "
	while ($true) {
		if (Test-Path -LiteralPath $AcceptFile) {
			Write-Host "Y"
			return $true
		}
		if ([Console]::KeyAvailable) {
			$key = [Console]::ReadKey($true)
			if ($key.Key -eq 'Y' -or $key.KeyChar -eq 'y' -or $key.KeyChar -eq 'Y') {
				Set-Content -LiteralPath $AcceptFile -Value '1' -Encoding ascii
				Write-Host "Y"
				return $true
			}
			if ($key.Key -eq 'N' -or $key.KeyChar -eq 'n' -or $key.KeyChar -eq 'N') {
				Write-Host "N"
				return $false
			}
		}
		Start-Sleep -Milliseconds 150
	}
}

$statusServerJob = $null
$fountExitCode = 1
try {
	if (!(Get-Command fount.ps1 -ErrorAction Ignore)) {
		$cloneJob = $null
		if (-not $script:AcceptEula) {
			if (-not (Test-FountConsoleInput)) {
				$Host.UI.WriteErrorLine("EULA acceptance is required. Re-run with FOUNT_ACCEPT_EULA=1, or from an interactive terminal.")
				$Host.UI.WriteErrorLine($script:EulaUrl)
				exit 1
			}
			Remove-Item -LiteralPath $script:EulaAcceptFile -Force -ErrorAction Ignore
			$statusServerJob = Start-FountStatusServer -AcceptFile $script:EulaAcceptFile
			Test-Browser
			Start-Process $script:InstallWaitUrl
			Write-TaskbarProgress
			$cloneJob = Start-Job -ScriptBlock ${function:Install-FountTree} -ArgumentList $env:FOUNT_DIR, $env:FOUNT_BRANCH
			if (-not (Confirm-FountEula -AcceptFile $script:EulaAcceptFile)) {
				Write-Host "EULA declined. Removing fount."
				Stop-Job $cloneJob -ErrorAction SilentlyContinue
				Remove-Job $cloneJob -Force -ErrorAction SilentlyContinue
				Remove-FountAfterEulaDecline
				exit 1
			}
			Wait-Job $cloneJob | Out-Null
			if ($cloneJob.State -ne 'Completed') {
				Receive-Job $cloneJob
				Write-TaskbarProgressError
				$Host.UI.WriteErrorLine("Failed to install fount")
				exit 1
			}
			Receive-Job $cloneJob
			Remove-Job $cloneJob -Force -ErrorAction SilentlyContinue
		}
		else {
			Write-TaskbarProgress -Percent 0
			Install-FountTree -Dir $env:FOUNT_DIR -Branch $env:FOUNT_BRANCH
			Write-TaskbarProgress -Percent 50
		}
		if (!(Test-Path $env:FOUNT_DIR)) {
			Write-TaskbarProgressError
			$Host.UI.WriteErrorLine("Failed to install fount")
			exit 1
		}
		$Script:fountDir = $env:FOUNT_DIR
		Copy-FountDefaultConfig $env:FOUNT_DIR
		Write-TaskbarProgress -Percent 60
		if ($Script:Installed_winget) {
			New-Item -Path "$env:FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
			Set-Content "$env:FOUNT_DIR/data/installer/auto_installed_winget" '1'
			$Script:Installed_winget = 0
		}
		if ($Script:Installed_chrome) {
			New-Item -Path "$env:FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
			Set-Content "$env:FOUNT_DIR/data/installer/auto_installed_chrome" '1'
			$Script:Installed_chrome = 0
		}
		Write-TaskbarProgress -Percent 70
		# 安装阶段结束，进度由后续 run.bat / path 脚本与 server 接续
	}
	else {
		$Script:fountDir = (Get-Command fount.ps1).Path | Split-Path -Parent | Split-Path -Parent
	}

	try { Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope CurrentUser -Force -ErrorAction Ignore }
	catch { <# ignore #> }
	#_if PSEXE
		#_!! if (Test-Path "${PSCommandPath}.old") {
			#_!! Remove-Item "${PSCommandPath}.old"
		#_!! }
		#_!! $(if ((Get-Command ps12exe -ErrorAction Ignore) -and ($PSEXEscript -ne (ps12exe -inputFile "$Script:fountDir/src/runner/main.ps1" -PreprocessOnly))) {
			#_!! "Doing runner updating..."
			#_!! Move-Item "$PSCommandPath" "${PSCommandPath}.old"
			#_!! & "$Script:fountDir/run.bat" geneexe "$PSCommandPath"
		#_!! }) 6> $null
	#_else
		# 仅当脚本来自可写文件时才执行自更新；例如 IEX/curl 管道执行时 $PSCommandPath 可能为空。
		$canSelfModify = $PSCommandPath -and (Test-Path -LiteralPath $PSCommandPath -PathType Leaf)
		if ($canSelfModify) {
			$sourceFile = "$Script:fountDir/src/runner/main.ps1"
			if ((Get-FileHash -LiteralPath $PSCommandPath).Hash -ne (Get-FileHash -LiteralPath $sourceFile).Hash) {
				Write-Host "Doing runner updating..."
				try { Copy-Item -LiteralPath $sourceFile -Destination $PSCommandPath -Force }
				catch { <# 文件无写权限时静默跳过 #> }
			}
		}
	#_endif
	$OutputEncoding = [console]::OutputEncoding = [System.Text.Encoding]::UTF8
	& "$Script:fountDir/run.bat" @newargs
	$fountExitCode = $LastExitCode
}
finally {
	Write-TaskbarProgressClear
	if ($null -ne $statusServerJob) {
		Write-Host "Shutting down installation status server..."
		$statusServerJob | Stop-Job
		$statusServerJob | Remove-Job
	}
	Remove-Item -LiteralPath $script:EulaAcceptFile -Force -ErrorAction Ignore
	if ($Script:Installed_chrome) {
		winget uninstall --id Google.Chrome -e --source winget
	}
	if ($Script:Installed_winget) {
		Import-Module Appx
		Remove-AppxPackage -Package Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
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
