# Windows: passthrough entry is fount.ps1; container detection lives in env.ps1
function script:Invoke-DockerPassthrough {
	param (
		[Parameter(Mandatory = $true)]
		[string[]]$CurrentArgs
	)
	if (Test-FountInDocker) {
		$nestedArgs = $CurrentArgs[1..$CurrentArgs.Count]
		fount.ps1 @nestedArgs
		exit $LastExitCode
	}
}

function script:Invoke-FountUnixPassthrough {
	param([string[]]$CommandArgs)
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
		bash $FOUNT_DIR/path/fount.sh @CommandArgs
		exit $LastExitCode
	}
}
