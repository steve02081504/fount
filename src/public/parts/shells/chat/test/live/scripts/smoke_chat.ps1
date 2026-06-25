$ErrorActionPreference = 'Stop'
$base = if ($env:FOUNT_TEST_BASE_URL) { $env:FOUNT_TEST_BASE_URL } else { throw 'FOUNT_TEST_BASE_URL required; run via test/live/run.mjs' }
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
$g = Api POST '/groups/' @{ name = 'SmokeTest群'; description = '冒烟测试'; defaultChannelName = '综合' }
$g | ConvertTo-Json -Depth 6
$groupId = $g.groupId
$channelId = $g.defaultChannelId
Write-Host "groupId=$groupId channelId=$channelId" -ForegroundColor Cyan

Write-Host "`n=== 2. Group state ===" -ForegroundColor Cyan
$state = Api GET "/groups/$groupId/state"
$state | ConvertTo-Json -Depth 8

Write-Host "`n=== 3. Send message ===" -ForegroundColor Cyan
$m = Api POST "/groups/$groupId/channels/$channelId/messages" @{ content = @{ type = 'text'; content = '你好，这是第一条冒烟测试消息' } }
$m | ConvertTo-Json -Depth 6

Write-Host "`n=== 4. Read messages ===" -ForegroundColor Cyan
$msgs = Api GET "/groups/$groupId/channels/$channelId/messages?limit=20"
$msgs | ConvertTo-Json -Depth 8

Write-Host "`n=== DONE === groupId=$groupId channelId=$channelId" -ForegroundColor Cyan
