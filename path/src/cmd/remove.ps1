function script:Invoke-FountCmdRemove {
	Invoke-FountRequireRuntime
	Register-FountTerminalTeardown
	$completeMessage = Get-I18n -key 'remove.fountUninstallationComplete'
	Get-ChildItem -Path $script:FOUNT_SRC -Recurse -Filter '*.uninstall.*.ps1' -File |
		ForEach-Object {
			if ($_.Name -match '\.uninstall\.(\d+)\.ps1$') {
				[PSCustomObject]@{
					Path = $_.FullName
					Lv   = [int]$Matches[1]
					Rel  = $_.FullName.Substring($script:FOUNT_SRC.Length).TrimStart('\', '/')
				}
			}
		} |
		Sort-Object -Property @{ Expression = 'Lv'; Descending = $true }, @{ Expression = 'Rel'; Descending = $false } |
		ForEach-Object { . $_.Path }

	Write-Host $completeMessage
	Complete-FountTerminalTeardown
	exit 0
}
