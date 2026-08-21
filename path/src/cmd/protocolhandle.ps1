function script:cmd_protocolhandle {
	require passthrough win/refresh_path win/winget browser win/wt packages run
	handle_docker_passthrough @args
	$protocolUrl = @($args | Select-Object -Skip 1)[0]
	if (-not $protocolUrl) {
		Write-Error (Get-I18n -key 'protocol.noUrl')
		exit 1
	}
	if ($protocolUrl -eq 'fount://nop/') {
		& (Join-Path $FOUNT_DIR 'path/fount.ps1') background keepalive
		exit $LastExitCode
	}
	$encodedUrl = [uri]::EscapeDataString($protocolUrl)
	$targetUrl = "https://steve02081504.github.io/fount/protocol/?url=$encodedUrl"

	Test-PWSHModule fount-pwsh
	Start-Job -ScriptBlock {
		$targetUrl = $args[0]
		Test-Browser
		while (-not (Test-FountRunning)) {
			Start-Sleep -Seconds 1
		}
		Start-Process $targetUrl
	} -ArgumentList $targetUrl
	Start-WTfountCmd
	exit 0
}
