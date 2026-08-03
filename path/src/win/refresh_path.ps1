function script:RefreshPath {
	$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}
function script:MergePath {
	$registry = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
	$parts = @($env:PATH -split ';' | Where-Object { $_ })
	foreach ($entry in ($registry -split ';')) {
		if ($entry -and ($parts -notcontains $entry)) {
			$parts += $entry
		}
	}
	$env:PATH = $parts -join ';'
}
