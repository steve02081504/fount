#!pwsh
#_pragma icon $PSScriptRoot/../public/favicon.ico
#_pragma title "fount"

#_if PSScript
if ($PSEdition -eq "Desktop") {
	try { $IsWindows = $true } catch {}
}
if (!$IsWindows) {
	function install_package([string]$package_name) {
		if (Get-Command -Name $package_name -ErrorAction Ignore) { return $true }

		$install_successful = $false

		if (-not $install_successful -and (Get-Command -Name "pkg" -ErrorAction Ignore)) {
			pkg install -y "$package_name"
			if (!$LastExitCode) { $install_successful = $true }
		}
		if (-not $install_successful -and (Get-Command -Name "snap" -ErrorAction Ignore)) {
			snap install "$package_name"
			if (!$LastExitCode) { $install_successful = $true }
		}
		if (-not $install_successful -and (Get-Command -Name "apt-get" -ErrorAction Ignore)) {
			if (Get-Command -Name "sudo" -ErrorAction Ignore) {
				sudo apt-get update -y
				sudo apt-get install -y "$package_name"
			}
			else {
				apt-get update -y
				apt-get install -y "$package_name"
			}
			if (!$LastExitCode) { $install_successful = $true }
		}
		if (-not $install_successful -and (Get-Command -Name "brew" -ErrorAction Ignore)) {
			brew list --formula "$package_name" | Out-Null
			if ($LastExitCode) {
				brew install "$package_name"
				if (!$LastExitCode) { $install_successful = $true }
			}
		}
		if (-not $install_successful -and (Get-Command -Name "pacman" -ErrorAction Ignore)) {
			if (Get-Command -Name "sudo" -ErrorAction Ignore) {
				sudo pacman -Syy
				sudo pacman -S --needed --noconfirm "$package_name"
			}
			else {
				pacman -Syy
				pacman -S --needed --noconfirm "$package_name"
			}
			if (!$LastExitCode) { $install_successful = $true }
		}
		if (-not $install_successful -and (Get-Command -Name "dnf" -ErrorAction Ignore)) {
			if (Get-Command -Name "sudo" -ErrorAction Ignore) {
				sudo dnf install -y "$package_name"
			}
			else {
				dnf install -y "$package_name"
			}
			if (!$LastExitCode) { $install_successful = $true }
		}
		if (-not $install_successful -and (Get-Command -Name "yum" -ErrorAction Ignore)) {
			if (Get-Command -Name "sudo" -ErrorAction Ignore) {
				sudo yum install -y "$package_name"
			}
			else {
				yum install -y "$package_name"
			}
			if (!$LastExitCode) { $install_successful = $true }
		}
		if (-not $install_successful -and (Get-Command -Name "zypper" -ErrorAction Ignore)) {
			if (Get-Command -Name "sudo" -ErrorAction Ignore) {
				sudo zypper install -y "$package_name"
			}
			else {
				zypper install -y "$package_name"
			}
			if (!$LastExitCode) { $install_successful = $true }
		}
		if (-not $install_successful -and (Get-Command -Name "apk" -ErrorAction Ignore)) {
			apk add --update "$package_name"
			if (!$LastExitCode) { $install_successful = $true }
		}
		if ($install_successful) {
			if ([string]::IsNullOrEmpty($env:FOUNT_AUTO_INSTALLED_PACKAGES)) { $env:FOUNT_AUTO_INSTALLED_PACKAGES = $package_name }
			else { $env:FOUNT_AUTO_INSTALLED_PACKAGES = "$env:FOUNT_AUTO_INSTALLED_PACKAGES;$package_name" }
			return $true
		}
		else {
			Write-Error "Error: $package_name installation failed."
			return $false
		}
	}
	install_package bash
	Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s @args
	exit $LastExitCode
}
#_endif

if (!$env:FOUNT_DIR) {
	$env:FOUNT_DIR = "$env:LOCALAPPDATA/fount"
}

if (!(Get-Command fount.ps1 -ErrorAction Ignore)) {
	Remove-Item $env:FOUNT_DIR -Confirm -ErrorAction Ignore -Recurse
	if (Get-Command git -ErrorAction Ignore) {
		git clone https://github.com/steve02081504/fount $env:FOUNT_DIR --depth 1 --single-branch
		if ($LastExitCode) {
			Remove-Item $env:FOUNT_DIR -Force -ErrorAction Ignore -Confirm:$false -Recurse
		}
	}
	if (!(Test-Path $env:FOUNT_DIR)) {
		Remove-Item $env:TEMP/fount-master -Force -ErrorAction Ignore -Confirm:$false -Recurse
		try { Invoke-WebRequest https://github.com/steve02081504/fount/archive/refs/heads/master.zip -OutFile $env:TEMP/fount.zip }
		catch {
			$Host.UI.WriteErrorLine("Failed to download fount: $($_.Exception.Message)")
			exit 1
		}
		Expand-Archive $env:TEMP/fount.zip $env:TEMP -Force
		Remove-Item $env:TEMP/fount.zip -Force
		# 确保父文件夹存在
		New-Item $(Split-Path -Parent $env:FOUNT_DIR) -ItemType Directory -Force -ErrorAction Ignore
		Move-Item $env:TEMP/fount-master $env:FOUNT_DIR -Force
	}
	if (!(Test-Path $env:FOUNT_DIR)) {
		$Host.UI.WriteErrorLine("Failed to install fount")
		exit 1
	}
	$Script:fountDir = $env:FOUNT_DIR
}
else {
	$Script:fountDir = (Get-Command fount.ps1).Path | Split-Path -Parent | Split-Path -Parent
}

Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope CurrentUser -Force -ErrorAction Ignore
$OutputEncoding = [console]::OutputEncoding = [System.Text.Encoding]::UTF8
& "$Script:fountDir/run.bat" @args
#_if PSEXE
	#_!! if ($args[0] -eq 'remove') {
		#_balus $LastExitCode
	#_!! }
	#_!! elseif ($PSEXEscript -ne (ps12exe -inputFile "$Script:fountDir/src/runner/main.ps1" -PreprocessOnly)) {
		#_!! Start-Process powerShell @("-NoProfile";"-c";"sleep 1;fount geneexe `"$PSEXEpath`"") -WindowStyle Hidden
	#_!! }
	#_!! exit $LastExitCode
#_endif
