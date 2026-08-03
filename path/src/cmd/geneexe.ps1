function script:cmd_geneexe {
	bootstrap_full @args
	$args = @($args | Select-Object -Skip 1)
	$exepath = $args[0]
	if (!$exepath) { $exepath = "fount.exe" }
	if (!(Get-Command ps12exe -ErrorAction Ignore)) {
		Install-Module -Name ps12exe -Scope CurrentUser -Force
	}
	ps12exe -inputFile "$FOUNT_DIR/src/runner/main.ps1" -outputFile $exepath
}
