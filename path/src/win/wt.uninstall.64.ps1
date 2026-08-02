# Remove Windows Terminal Profile
Write-Host (Get-I18n -key 'remove.removing.terminalProfile')
$WTjsonDirPath = "$env:LOCALAPPDATA/Microsoft/Windows Terminal/Fragments/fount"
if (Test-Path $WTjsonDirPath -PathType Container) {
	Remove-Item -Path $WTjsonDirPath -Force -Recurse
	Write-Host (Get-I18n -key 'remove.terminalProfileRemoved')
}
else {
	Write-Host (Get-I18n -key 'remove.terminalProfileNotFound')
}
