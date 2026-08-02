function Invoke-FountCmdGeneexe {
	param([string[]]$CommandArgs)
	Invoke-FountBootstrapFull -CommandArgs $CommandArgs
	$exepath = $CommandArgs[1]
	if (!$exepath) { $exepath = "fount.exe" }
	if (!(Get-Command ps12exe -ErrorAction Ignore)) {
		Install-Module -Name ps12exe -Scope CurrentUser -Force
	}
	ps12exe -inputFile "$FOUNT_DIR/src/runner/main.ps1" -outputFile $exepath
}
