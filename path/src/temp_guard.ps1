function script:Test-InTempDirectory($Directory) {
	try { $resolved = (Resolve-Path -LiteralPath $Directory).Path }
	catch { $resolved = $Directory }

	$candidates = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
	[void]$candidates.Add([System.IO.Path]::GetTempPath().TrimEnd('\', '/'))
	foreach ($candidate in @($env:TEMP, $env:TMP)) {
		if ($candidate) { [void]$candidates.Add($candidate.TrimEnd('\', '/')) }
	}
	if ($env:WINDIR) { [void]$candidates.Add((Join-Path $env:WINDIR 'Temp').TrimEnd('\', '/')) }

	foreach ($temp in $candidates) {
		try { $resolvedTemp = (Resolve-Path -LiteralPath $temp).Path }
		catch { $resolvedTemp = $temp }
		if ($resolved -ieq $resolvedTemp -or $resolved.StartsWith("$resolvedTemp\", [System.StringComparison]::OrdinalIgnoreCase)) {
			return $true
		}
	}
	return $false
}
