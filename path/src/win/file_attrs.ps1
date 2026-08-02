function Set-FountFileAttributes {
	Get-ChildItem $FOUNT_DIR -Recurse -Filter desktop.ini -Force | ForEach-Object {
		$Dir = Get-Item $(Split-Path $_.FullName) -Force
		$Dir.Attributes = $Dir.Attributes -bor [System.IO.FileAttributes]::ReadOnly -bor [System.IO.FileAttributes]::Directory
		$_.Attributes = $_.Attributes -bor [System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::System
	}
	Get-ChildItem $FOUNT_DIR -Recurse -Filter .* | ForEach-Object {
		$_.Attributes = $_.Attributes -bor [System.IO.FileAttributes]::Hidden
	}
}
