# L4 双节点联邦 live 探针共用库。

if (-not $env:FOUNT_TEST_BASE_URL?.Trim()) { throw 'FOUNT_TEST_BASE_URL is required; run via test/live/run.mjs' }
if (-not $env:FOUNT_API_KEY?.Trim()) { throw 'FOUNT_API_KEY is required for NodeA; run via test/live/run.mjs.' }

$script:FedA = @{
	base = $env:FOUNT_TEST_BASE_URL.Trim().TrimEnd('/')
	key = $env:FOUNT_API_KEY.Trim()
	name = 'A'
	dataPath = $env:FOUNT_NODE_A_DATA
}
if (-not $env:FOUNT_TEST_NODE_B_BASE_URL?.Trim()) { throw 'FOUNT_TEST_NODE_B_BASE_URL is required for fed suites; run via test/live/run.mjs' }
$script:FedB = @{
	base = $env:FOUNT_TEST_NODE_B_BASE_URL.Trim().TrimEnd('/')
	key = $(if ($env:FOUNT_TEST_NODE_B_KEY) { $env:FOUNT_TEST_NODE_B_KEY.Trim() } else { throw 'FOUNT_TEST_NODE_B_KEY is required' })
	name = 'B'
	dataPath = $env:FOUNT_NODE_B_DATA
}

$script:pass = 0; $script:fail = 0; $script:skip = 0
$script:failures = @()

function FedUri($node, $path) {
	$uri = "$($node.base)$path"
	if ($uri -match '\?') { "$uri&fount-apikey=$($node.key)" } else { "$uri?fount-apikey=$($node.key)" }
}

function Invoke-FedRequest($node, $method, $path, $body, $timeoutSec = 180) {
	$params = @{ Method = $method; Uri = (FedUri $node $path); UseBasicParsing = $true; TimeoutSec = $timeoutSec; SkipHttpErrorCheck = $true }
	if ($null -ne $body) { $params.ContentType = 'application/json'; $params.Body = ($body | ConvertTo-Json -Depth 16 -Compress) }
	$response = Invoke-WebRequest @params
	$json = $null
	if ($response.Content) { try { $json = $response.Content | ConvertFrom-Json } catch { $json = $response.Content } }
	[pscustomobject]@{ status = [int]$response.StatusCode; json = $json; raw = $response.Content }
}

function ShellApi($node, $shell, $method, $path, $body) {
	Invoke-FedRequest $node $method "/api/parts/shells:$shell$path" $body
}

function Api($node, $method, $path, $body) {
	ShellApi $node 'chat' $method $path $body
}

function P2pApi($node, $method, $path, $body) {
	Invoke-FedRequest $node $method "/api/p2p$path" $body
}

function RootApi($node, $method, $path, $body) {
	Invoke-FedRequest $node $method $path $body 60
}

function ApiMultipart($node, $method, $path, $fields, $fileField, $fileName, $fileBytes, $contentType = 'image/png') {
	ShellApiMultipart $node 'chat' $method $path $fields $fileField $fileName $fileBytes $contentType
}

function ShellApiMultipart($node, $shell, $method, $path, $fields, $fileField, $fileName, $fileBytes, $contentType = 'image/png') {
	$uri = FedUri $node "/api/parts/shells:$shell$path"
	$handler = [System.Net.Http.HttpClientHandler]::new()
	$client = [System.Net.Http.HttpClient]::new($handler)
	$client.Timeout = [TimeSpan]::FromSeconds(120)
	try {
		$form = [System.Net.Http.MultipartFormDataContent]::new()
		foreach ($kv in $fields.GetEnumerator()) {
			$form.Add([System.Net.Http.StringContent]::new([string]$kv.Value), $kv.Key)
		}
		$bytes = [System.Net.Http.ByteArrayContent]::new($fileBytes)
		$bytes.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($contentType)
		$form.Add($bytes, $fileField, $fileName)
		$request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($method), $uri)
		$request.Content = $form
		$response = $client.SendAsync($request).GetAwaiter().GetResult()
		$raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
		$json = $null
		if ($raw) { try { $json = $raw | ConvertFrom-Json } catch { $json = $raw } }
		[pscustomobject]@{ status = [int]$response.StatusCode; json = $json; raw = $raw }
	}
	finally {
		$client.Dispose()
		$handler.Dispose()
	}
}

