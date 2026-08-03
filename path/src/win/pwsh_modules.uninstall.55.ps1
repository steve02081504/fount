# Uninstall fount-pwsh
Write-Host (Get-I18n -key 'remove.uninstalling.fountPwsh')
try {
	Uninstall-Module -Name fount-pwsh -AllVersions -Force -ErrorAction Stop
}
catch {
	Write-Warning (Get-I18n -key 'remove.uninstallFountPwshFailed' -params @{message = $_.Exception.Message })
}
Set-Title "𝓯𝓸𝓾"
Write-TaskbarProgress -Percent 45

# Remove Installed pwsh modules
Write-Host (Get-I18n -key 'remove.removing.installedPwshModules')
$auto_installed_pwsh_modules = Get-Content "$FOUNT_DIR/data/installer/auto_installed_pwsh_modules" -Raw -ErrorAction Ignore
if (!$auto_installed_pwsh_modules) { $auto_installed_pwsh_modules = '' }
$auto_installed_pwsh_modules = $auto_installed_pwsh_modules.Split(';') | Where-Object { $_ }
$auto_installed_pwsh_modules | ForEach-Object {
	try {
		if (Get-Module $_ -ListAvailable) {
			Uninstall-Module -Name $_ -AllVersions -Force -ErrorAction Stop
			Write-Host (Get-I18n -key 'remove.moduleRemoved' -params @{module = $_ })
		}
	}
	catch {
		Write-Warning (Get-I18n -key 'remove.remove.moduleFailed' -params @{module = $_; message = $_.Exception.Message })
	}
}
Set-Title "𝓯"
Write-TaskbarProgress -Percent 75
