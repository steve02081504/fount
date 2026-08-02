# Remove fount installation directory
Write-Host (Get-I18n -key 'remove.removing.fount.installationDir')
Remove-Item -Path $FOUNT_DIR -Recurse -Force -ErrorAction SilentlyContinue
# 只要父目录为空，继续删他妈的
$parent = Split-Path -Parent $FOUNT_DIR
while ((Get-ChildItem $parent -ErrorAction Ignore | Measure-Object).Count -eq 0) {
	Remove-Item -Path $parent -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host (Get-I18n -key 'remove.fountInstallationDirRemoved')