function Test-Case($name, $block) {
	try {
		$ok = & $block
		if ($ok -eq $false) { $script:fail++; $script:failures += $name; Write-Host "  FAIL  $name" -ForegroundColor Red }
		else { $script:pass++; Write-Host "  ok    $name" -ForegroundColor Green }
	}
	catch {
		$script:fail++; $script:failures += "$name :: $($_.Exception.Message)"
		Write-Host "  FAIL  $name :: $($_.Exception.Message)" -ForegroundColor Red
	}
}

function Skip-Case($name, $why) { $script:skip++; Write-Host "  skip  $name ($why)" -ForegroundColor DarkGray }

function PollUntil($timeoutSec, $intervalSec, $probe) {
	$deadline = (Get-Date).AddSeconds($timeoutSec)
	$last = $null
	do {
		$last = & $probe
		if ($last) { return $last }
		Start-Sleep $intervalSec
	} while ((Get-Date) -lt $deadline)
	return $last
}

function Wait-FedMembers($node, $groupId, $minMembers = 2, $timeoutSec = 120) {
	[bool](PollUntil $timeoutSec 3 {
		Api $node POST "/groups/$groupId/federation/catchup" @{ waitMs = 5000 } | Out-Null
		Api $node POST "/groups/$groupId/dag/merge-tips" @{} | Out-Null
		$state = Api $node GET "/groups/$groupId/state"
		$state.status -eq 200 -and $state.json.state.isMember -eq $true -and [int]$state.json.state.memberCount -ge $minMembers
	})
}

function Initialize-OpenGroupJoin($name, $seedText) {
	$group = (Api $script:FedA POST '/groups/' @{ name = $name; description = 'L4 fed probe' }).json
	$groupId = $group.groupId; $channelId = $group.defaultChannelId
	Api $script:FedA PUT "/groups/$groupId/settings" @{ joinPolicy = 'open' } | Out-Null
	$invite = (Api $script:FedA POST "/groups/$groupId/invite-ticket" @{ ttlMs = 3600000 }).json
	$seedEventId = $null
	if ($seedText) {
		$seedEventId = (Api $script:FedA POST "/groups/$groupId/channels/$channelId/messages" @{ content = @{ type = 'text'; content = $seedText } }).json.event.id
	}
	$join = Api $script:FedB POST "/groups/$groupId/join" @{
		mqttRoomSecret = $invite.mqttRoomSecret
		mqttAppId = $invite.mqttAppId
		introducerPubKeyHash = $invite.introducerPubKeyHash
	}
	if ($join.status -ne 200) { throw "B join failed: $($join.status) $($join.raw)" }
	$ok = Wait-FedMembers $script:FedB $groupId
	if (-not $ok) {
		$ok = [bool](PollUntil 60 4 {
			Api $script:FedA POST "/groups/$groupId/federation/catchup" @{ waitMs = 6000 } | Out-Null
			Api $script:FedA POST "/groups/$groupId/dag/merge-tips" @{} | Out-Null
			Api $script:FedB POST "/groups/$groupId/federation/catchup" @{ waitMs = 6000 } | Out-Null
			Api $script:FedB POST "/groups/$groupId/dag/merge-tips" @{} | Out-Null
			$state = Api $script:FedB GET "/groups/$groupId/state"
			$state.status -eq 200 -and [int]$state.json.state.memberCount -ge 2
		})
	}
	if (-not $ok) {
		$inviteRetry = (Api $script:FedA POST "/groups/$groupId/invite-ticket" @{ ttlMs = 3600000 }).json
		Api $script:FedB POST "/groups/$groupId/join" @{
			mqttRoomSecret = $inviteRetry.mqttRoomSecret
			mqttAppId = $inviteRetry.mqttAppId
			introducerPubKeyHash = $inviteRetry.introducerPubKeyHash
		} | Out-Null
		$ok = Wait-FedMembers $script:FedB $groupId 2 120
	}
	if (-not $ok) { throw 'federation health gate: B never reached members>=2' }
	[pscustomobject]@{ groupId = $groupId; channelId = $channelId; seedEventId = $seedEventId; invite = $invite }
}

