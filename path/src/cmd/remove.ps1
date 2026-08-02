function Invoke-FountCmdRemove {
	Register-FountTerminalTeardown
	$hooks = Get-ChildItem -Path $script:FOUNT_SRC -Recurse -Filter '*.uninstall.*.ps1' -File
	$sorted = $hooks | ForEach-Object {
		if ($_.Name -match '\.uninstall\.(\d+)\.ps1$') {
			[PSCustomObject]@{
				Path = $_.FullName
				Lv   = [int]$Matches[1]
				Rel  = $_.FullName.Substring($script:FOUNT_SRC.Length).TrimStart('\', '/')
			}
		}
	} | Sort-Object -Property @{ Expression = 'Lv'; Descending = $true }, @{ Expression = 'Rel'; Descending = $false }

	foreach ($hook in $sorted) {
		. $hook.Path
	}

	Write-Host (Get-I18n -key 'remove.fountUninstallationComplete')
	Complete-FountTerminalTeardown
	exit 0
}
