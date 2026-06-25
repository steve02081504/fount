$ErrorActionPreference = 'Stop'
$base = if ($env:FOUNT_TEST_BASE_URL) { $env:FOUNT_TEST_BASE_URL.Trim().TrimEnd('/') } else { throw 'FOUNT_TEST_BASE_URL required; run via test/live/run.mjs' }
$k = $env:FOUNT_API_KEY
if (-not $k) { throw 'No FOUNT_API_KEY' }

function Api($method, $path, $body) {
	$uri = "$base/api/parts/shells:chat$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$k" } else { $uri += "?fount-apikey=$k" }
	$params = @{ Method = $method; Uri = $uri; UseBasicParsing = $true; TimeoutSec = 90 }
	if ($null -ne $body) {
		$params.ContentType = 'application/json'
		$params.Body = ($body | ConvertTo-Json -Depth 12 -Compress)
	}
	$resp = Invoke-WebRequest @params
	if ($resp.Content) { return ($resp.Content | ConvertFrom-Json) }
}

Write-Host "=== 1. Create group ===" -ForegroundColor Cyan
$g = Api POST '/groups/' @{ name = 'AI测试群'; defaultChannelName = '综合' }
$groupId = $g.groupId; $channelId = $g.defaultChannelId
Write-Host "groupId=$groupId channelId=$channelId"

Write-Host "`n=== 2. Add char test_streamer ===" -ForegroundColor Cyan
Api POST "/groups/$groupId/char" @{ charname = 'test_streamer' } | Out-Null

Write-Host "`n=== 3. Send user message ===" -ForegroundColor Cyan
Api POST "/groups/$groupId/channels/$channelId/messages" @{ content = @{ type = 'text'; content = '请说点什么' } } | Out-Null

Write-Host "`n=== 4. Trigger char reply ===" -ForegroundColor Cyan
Api POST "/groups/$groupId/channels/$channelId/trigger-reply" @{ charname = 'test_streamer' } | Out-Null

Write-Host "`n=== 5. Poll for char reply (<=20s) ===" -ForegroundColor Cyan
$charReply = $false
for ($i = 0; $i -lt 10; $i++) {
	Start-Sleep -Seconds 2
	$msgs = Api GET "/groups/$groupId/channels/$channelId/messages?limit=20"
	$charMsg = @($msgs.messages | Where-Object { $_.charId -and -not $_.content.is_generating })
	if ($charMsg.Count -ge 1) {
		$charReply = $true
		Write-Host "  ok    char reply after poll #$i" -ForegroundColor Green
		break
	}
	Write-Host "poll #$i ($($msgs.messages.Count) msgs, waiting for char...)"
}
if (-not $charReply) {
	Write-Host "  FAIL  no char reply within timeout" -ForegroundColor Red
	exit 1
}

Write-Host "`n=== PASS smoke_ai ===" -ForegroundColor Green
