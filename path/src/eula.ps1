# First-run EULA gate (ensure_fount_config / Ensure-FountConfig when data/config.json is missing).

$script:FountEulaUrl = 'https://steve02081504.github.io/fount/EULA/'
$script:FountInstallWaitUrl = 'https://steve02081504.github.io/fount/wait/install/?from=runner'
$script:FountEulaPs1Path = Join-Path $PSScriptRoot 'eula.ps1'

function script:Test-FountEulaEnvAccepted {
	$env:FOUNT_ACCEPT_EULA -match '^(?i)(1|true|yes)$'
}

function script:Copy-FountDefaultConfig {
	$dest = Join-Path $FOUNT_DIR 'data/config.json'
	if (Test-Path -LiteralPath $dest) { return }
	New-Item -Path (Join-Path $FOUNT_DIR 'data') -ItemType Directory -Force | Out-Null
	Copy-Item -LiteralPath (Join-Path $FOUNT_DIR 'default/config.json') -Destination $dest
}

function script:Format-FountOsc8Link([string]$Url) {
	if (-not ($Host.UI.SupportsVirtualTerminal -and -not [System.Console]::IsOutputRedirected)) {
		return $Url
	}
	$esc = [char]27
	return "${esc}]8;;${Url}${esc}\${Url}${esc}]8;;${esc}\"
}

function script:Test-FountConsoleInput {
	try {
		$null = [Console]::KeyAvailable
		return $true
	}
	catch { return $false }
}

function script:Write-FountEulaAcceptFromRequest {
	param($Request, [string]$AcceptFile)
	if ($Request.HttpMethod -eq 'GET' -and $Request.Url.AbsolutePath.TrimEnd('/') -eq '/eula' -and $Request.Headers['Origin'] -eq 'https://steve02081504.github.io') {
		Set-Content -LiteralPath $AcceptFile -Value '1' -Encoding ascii
	}
}

function script:Start-FountStatusServer {
	param([string]$AcceptFile)
	$scriptBlock = {
		param($AcceptFile, $EulaPs1)
		. $EulaPs1
		$listener = [System.Net.HttpListener]::new()
		$listener.Prefixes.Add("http://localhost:8930/")
		$listener.Start()
		try {
			while ($true) {
				$context = $listener.GetContext()
				$response = $context.Response
				$response.AddHeader("Access-Control-Allow-Origin", "https://steve02081504.github.io")
				Write-FountEulaAcceptFromRequest $context.Request $AcceptFile
				$eula = if (Test-Path -LiteralPath $AcceptFile) { 'accepted' } else { 'pending' }
				$message = if ($eula -eq 'accepted') { 'accepted' } else { 'pong' }
				$buffer = [System.Text.Encoding]::UTF8.GetBytes("{`"message`":`"$message`",`"eula`":`"$eula`"}")
				$response.ContentType = "application/json"
				$response.ContentLength64 = $buffer.Length
				$response.OutputStream.Write($buffer, 0, $buffer.Length)
				$response.Close()
			}
		}
		finally {
			$listener.Stop()
			$listener.Close()
		}
	}
	return Start-Job -ScriptBlock $scriptBlock -ArgumentList $AcceptFile, $script:FountEulaPs1Path
}

function script:Begin-FountInstallWait {
	$env:FOUNT_INSTALL_WAIT = '1'
}

function script:Stop-FountStatusServer {
	if ($null -ne $script:FountStatusServerJob) {
		Stop-Job $script:FountStatusServerJob -ErrorAction SilentlyContinue
		Remove-Job $script:FountStatusServerJob -Force -ErrorAction SilentlyContinue
		$script:FountStatusServerJob = $null
	}
	Remove-Item Env:\FOUNT_INSTALL_WAIT -Force -ErrorAction Ignore
	if ($script:FountEulaAcceptFile) {
		Remove-Item -LiteralPath $script:FountEulaAcceptFile -Force -ErrorAction Ignore
		$script:FountEulaAcceptFile = $null
	}
}

function script:Ensure-FountConfig {
	if (Test-Path -Path "$FOUNT_DIR/data/config.json") { return }
	if ((Test-FountEulaEnvAccepted) -or (in_docker)) {
		Copy-FountDefaultConfig
		return
	}
	require win/refresh_path win/winget browser
	if (-not (Test-FountConsoleInput)) {
		$Host.UI.WriteErrorLine((Get-I18n -key 'eula.required'))
		$Host.UI.WriteErrorLine($script:FountEulaUrl)
		& (Join-Path $FOUNT_DIR 'path/fount.ps1') remove
		exit 1
	}
	$script:FountEulaAcceptFile = Join-Path ([IO.Path]::GetTempPath()) "fount-eula-accepted-$PID"
	Remove-Item -LiteralPath $script:FountEulaAcceptFile -Force -ErrorAction Ignore
	$script:FountStatusServerJob = Start-FountStatusServer -AcceptFile $script:FountEulaAcceptFile
	Test-Browser
	Begin-FountInstallWait
	Start-Process $script:FountInstallWaitUrl
	if (-not (Confirm-FountEula -AcceptFile $script:FountEulaAcceptFile)) {
		Write-Host (Get-I18n -key 'eula.declined')
		Stop-FountStatusServer
		& (Join-Path $FOUNT_DIR 'path/fount.ps1') remove
		exit 1
	}
	Copy-FountDefaultConfig
}

function script:Confirm-FountEula {
	param([string]$AcceptFile)
	if (Test-FountEulaEnvAccepted) { return $true }
	if ($AcceptFile -and (Test-Path -LiteralPath $AcceptFile)) { return $true }
	if (-not (Test-FountConsoleInput)) {
		$Host.UI.WriteErrorLine((Get-I18n -key 'eula.required'))
		$Host.UI.WriteErrorLine($script:FountEulaUrl)
		return $false
	}
	Write-Host (Get-I18n -key 'eula.prompt')
	Write-Host (Format-FountOsc8Link $script:FountEulaUrl)
	Write-Host -NoNewline (Get-I18n -key 'eula.yn')
	while ($true) {
		if (Test-Path -LiteralPath $AcceptFile) {
			Write-Host "Y"
			return $true
		}
		if ([Console]::KeyAvailable) {
			$key = [Console]::ReadKey($true)
			if ($key.Key -eq 'Y' -or $key.KeyChar -eq 'y' -or $key.KeyChar -eq 'Y') {
				Set-Content -LiteralPath $AcceptFile -Value '1' -Encoding ascii
				Write-Host "Y"
				return $true
			}
			if ($key.Key -eq 'N' -or $key.KeyChar -eq 'n' -or $key.KeyChar -eq 'N') {
				Write-Host "N"
				return $false
			}
		}
		Start-Sleep -Milliseconds 150
	}
}
