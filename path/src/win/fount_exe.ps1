function script:Ensure-FountFavicon {
	$iconPath = "$FOUNT_DIR/src/public/pages/favicon.ico"
	if (Test-Path -LiteralPath $iconPath) { return }

	Write-Host (Get-I18n -key 'install.compilingFavicon')
	run shutdown
	$global:LastExitCode = 0
}

function script:New-FountExe($executablePath = "fount.exe") {
	Ensure-FountFavicon
	Test-PWSHModule ps12exe
	ps12exe -inputFile "$FOUNT_DIR/src/runner/main.ps1" -outputFile $executablePath
}

function script:Install-FountRootExe {
	$executablePath = "$FOUNT_DIR/fount.exe"
	if (Test-Path -LiteralPath $executablePath) { return }
	New-FountExe $executablePath
}
