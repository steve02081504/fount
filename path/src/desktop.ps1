function script:Get-FountDesktopShortcutFileName {
	return 'fount.lnk'
}

function script:Get-FountDesktopPath {
	return [Environment]::GetFolderPath('Desktop')
}

function script:Find-FountDesktopShortcutPaths {
	param([string]$DesktopPath = (Get-FountDesktopPath))
	$name = Get-FountDesktopShortcutFileName
	Get-ChildItem -LiteralPath $DesktopPath -Filter $name -Recurse -Depth 2 -Force -ErrorAction SilentlyContinue |
		ForEach-Object { $_.FullName }
}

function script:Remove-FountDesktopShortcuts {
	$removed = $false
	foreach ($path in Find-FountDesktopShortcutPaths) {
		Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
		$removed = $true
	}
	return $removed
}

function script:Set-FountDesktopShortcut {
	param(
		[string]$ShortcutPath,
		$Shell,
		$ShortcutCmd,
		[string]$IconLocation
	)
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

	$shortcutCmd = Get-WTfountCmd -ArgumentList @('open')
	$shortcutIconLocation = "$FOUNT_DIR\src\public\pages\favicon.ico"

	$desktopPath = Get-FountDesktopPath
	$existing = @(Find-FountDesktopShortcutPaths -DesktopPath $desktopPath)
	if ($existing.Count -gt 0) {
		$desktopTargets = $existing
	}
	else {
		$desktopTargets = @((Join-Path $desktopPath (Get-FountDesktopShortcutFileName)))
	}
	foreach ($path in $desktopTargets) {
		Set-FountDesktopShortcut -ShortcutPath $path -Shell $shell -ShortcutCmd $shortcutCmd -IconLocation $shortcutIconLocation
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
