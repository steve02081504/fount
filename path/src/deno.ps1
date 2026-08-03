function script:deno_upgrade() {
	$deno_ver = deno -V
	if (!$deno_ver) {
		deno upgrade -q
		$deno_ver = deno -V
	}
	if (!$deno_ver) {
		Write-Error (Get-I18n -key 'deno.notWorking') -ErrorAction Ignore
		return
	}

	$deno_update_channel = "stable"
	if ($deno_ver.Contains("+")) {
		$deno_update_channel = "canary"
	}
	elseif ($deno_ver.Contains("-rc")) {
		$deno_update_channel = "rc"
	}

	$upgradedFlag = Join-Path $FOUNT_DIR 'data/installer/deno_upgraded'
	if (Test-Path $upgradedFlag) {
		Start-Job -ScriptBlock {
			$deno_update_channel = $args[0]
			$errorOut = deno upgrade -q $deno_update_channel 2>&1
			if ($LastExitCode) {
				if ($errorOut.ToString().Contains('USAGE')) { # wtf deno 1.0?
					deno upgrade -q 2>&1 | Out-Null
				}
			}
		} -ArgumentList $deno_update_channel | Out-Null
		return
	}

	$errorOut = deno upgrade -q $deno_update_channel 2>&1
	if ($LastExitCode) {
		if ($errorOut.ToString().Contains('USAGE')) { # wtf deno 1.0?
			$errorOut = deno upgrade -q 2>&1
		}
	}
	if ($LastExitCode) {
		Write-Warning (Get-I18n -key 'deno.upgradeFailed')
	}
	else {
		New-Item -Path (Split-Path $upgradedFlag) -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
		Set-Content $upgradedFlag "1"
	}
}

function script:install_deno {
	if (Get-Command deno -ErrorAction SilentlyContinue) { return }
	if (Test-Path "$HOME/.deno/bin/deno.exe") {
		$env:PATH = "$env:PATH;$HOME/.deno/bin"
		[System.Environment]::SetEnvironmentVariable('PATH', [System.Environment]::GetEnvironmentVariable('PATH', 'User') + ";$HOME/.deno/bin", [System.EnvironmentVariableTarget]::User)
	}
	if (Get-Command deno -ErrorAction SilentlyContinue) { return }

	Write-Host (Get-I18n -key 'deno.missing')
	Invoke-RestMethod https://deno.land/install.ps1 | Invoke-Expression
	if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
		RefreshPath
	}
	if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
		Write-Host (Get-I18n -key 'deno.installFailedFallback')
		$url = "https://github.com/denoland/deno/releases/latest/download/deno-" + $(if ($IsWindows) {
				"x86_64-pc-windows-msvc.zip"
			}
			elseif ($IsMacOS) {
				if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) {
					"aarch64-apple-darwin.zip"
				}
				else {
					"x86_64-apple-darwin.zip"
				}
			}
			else {
				"x86_64-unknown-linux-gnu.zip"
			})
		Invoke-WebRequest -Uri $url -OutFile "$env:TEMP/deno.zip"
		Expand-Archive -Path "$env:TEMP/deno.zip" -DestinationPath "$FOUNT_DIR/path"
		Remove-Item -Path "$env:TEMP/deno.zip" -Force
		$env:PATH = "$env:PATH;$FOUNT_DIR/path"
	}
	if (Get-Command deno -ErrorAction SilentlyContinue) {
		New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
		Set-Content "$FOUNT_DIR/data/installer/auto_installed_deno" '1'
		return
	}
	Write-Host (Get-I18n -key 'deno.isRequired')
	exit 1
}
