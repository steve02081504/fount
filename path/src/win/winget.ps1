function script:Test-Winget {
	if (Get-Command winget -ErrorAction SilentlyContinue) { return }
	Import-Module Appx -ErrorAction SilentlyContinue
	try {
		Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
	}
	catch {
		try {
			Invoke-WebRequest -Uri https://aka.ms/getwinget -OutFile "$env:TEMP/winget.msixbundle"
			Add-AppxPackage -Path "$env:TEMP/winget.msixbundle"
		}
		catch {
			$wingetSource = "$env:TEMP/winget-source.msix"
			try {
				Invoke-WebRequest -Uri https://cdn.winget.microsoft.com/cache/source.msix -OutFile $wingetSource
				Add-AppxPackage -Path $wingetSource
			}
			finally {
				Remove-Item $wingetSource -Force -ErrorAction SilentlyContinue
			}
		}
		finally {
			Remove-Item "$env:TEMP/winget.msixbundle" -Force -ErrorAction SilentlyContinue
		}
	}
	New-InstallerDir
	Set-Content "$FOUNT_DIR/data/installer/auto_installed_winget" '1'
	RefreshPath
}
