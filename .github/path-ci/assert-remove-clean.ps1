# Fail if captured `fount remove` output matches remove-noise.patterns.
param(
	[Parameter(Mandatory = $true)][string]$PatternsFile,
	[Parameter(Mandatory = $true)][string]$OutputFile
)
$output = [IO.File]::ReadAllText($OutputFile)
foreach ($line in Get-Content -LiteralPath $PatternsFile) {
	$pattern = $line.Trim()
	if (-not $pattern -or $pattern.StartsWith('#')) { continue }
	if ($output -match $pattern) {
		Write-Host "remove output matched noise pattern: $pattern"
		Write-Host '--- captured output ---'
		Write-Host $output
		exit 1
	}
}
