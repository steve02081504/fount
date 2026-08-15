# First-run EULA gate (cmd_open when data/config.json is missing).

$script:FountEulaUrl = 'https://steve02081504.github.io/fount/EULA/'
$script:FountInstallWaitUrl = 'https://steve02081504.github.io/fount/wait/install/?from=runner'

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

function script:Start-FountStatusServer {
	param([string]$AcceptFile)
	$scriptBlock = {
		param($AcceptFile)
		$listener = [System.Net.HttpListener]::new()
		$listener.Prefixes.Add("http://localhost:8930/")
		$listener.Start()
		try {
			while ($true) {
				$context = $listener.GetContext()
				$response = $context.Response
				$response.AddHeader("Access-Control-Allow-Origin", "https://steve02081504.github.io")
				$path = $context.Request.Url.AbsolutePath.TrimEnd('/')
				$method = $context.Request.HttpMethod
				$origin = $context.Request.Headers['Origin']
				if ($method -eq 'GET' -and $path -eq '/eula' -and $origin -eq 'https://steve02081504.github.io') {
					Set-Content -LiteralPath $AcceptFile -Value '1' -Encoding ascii
				}
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
	return Start-Job -ScriptBlock $scriptBlock -ArgumentList $AcceptFile
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
