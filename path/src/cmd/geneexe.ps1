function script:Invoke-FountCmdGeneexe {
	Invoke-FountBootstrapFull @args
	$exepath = $args[1]
	if (!$exepath) { $exepath = "fount.exe" }
	if (!(Get-Command ps12exe -ErrorAction Ignore)) {
		Install-Module -Name ps12exe -Scope CurrentUser -Force
	}
	ps12exe -inputFile "$FOUNT_DIR/src/runner/main.ps1" -outputFile $exepath
}
