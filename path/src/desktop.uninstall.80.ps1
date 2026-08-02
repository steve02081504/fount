# Remove Desktop Shortcut
Write-Host (Get-I18n -key 'remove.removing.desktopShortcut')
$desktopShortcutPath = [Environment]::GetFolderPath("Desktop") + "\fount.lnk"
if (Test-Path $desktopShortcutPath) {
	Remove-Item -Path $desktopShortcutPath -Force
	Write-Host (Get-I18n -key 'remove.desktopShortcutRemoved')
}
else {
	Write-Host (Get-I18n -key 'remove.desktopShortcutNotFound')
}

# Remove Start Menu Shortcut
Write-Host (Get-I18n -key 'remove.removing.startMenuShortcut')
$startMenuShortcutPath = [Environment]::GetFolderPath("StartMenu") + "\fount.lnk"
if (Test-Path $startMenuShortcutPath) {
	Remove-Item -Path $startMenuShortcutPath -Force
	Write-Host (Get-I18n -key 'remove.startMenuShortcutRemoved')
}
else {
	Write-Host (Get-I18n -key 'remove.startMenuShortcutNotFound')
}
Set-Title "𝓯𝓸"
Write-TaskbarProgress -Percent 60
