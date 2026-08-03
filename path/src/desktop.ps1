function script:Get-FountDesktopShortcutFileName {
	return 'fount.lnk'
}

function script:get_desktop_dir {
	return [Environment]::GetFolderPath('Desktop')
}

function script:find_desktop_shortcut_paths($DesktopPath = (get_desktop_dir)) {
	$name = Get-FountDesktopShortcutFileName
	Get-ChildItem -LiteralPath $DesktopPath -Filter $name -Recurse -Depth 2 -Force -ErrorAction SilentlyContinue |
		ForEach-Object { $_.FullName }
}

function script:remove_desktop_shortcut_copies {
	$removed = $false
	foreach ($path in find_desktop_shortcut_paths) {
		Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
		$removed = $true
	}
	return $removed
}

function script:Set-DesktopShortcut($ShortcutPath, $Shell, $ShortcutCmd, [string]$IconLocation) {
	Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction Ignore
	$shortcut = $Shell.CreateShortcut($ShortcutPath)
	$shortcut.TargetPath = $ShortcutCmd.FilePath
	$shortcut.Arguments = $ShortcutCmd.ArgumentList
	$shortcut.IconLocation = $IconLocation
	$shortcut.Save()
	Write-Host (Get-I18n -key 'shortcut.desktopShortcutCreated' -params @{path = $ShortcutPath })
}

function script:New-FountShortcut {
	$shell = New-Object -ComObject WScript.Shell

	$shortcutCmd = Get-WTfountCmd open
	$shortcutIconLocation = "$FOUNT_DIR\src\public\pages\favicon.ico"

	$desktopPath = get_desktop_dir
	$existing = @(find_desktop_shortcut_paths -DesktopPath $desktopPath)
	if ($existing.Count -gt 0) {
		$desktopTargets = $existing
	}
	else {
		$desktopTargets = @((Join-Path $desktopPath (Get-FountDesktopShortcutFileName)))
	}
	foreach ($path in $desktopTargets) {
		Set-DesktopShortcut -ShortcutPath $path -Shell $shell -ShortcutCmd $shortcutCmd -IconLocation $shortcutIconLocation
	}

	$startMenuPath = [Environment]::GetFolderPath('StartMenu')
	Remove-Item -Force "$startMenuPath\fount.lnk" -ErrorAction Ignore
	$startMenuShortcut = $shell.CreateShortcut("$startMenuPath\fount.lnk")
	$startMenuShortcut.TargetPath = $shortcutCmd.FilePath
	$startMenuShortcut.Arguments = $shortcutCmd.ArgumentList
	$startMenuShortcut.IconLocation = $shortcutIconLocation
	$startMenuShortcut.Save()
	Write-Host (Get-I18n -key 'shortcut.startMenuShortcutCreated' -params @{path = "$startMenuPath\fount.lnk" })
}
