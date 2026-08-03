if (Test-Path "$FOUNT_DIR/data/installer/auto_installed_git") {
	Write-Host (Get-I18n -key 'remove.uninstalling.git')
	winget uninstall --id Git.Git -e --source winget
}

if (Test-Path "$FOUNT_DIR/data/installer/auto_installed_chrome") {
	Write-Host (Get-I18n -key 'remove.uninstalling.chrome')
	winget uninstall --id Google.Chrome -e --source winget
}

if (Test-Path "$FOUNT_DIR/data/installer/auto_installed_winget") {
	Write-Host (Get-I18n -key 'remove.uninstalling.winget')
	Import-Module Appx
	Remove-AppxPackage -Package Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
}

if (Test-Path "$FOUNT_DIR/data/installer/auto_installed_deno") {
	Write-Host (Get-I18n -key 'remove.uninstalling.deno')
	try { Remove-Item $(Get-Command deno).Source -Force } catch {
		Write-Warning (Get-I18n -key 'remove.remove.denoFailed' -params @{message = $_.Exception.Message })
	}
	Remove-Item "~/.deno" -Force -Recurse -ErrorAction Ignore

	$UserPath = [System.Environment]::GetEnvironmentVariable('PATH', [System.EnvironmentVariableTarget]::User)
	$UserPath = $UserPath -split ';'
	$UserPath = $UserPath | Where-Object { $_ -notmatch '[/\\]\.deno[\\/]?' }
	$UserPath = $UserPath -join ';'
	[System.Environment]::SetEnvironmentVariable('PATH', $UserPath, [System.EnvironmentVariableTarget]::User)
}

Set-Title ""
Write-TaskbarProgress -Percent 90
