function script:New-FountExe($executablePath = "fount.exe") {
	Test-PWSHModule ps12exe
	ps12exe -inputFile "$FOUNT_DIR/src/runner/main.ps1" -outputFile $executablePath
}

function script:Install-FountRootExe {
	$executablePath = "$FOUNT_DIR/fount.exe"
	if (Test-Path -LiteralPath $executablePath) { return }
	New-FountExe $executablePath
}
