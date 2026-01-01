prettier "**/*.{md,yaml,yml,toml}" --write --single-quote --log-level error
prettier . --check --log-level error
eslint --fix --quiet
$excludePattern = "[\\/]\.git[\\/]|[\\/]node_modules[\\/]"
Get-ChildItem -Path "$psscriptroot/../.." -Recurse -File | Where-Object { $_.FullName -notmatch $excludePattern } | ForEach-Object {
	try {
		$originalContent = Get-Content -Path $_.FullName -Raw
	}
	catch {
		Write-Error "Failed to read file: $($_.Exception.Message)"
		return
	}
	if ([string]::IsNullOrEmpty($originalContent)) {
		return
	}
	if ($originalContent.IndexOf([char]0, 0, [System.Math]::Min($originalContent.Length, 10)) -ge 0) {
		return
	}
	$modifiedContent = $originalContent -replace '\r\n', '\n'
	$modifiedContent = $modifiedContent -replace '\r', '\n'
	$modifiedContent = $modifiedContent -replace '^\n+', ''
	$modifiedContent = $modifiedContent.TrimEnd() + "`n"
	if ($modifiedContent -ne $originalContent) {
		try {
			[System.IO.File]::WriteAllText($_.FullName, $modifiedContent, [System.Text.UTF8Encoding]::new($false))
		}
		catch {
			Write-Error "Failed to write file: $($_.Exception.Message)"
		}
	}
}
