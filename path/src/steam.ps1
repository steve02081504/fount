function script:Invoke-FountSteamJs([string]$Action) {
	$errorCount = $Error.Count
	try {
		$output = deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/path/src/steam.mjs" $Action $FOUNT_DIR 2>&1 | Out-String
		if ($output -match '(?m)^FOUNT_STEAM:(.+)$') { return $Matches[1] | ConvertFrom-Json }
		if ($LastExitCode) { return [pscustomobject]@{ status = 'error'; message = $output.Trim() } }
		return [pscustomobject]@{ status = 'skip' }
	}
	catch {
		return [pscustomobject]@{ status = 'error'; message = $_.Exception.Message }
	}
	finally {
		while ($Error.Count -gt $errorCount) { $Error.RemoveAt(0) }
		$global:LastExitCode = 0
	}
}

function script:Register-FountSteam {
	if (in_container) { return }
	$probe = Invoke-FountSteamJs probe
	if ($probe.status -ne 'ready') { return }
	if ($IsWindows) {
		require win/fount_exe
		$executablePath = "$FOUNT_DIR/fount.exe"
		if (-not (Test-Path -LiteralPath $executablePath)) {
			$errorCount = $Error.Count
			New-FountExe $executablePath
			while ($Error.Count -gt $errorCount) { $Error.RemoveAt(0) }
			$global:LastExitCode = 0
			if (-not (Test-Path -LiteralPath $executablePath)) {
				Write-Warning (Get-I18n -key 'steam.exeFailed')
				return
			}
		}
	}
	Write-Host (Get-I18n -key 'steam.registering')
	$result = Invoke-FountSteamJs register
	if ($result.status -eq 'ok') {
		Write-Host (Get-I18n -key 'steam.registered')
		return
	}
	if ($result.status -eq 'need_exe') {
		Write-Warning (Get-I18n -key 'steam.exeFailed')
		return
	}
	if ($result.status -eq 'error') {
		Write-Warning (Get-I18n -key 'steam.failed' -params @{ message = $result.message })
	}
}

function script:Unregister-FountSteam {
	$probe = Invoke-FountSteamJs probe
	if ($probe.status -ne 'ready') { return }
	Write-Host (Get-I18n -key 'remove.removing.steamShortcut')
	$result = Invoke-FountSteamJs unregister
	if ($result.status -eq 'ok' -and $result.action -eq 'removed') {
		Write-Host (Get-I18n -key 'remove.steamShortcutRemoved')
		return
	}
	if ($result.status -eq 'error') {
		Write-Warning (Get-I18n -key 'steam.failed' -params @{ message = $result.message })
		return
	}
	Write-Host (Get-I18n -key 'remove.steamShortcutNotFound')
}
