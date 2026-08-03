function script:Invoke-FountCmdRemove {
	Invoke-FountRequireRuntime
	Register-FountTerminalTeardown
	$completeMessage = Get-I18n -key 'remove.fountUninstallationComplete'
	Get-ChildItem -Path $script:FOUNT_SRC -Recurse -Filter '*.uninstall.*.ps1' -File |
		ForEach-Object {
			if ($_.Name -match '\.uninstall\.(\d+)\.ps1$') {
				[PSCustomObject]@{
					Path         = $_.FullName
					Level        = [int]$Matches[1]
					RelativePath = $_.FullName.Substring($script:FOUNT_SRC.Length).TrimStart('\', '/')
				}
			}
		} |
		Sort-Object -Property @{ Expression = 'Level'; Descending = $true }, @{ Expression = 'RelativePath'; Descending = $false } |
		ForEach-Object { . $_.Path }

	Write-Host $completeMessage
	Complete-FountTerminalTeardown
	exit 0
}
