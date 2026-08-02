function Invoke-FountCmdProtocolhandle {
	param([string[]]$CommandArgs)
	Invoke-DockerPassthrough -CurrentArgs $CommandArgs
	$protocolUrl = $CommandArgs[1]
	if ($protocolUrl -eq 'fount://nop/') {
		Start-WTfountCmd
		exit $LastExitCode
	}
	if (-not $protocolUrl) {
		Write-Error (Get-I18n -key 'protocol.noUrl')
		exit 1
	}
	# 编码 URL 参数，防止特殊字符问题，确保传入的 URL 能正确作为查询参数
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
