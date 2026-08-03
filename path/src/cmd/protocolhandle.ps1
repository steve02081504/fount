function script:Invoke-FountCmdProtocolhandle {
	param([string[]]$CommandArgs)
	. $FountRequireMany passthrough win/refresh_path win/winget browser win/wt packages run
	Invoke-DockerPassthrough -CurrentArgs $CommandArgs
	$protocolUrl = $CommandArgs[1]
	if (-not $protocolUrl) {
		Write-Error (Get-I18n -key 'protocol.noUrl')
		exit 1
	}
	if ($protocolUrl -eq 'fount://nop/') {
		Start-WTfountCmd
		exit $LastExitCode
	}
	$encodedUrl = [uri]::EscapeDataString($protocolUrl)
	$targetUrl = "https://steve02081504.github.io/fount/protocol/?url=$encodedUrl"

	Test-PWSHModule fount-pwsh
	Start-Job -ScriptBlock {
		param ($targetUrl)
		Test-Browser
		while (-not (Test-FountRunning)) {
			Start-Sleep -Seconds 1
		}
		Start-Process $targetUrl
	} -ArgumentList $targetUrl
	Start-WTfountCmd
	exit $LastExitCode
}
