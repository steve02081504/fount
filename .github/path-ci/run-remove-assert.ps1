# Copy this directory out of FOUNT_DIR first — `remove` deletes the install tree.
param(
	[Parameter(Mandatory = $true)][string]$Fount
)
$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
$outFile = Join-Path $env:TEMP "fount-remove-out-$PID.txt"
$exitCode = 1
try {
	$output = & $Fount remove 2>&1 | Out-String
	$exitCode = $LastExitCode
}
catch {
	$exitCode = 1
	$output = "$_"
}
[IO.File]::WriteAllText($outFile, $output)
Write-Host $output
& (Join-Path $here 'assert-remove-clean.ps1') -PatternsFile (Join-Path $here 'remove-noise.patterns') -OutputFile $outFile
if ($LastExitCode) { exit $LastExitCode }
exit $exitCode
