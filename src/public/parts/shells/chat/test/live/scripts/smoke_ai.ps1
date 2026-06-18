$ErrorActionPreference = 'Stop'
$base = 'http://localhost:8931'
$k = $env:FOUNT_API_KEY

function Api($method, $path, $body) {
	$uri = "$base/api/parts/shells:chat$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$k" } else { $uri += "?fount-apikey=$k" }
	$params = @{ Method = $method; Uri = $uri; UseBasicParsing = $true }
	if ($null -ne $body) {
		$params.ContentType = 'application/json'
		$params.Body = ($body | ConvertTo-Json -Depth 12 -Compress)
	}
	try {
		$resp = Invoke-WebRequest @params
		Write-Host "[$method $path] -> $($resp.StatusCode)" -ForegroundColor Green
		if ($resp.Content) { return ($resp.Content | ConvertFrom-Json) }
	} catch {
		$status = $_.Exception.Response.StatusCode.value__
		Write-Host "[$method $path] -> ERROR $status" -ForegroundColor Red
		if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Yellow }
		else { Write-Host $_.Exception.Message -ForegroundColor Yellow }
		throw
	}
}

Write-Host "=== 1. Create group ===" -ForegroundColor Cyan
$g = Api POST '/groups/' @{ name = 'AI测试群'; defaultChannelName = '综合' }
$groupId = $g.groupId; $channelId = $g.defaultChannelId
Write-Host "groupId=$groupId channelId=$channelId"

Write-Host "`n=== 2. Add char test_streamer ===" -ForegroundColor Cyan
Api POST "/groups/$groupId/char" @{ charname = 'test_streamer' } | Out-Null

Write-Host "`n=== 2b. char list ===" -ForegroundColor Cyan
(Api GET "/groups/$groupId/chars") | ConvertTo-Json -Depth 4

Write-Host "`n=== 3. Send user message ===" -ForegroundColor Cyan
Api POST "/groups/$groupId/channels/$channelId/messages" @{ content = @{ type = 'text'; content = '请说点什么' } } | Out-Null

Write-Host "`n=== 4. Trigger char reply ===" -ForegroundColor Cyan
Api POST "/groups/$groupId/channels/$channelId/trigger-reply" @{ charname = 'test_streamer' } | Out-Null

Write-Host "`n=== 5. Poll messages for 15s ===" -ForegroundColor Cyan
for ($i = 0; $i -lt 8; $i++) {
	Start-Sleep -Seconds 2
	$msgs = Api GET "/groups/$groupId/channels/$channelId/messages?limit=20"
	$lines = $msgs.messages | ForEach-Object {
		$c = $_.content
		$txt = if ($c.content) { $c.content } else { ($c | ConvertTo-Json -Compress) }
		$gen = if ($_.content.is_generating) { ' [GEN]' } else { '' }
		"  [$($_.charId ?? 'user')] $txt$gen"
	}
	Write-Host "poll #$i ($($msgs.messages.Count) msgs):"
	$lines | ForEach-Object { Write-Host $_ }
}

Write-Host "`n=== DONE === groupId=$groupId" -ForegroundColor Cyan
