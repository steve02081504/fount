# Windows: passthrough entry is fount.ps1; container detection lives in env.ps1
# Splat is `@name` / `@args` — `@(...)` is array subexpression and passes one nested argument.
function script:Invoke-FountFromCmd {
	$rest = @($args | Select-Object -Skip 1)
	& (Join-Path $FOUNT_DIR 'path/fount.ps1') @rest
}

function script:handle_docker_passthrough {
	if (-not (in_docker)) { return }
	Invoke-FountFromCmd @args
	exit $LastExitCode
}

function script:handle_unix_passthrough {
	if (!$IsWindows) {
		require pkg_common
		function install_package($CommandName, [string[]]$PackageNames) {
			if ((Get-Command -Name $CommandName -ErrorAction Ignore)) { return $true }

			$hasSudo = (Get-Command -Name "sudo" -ErrorAction Ignore)

			foreach ($package in $PackageNames) {
				if (Get-Command -Name "apt-get" -ErrorAction Ignore) {
					if (Enter-FountPkgLock "apt-get") {
						try {
							if (Test-FountPkgRefreshNeeded "apt-get") {
								if ($hasSudo) { sudo apt-get update -y > $null } else { apt-get update -y > $null }
								Set-FountPkgRefresh "apt-get"
							}
							if ($hasSudo) { sudo apt-get install -y $package } else { apt-get install -y $package }
						}
						finally { Exit-FountPkgLock }
					}
					if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
				}
				if (Get-Command -Name "pacman" -ErrorAction Ignore) {
					if (Enter-FountPkgLock "pacman") {
						try {
							if (Test-FountPkgRefreshNeeded "pacman") {
								if ($hasSudo) { sudo pacman -Syy --noconfirm > $null }
								else { pacman -Syy --noconfirm > $null }
								Set-FountPkgRefresh "pacman"
							}
							if ($hasSudo) { sudo pacman -S --needed --noconfirm $package }
							else { pacman -S --needed --noconfirm $package }
						}
						finally { Exit-FountPkgLock }
					}
					if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
				}
				if (Get-Command -Name "dnf" -ErrorAction Ignore) {
					if (Enter-FountPkgLock "dnf") {
						try {
							if ($hasSudo) { sudo dnf install -y $package } else { dnf install -y $package }
						}
						finally { Exit-FountPkgLock }
					}
					if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
				}
				if (Get-Command -Name "yum" -ErrorAction Ignore) {
					if (Enter-FountPkgLock "yum") {
						try {
							if ($hasSudo) { sudo yum install -y $package } else { yum install -y $package }
						}
						finally { Exit-FountPkgLock }
					}
					if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
				}
				if (Get-Command -Name "zypper" -ErrorAction Ignore) {
					if (Enter-FountPkgLock "zypper") {
						try {
							if ($hasSudo) { sudo zypper install -y --no-confirm $package } else { zypper install -y --no-confirm $package }
						}
						finally { Exit-FountPkgLock }
					}
					if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
				}
				if (Get-Command -Name "apk" -ErrorAction Ignore) {
					if (Enter-FountPkgLock "apk") {
						try {
							if ($hasSudo) { sudo apk add --update $package } else { apk add --update $package }
						}
						finally { Exit-FountPkgLock }
					}
					if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
				}
				if (Get-Command -Name "brew" -ErrorAction Ignore) {
					if (Enter-FountPkgLock "brew") {
						try {
							brew list --formula $package 2>$null | Out-Null
							if ($LastExitCode -ne 0) {
								brew install $package
							}
						}
						finally { Exit-FountPkgLock }
					}
					if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
				}
				if (Get-Command -Name "pkg" -ErrorAction Ignore) {
					if (Enter-FountPkgLock "pkg") {
						try {
							if ($hasSudo) { sudo pkg install -y $package } else { pkg install -y $package }
						}
						finally { Exit-FountPkgLock }
					}
					if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
				}
				if (Get-Command -Name "snap" -ErrorAction Ignore) {
					if (Enter-FountPkgLock "snap") {
						try {
							if ($hasSudo) { sudo snap install $package } else { snap install $package }
						}
						finally { Exit-FountPkgLock }
					}
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
		bash $FOUNT_DIR/path/fount.sh @args
		exit $LastExitCode
	}
}
