#!pwsh
#_pragma icon $PSScriptRoot/../../src/pages/favicon.ico
#_pragma title "fount"

if (!$env:FOUNT_BRANCH) {
	$env:FOUNT_BRANCH = "master"
}

#_if PSScript
if ($PSEdition -eq "Desktop") {
	try { $IsWindows = $true } catch {}
}
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
	Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/$env:FOUNT_BRANCH/src/runner/main.sh | bash -s -- $args
	exit $LastExitCode
}
#_endif

if (!$env:FOUNT_DIR) {
	$env:FOUNT_DIR = "$env:LOCALAPPDATA/fount"
}

$newargs = $args
if ($args.Length -eq 0) {
	$newargs = @("open", "keepalive")
}

$Script:Insalled_winget = 0
$Script:Insalled_chrome = 0

function RefreshPath {
	$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}
function Test-Winget {
	try {
		if (!(Get-Command winget -ErrorAction SilentlyContinue)) {
			Import-Module Appx
			Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
			$Script:Insalled_winget = 1
			RefreshPath
		}
	} catch { <# ignore #> }
}
function Test-Browser {
	$browser = try {
		$progId = (Get-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice" -Name "ProgId" -ErrorAction Stop).'ProgId'

		if ($progId) {
			(Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -Name "(default)" -ErrorAction Stop).'(default)'
		}
	} catch { <# ignore #> }
	try {
		if (!$browser) {
			Test-Winget
			winget install --id Google.Chrome -e --source winget
			$Script:Insalled_chrome = 1
			RefreshPath
		}
	} catch { <# ignore #> }
}

$statusServerJob = $null
try {
	if (!(Get-Command fount.ps1 -ErrorAction Ignore)) {
		if ($newargs -contains "open") {
			$statusServerScriptBlock = {
				$listener = [System.Net.HttpListener]::new()
				$listener.Prefixes.Add("http://localhost:8930/")
				$listener.Start()

				try {
					while ($true) {
						$response = $listener.GetContext().Response
						$response.AddHeader("Access-Control-Allow-Origin", "*")
						$buffer = [System.Text.Encoding]::UTF8.GetBytes('{"message":"pong"}')
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
			$statusServerJob = Start-Job -ScriptBlock $statusServerScriptBlock
			$newargs = $newargs | Where-Object { $_ -ne 'open' }
			Test-Browser
			Start-Process 'https://steve02081504.github.io/fount/wait/install'
		}
		Remove-Item $env:FOUNT_DIR -Confirm -ErrorAction Ignore -Recurse
		if (Get-Command git -ErrorAction Ignore) {
			git clone https://github.com/steve02081504/fount $env:FOUNT_DIR --depth 1 --single-branch --branch $env:FOUNT_BRANCH
			if ($LastExitCode) {
				Remove-Item $env:FOUNT_DIR -Force -ErrorAction Ignore -Confirm:$false -Recurse
			}
		}
		if (!(Test-Path $env:FOUNT_DIR)) {
			Remove-Item $env:TEMP/fount-$env:FOUNT_BRANCH -Force -ErrorAction Ignore -Confirm:$false -Recurse
			try { Invoke-WebRequest https://github.com/steve02081504/fount/archive/refs/heads/$env:FOUNT_BRANCH.zip -OutFile $env:TEMP/fount.zip }
			catch {
				$Host.UI.WriteErrorLine("Failed to download fount: $($_.Exception.Message)")
				exit 1
			}
			Expand-Archive $env:TEMP/fount.zip $env:TEMP -Force
			Remove-Item $env:TEMP/fount.zip -Force
			# 确保父文件夹存在
			New-Item $(Split-Path -Parent $env:FOUNT_DIR) -ItemType Directory -Force -ErrorAction Ignore
			Move-Item $env:TEMP/fount-$env:FOUNT_BRANCH $env:FOUNT_DIR -Force
		}
		if (!(Test-Path $env:FOUNT_DIR)) {
			$Host.UI.WriteErrorLine("Failed to install fount")
			exit 1
		}
		$Script:fountDir = $env:FOUNT_DIR
		if ($Script:Insalled_winget) {
			New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
			Set-Content "$FOUNT_DIR/data/installer/auto_installed_winget" '1'
			$Script:Insalled_winget = 0
		}
		if ($Script:Insalled_chrome) {
			New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
			Set-Content "$FOUNT_DIR/data/installer/auto_installed_chrome" '1'
			$Script:Insalled_chrome = 0
		}
	}
	else {
		$Script:fountDir = (Get-Command fount.ps1).Path | Split-Path -Parent | Split-Path -Parent
	}

	Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope CurrentUser -Force -ErrorAction Ignore
	#_if PSEXE
		#_!! if (Test-Path "${PSEXEpath}.old") {
			#_!! Remove-Item "${PSEXEpath}.old"
		#_!! }
		#_!! $(if ((Get-Command ps12exe -ErrorAction Ignore) -and ($PSEXEscript -ne (ps12exe -inputFile "$Script:fountDir/src/runner/main.ps1" -PreprocessOnly))) {
			#_!! "Doing runner updating..."
			#_!! Move-Item "$PSEXEpath" "${PSEXEpath}.old"
			#_!! & "$Script:fountDir/run.bat" geneexe "$PSEXEpath"
		#_!! }) 6> $null
	#_endif
	$OutputEncoding = [console]::OutputEncoding = [System.Text.Encoding]::UTF8
	& "$Script:fountDir/run.bat" @newargs
}
finally {
	if ($null -ne $statusServerJob) {
		Write-Host "Shutting down installation status server..."
		$statusServerJob | Stop-Job
		$statusServerJob | Remove-Job
	}
	if ($Script:Insalled_chrome) {
		winget uninstall --id Google.Chrome -e --source winget
	}
	if ($Script:Insalled_winget) {
		Import-Module Appx
		Remove-AppxPackage -Package Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
	}
}

#_if PSEXE
	#_!! if (Test-Path "${PSEXEpath}.old") {
		#_!! Start-Process powerShell @("-NoProfile";"-c";"sleep 1;Remove-Item `"${PSEXEpath}.old`"") -WindowStyle Hidden
	#_!! }
	#_!! if ($args[0] -eq 'remove') {
		#_balus $LastExitCode
	#_!! }
	#_!! exit $LastExitCode
#_endif
