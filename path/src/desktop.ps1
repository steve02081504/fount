function script:New-FountShortcut {
	$shell = New-Object -ComObject WScript.Shell

	$shortcutCmd = Get-WTfountCmd -ArgumentList @('open')
	$shortcutIconLocation = "$FOUNT_DIR\src\public\pages\favicon.ico"

	$desktopPath = [Environment]::GetFolderPath("Desktop")
	Remove-Item -Force "$desktopPath\fount.lnk" -ErrorAction Ignore
	$desktopShortcut = $shell.CreateShortcut("$desktopPath\fount.lnk")
	$desktopShortcut.TargetPath = $shortcutCmd.FilePath
	$desktopShortcut.Arguments = $shortcutCmd.ArgumentList
	$desktopShortcut.IconLocation = $shortcutIconLocation
	$desktopShortcut.Save()
	Write-Host (Get-I18n -key 'shortcut.desktopShortcutCreated' -params @{path = "$desktopPath\fount.lnk" })

	$startMenuPath = [Environment]::GetFolderPath("StartMenu")
	Remove-Item -Force "$startMenuPath\fount.lnk" -ErrorAction Ignore
	$startMenuShortcut = $shell.CreateShortcut("$startMenuPath\fount.lnk")
	$startMenuShortcut.TargetPath = $shortcutCmd.FilePath
	$startMenuShortcut.Arguments = $shortcutCmd.ArgumentList
	$startMenuShortcut.IconLocation = $shortcutIconLocation
	$startMenuShortcut.Save()
	Write-Host (Get-I18n -key 'shortcut.startMenuShortcutCreated' -params @{path = "$startMenuPath\fount.lnk" })
}
