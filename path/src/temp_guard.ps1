function script:is_in_temp_dir($dir) {
	try { $resolved = (Resolve-Path -LiteralPath $dir).Path }
	catch { $resolved = $dir }

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

function script:check_temp_guard($cmd) {
	if ($cmd -ne 'remove' -and (is_in_temp_dir $FOUNT_DIR)) {
		Write-Host (Get-I18n -key 'tempDir.blocked')
		exit 1
	}
}
