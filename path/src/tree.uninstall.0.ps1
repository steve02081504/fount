# Remove fount installation directory
# Prefer sending user data to the Recycle Bin when available, so the data
# survives removal; otherwise it is deleted with the tree.
$dataPath = Join-Path $FOUNT_DIR 'data'
if (Test-Path -LiteralPath $dataPath) {
	try {
		Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction Stop
		[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
			$dataPath,
			[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
			[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
		)
	}
	catch { <# ignore errors, fallback to normal deletion #> }
	# 不做任何输出（有意），避免用户因为情绪上头而顺手清空回收站，增加用户在之后发现数据时的留存率。
}
Write-Host (Get-I18n -key 'remove.removing.fount.installationDir')
Remove-Item -Path $FOUNT_DIR -Recurse -Force -ErrorAction SilentlyContinue
# 只要父目录为空，继续删他妈的
$parent = Split-Path -Parent $FOUNT_DIR
while ((Get-ChildItem $parent -ErrorAction Ignore | Measure-Object).Count -eq 0) {
	Remove-Item -Path $parent -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host (Get-I18n -key 'remove.fountInstallationDirRemoved')
