function script:New-FountExe($executablePath) {
	if (!$executablePath) { $executablePath = "fount.exe" }
	Test-PWSHModule ps12exe
	ps12exe -inputFile "$FOUNT_DIR/src/runner/main.ps1" -outputFile $executablePath
}

function script:Install-FountRootExe {
	$exePath = "$FOUNT_DIR/fount.exe"
	if (Test-Path -LiteralPath $exePath) { return }
	New-FountExe $exePath
}