function Test-FedTestGroup($row) {
	if ($null -eq $row) { return $false }
	$name = [string]$row.name
	$description = [string]$row.description
	if ($name -like 'Fed*') { return $true }
	if ($name -like 'DM ·*') { return $true }
	if ($description -like '*L4 fed probe*') { return $true }
	if ($description -like '*federation test*') { return $true }
	$false
}

function Get-FedTestGroupIds($node) {
	$list = Api $node GET '/groups/'
	if ($list.status -ne 200) { return @() }
	@($list.json | Where-Object { Test-FedTestGroup $_ } | ForEach-Object { [string]$_.groupId } | Where-Object { $_ })
}

function Invoke-GroupLeaveBestEffort($node, $groupIds) {
	$ids = @($groupIds | Where-Object { $_ } | Sort-Object -Unique)
	if (-not $ids.Count) { return }
	try {
		$leave = Api $node POST '/groups/leave' @{ groupIds = $ids }
		if ($leave.status -eq 200) {
			Write-Host "  leave[$($node.name)] count=$($ids.Count)" -ForegroundColor DarkGray
			return
		}
	}
	catch { }
	foreach ($id in $ids) {
		try { Api $node DELETE "/groups/$id" | Out-Null } catch { }
	}
}

function Write-FedSummary($tag, $groupId) {
	Write-Host "`n========================================" -ForegroundColor Cyan
	Write-Host "$tag  PASS=$script:pass  FAIL=$script:fail  SKIP=$script:skip" -ForegroundColor Cyan
	if ($script:failures.Count) {
		Write-Host "FAILURES:" -ForegroundColor Red
		$script:failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
	}
	if ($groupId) { Write-Host "groupId=$groupId" -ForegroundColor DarkGray }
	Write-Host "========================================" -ForegroundColor Cyan
}

function Complete-LiveScript {
	if ($script:fail -gt 0) { exit 1 }
}

function Clear-FedTestGroups() {
	Write-Host "`n=== Cleanup all test groups ===" -ForegroundColor Cyan
	foreach ($node in @($script:FedA, $script:FedB)) {
		try {
			$ids = Get-FedTestGroupIds $node
			if ($ids.Count) { Invoke-GroupLeaveBestEffort $node $ids }
			else { Write-Host "  leave[$($node.name)] none" -ForegroundColor DarkGray }
		}
		catch {
			Write-Host "  cleanup WARN [$($node.name)] $($_.Exception.Message)" -ForegroundColor Yellow
		}
	}
}

function Clear-FedGroup($groupId) {
	if (-not $groupId) { return }
	Write-Host "`n=== Cleanup ===" -ForegroundColor Cyan
	foreach ($node in @($script:FedB, $script:FedA)) {
		try {
			Invoke-GroupLeaveBestEffort $node @($groupId)
			Write-Host "  cleanup[$($node.name)] done for $groupId" -ForegroundColor DarkGray
		}
		catch {
			Write-Host "  cleanup WARN [$($node.name)] $groupId $($_.Exception.Message)" -ForegroundColor Yellow
		}
	}
	Clear-FedTestGroups
}

$script:FedPngBytes = [Convert]::FromBase64String(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
)
