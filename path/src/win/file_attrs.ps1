function script:Initialize-FountDesktopIni {
	if ((Test-Path "$FOUNT_DIR/.git") -and (-not (Test-Path "$FOUNT_DIR/.git/desktop.ini"))) {
		Copy-Item "$FOUNT_DIR/default/git_desktop.ini" "$FOUNT_DIR/.git/desktop.ini" -Force
	}
	New-InstallerDir # For data/desktop.ini
	if (-not (Test-Path "$FOUNT_DIR/data/desktop.ini")) {
		Copy-Item "$FOUNT_DIR/default/default_desktop.ini" "$FOUNT_DIR/data/desktop.ini" -Force -ErrorAction SilentlyContinue
	}
	if (-not (Test-Path "$FOUNT_DIR/node_modules/desktop.ini")) {
		Copy-Item "$FOUNT_DIR/default/node_modules_desktop.ini" "$FOUNT_DIR/node_modules/desktop.ini" -Force -ErrorAction SilentlyContinue
	}
	Set-FountFileAttributes
}

function script:Set-FountFileAttributes {
	Get-ChildItem $FOUNT_DIR -Recurse -Filter desktop.ini -Force | ForEach-Object {
		$Dir = Get-Item $(Split-Path $_.FullName) -Force
		$Dir.Attributes = $Dir.Attributes -bor [System.IO.FileAttributes]::ReadOnly -bor [System.IO.FileAttributes]::Directory
		$_.Attributes = $_.Attributes -bor [System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::System
	}
	Get-ChildItem $FOUNT_DIR -Recurse -Filter .* | ForEach-Object {
		$_.Attributes = $_.Attributes -bor [System.IO.FileAttributes]::Hidden
	}
}
