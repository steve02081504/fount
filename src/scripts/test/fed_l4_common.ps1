# Shared helpers for L4 dual-node federation PowerShell probes.
# Dot-source from fed_dm.ps1, fed_archive_month.ps1, etc.

$script:FedA = @{
	base = $(if ($env:FOUNT_TEST_BASE_URL) { $env:FOUNT_TEST_BASE_URL } else { 'http://localhost:8931' })
	key = $env:FOUNT_API_KEY
	name = 'A'
	dataPath = $(if ($env:FOUNT_NODE_A_DATA) { $env:FOUNT_NODE_A_DATA } else { Join-Path $PSScriptRoot '../data' })
}
$nodeBPort = $(if ($env:FOUNT_TEST_NODE_B_PORT) { $env:FOUNT_TEST_NODE_B_PORT } else { '8932' })
$script:FedB = @{
	base = "http://localhost:$nodeBPort"
	key = $(if ($env:FOUNT_TEST_NODE_B_KEY) { $env:FOUNT_TEST_NODE_B_KEY } else { "nodeb-fed-test-key-$nodeBPort" })
	name = 'B'
	dataPath = $(if ($env:FOUNT_NODE_B_DATA) { $env:FOUNT_NODE_B_DATA } else { Join-Path $PSScriptRoot 'node_b_data' })
}

if (-not $script:FedA.key) { throw 'FOUNT_API_KEY is required for NodeA; run via test/live/run.mjs.' }

$script:pass = 0; $script:fail = 0; $script:skip = 0
$script:failures = @()

function ShellApi($node, $shell, $method, $path, $body) {
	$uri = "$($node.base)/api/parts/shells:$shell$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$($node.key)" } else { $uri += "?fount-apikey=$($node.key)" }
	$p = @{ Method = $method; Uri = $uri; UseBasicParsing = $true; TimeoutSec = 180; SkipHttpErrorCheck = $true }
	if ($null -ne $body) { $p.ContentType = 'application/json'; $p.Body = ($body | ConvertTo-Json -Depth 16 -Compress) }
	$r = Invoke-WebRequest @p
	$json = $null
	if ($r.Content) { try { $json = $r.Content | ConvertFrom-Json } catch { $json = $r.Content } }
	[pscustomobject]@{ status = [int]$r.StatusCode; json = $json; raw = $r.Content }
}

function Api($node, $method, $path, $body) {
	ShellApi $node 'chat' $method $path $body
}

function P2pApi($node, $method, $path, $body) {
	$uri = "$($node.base)/api/p2p$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$($node.key)" } else { $uri += "?fount-apikey=$($node.key)" }
	$p = @{ Method = $method; Uri = $uri; UseBasicParsing = $true; TimeoutSec = 180; SkipHttpErrorCheck = $true }
	if ($null -ne $body) { $p.ContentType = 'application/json'; $p.Body = ($body | ConvertTo-Json -Depth 16 -Compress) }
	$r = Invoke-WebRequest @p
	$json = $null
	if ($r.Content) { try { $json = $r.Content | ConvertFrom-Json } catch { $json = $r.Content } }
	[pscustomobject]@{ status = [int]$r.StatusCode; json = $json; raw = $r.Content }
}

function RootApi($node, $method, $path, $body) {
	$uri = "$($node.base)$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$($node.key)" } else { $uri += "?fount-apikey=$($node.key)" }
	$p = @{ Method = $method; Uri = $uri; UseBasicParsing = $true; TimeoutSec = 60; SkipHttpErrorCheck = $true }
	if ($null -ne $body) { $p.ContentType = 'application/json'; $p.Body = ($body | ConvertTo-Json -Depth 16 -Compress) }
	$r = Invoke-WebRequest @p
	$json = $null
	if ($r.Content) { try { $json = $r.Content | ConvertFrom-Json } catch { $json = $r.Content } }
	[pscustomobject]@{ status = [int]$r.StatusCode; json = $json; raw = $r.Content }
}

function ApiMultipart($node, $method, $path, $fields, $fileField, $fileName, $fileBytes, $contentType = 'image/png') {
	ShellApiMultipart $node 'chat' $method $path $fields $fileField $fileName $fileBytes $contentType
}

function ShellApiMultipart($node, $shell, $method, $path, $fields, $fileField, $fileName, $fileBytes, $contentType = 'image/png') {
	$uri = "$($node.base)/api/parts/shells:$shell$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$($node.key)" } else { $uri += "?fount-apikey=$($node.key)" }
	$handler = [System.Net.Http.HttpClientHandler]::new()
	$client = [System.Net.Http.HttpClient]::new($handler)
	$client.Timeout = [TimeSpan]::FromSeconds(120)
	try {
		$form = [System.Net.Http.MultipartFormDataContent]::new()
		foreach ($kv in $fields.GetEnumerator()) {
			$sc = [System.Net.Http.StringContent]::new([string]$kv.Value)
			$form.Add($sc, $kv.Key)
		}
		$bc = [System.Net.Http.ByteArrayContent]::new($fileBytes)
		$bc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($contentType)
		$form.Add($bc, $fileField, $fileName)
		$req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($method), $uri)
		$req.Content = $form
		$resp = $client.SendAsync($req).GetAwaiter().GetResult()
		$raw = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
		$json = $null
		if ($raw) { try { $json = $raw | ConvertFrom-Json } catch { $json = $raw } }
		return [pscustomobject]@{ status = [int]$resp.StatusCode; json = $json; raw = $raw }
	}
	finally {
		$client.Dispose()
		$handler.Dispose()
	}
}

function T($name, $block) {
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

function S($name, $why) { $script:skip++; Write-Host "  skip  $name ($why)" -ForegroundColor DarkGray }

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
		$s = Api $node GET "/groups/$groupId/state"
		$s.status -eq 200 -and $s.json.state.isMember -eq $true -and [int]$s.json.state.memberCount -ge $minMembers
	})
}

function Setup-OpenGroupJoin($name, $seedText) {
	$g = (Api $script:FedA POST '/groups/' @{ name = $name; description = 'L4 fed probe' }).json
	$gid = $g.groupId; $cid = $g.defaultChannelId
	Api $script:FedA PUT "/groups/$gid/settings" @{ joinPolicy = 'open' } | Out-Null
	$inv = (Api $script:FedA POST "/groups/$gid/invite-ticket" @{ ttlMs = 3600000 }).json
	$seedId = $null
	if ($seedText) {
		$seedId = (Api $script:FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = $seedText } }).json.event.id
	}
	$jr = Api $script:FedB POST "/groups/$gid/join" @{
		mqttRoomSecret = $inv.mqttRoomSecret
		mqttAppId = $inv.mqttAppId
		introducerPubKeyHash = $inv.introducerPubKeyHash
	}
	if ($jr.status -ne 200) { throw "B join failed: $($jr.status) $($jr.raw)" }
	$ok = Wait-FedMembers $script:FedB $gid
	if (-not $ok) {
		# 联邦偶发抖动时先做一次双端 catchup/merge 自愈，再判断是否需要重发 join。
		$ok = [bool](PollUntil 60 4 {
			Api $script:FedA POST "/groups/$gid/federation/catchup" @{ waitMs = 6000 } | Out-Null
			Api $script:FedA POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
			Api $script:FedB POST "/groups/$gid/federation/catchup" @{ waitMs = 6000 } | Out-Null
			Api $script:FedB POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
			$s = Api $script:FedB GET "/groups/$gid/state"
			$s.status -eq 200 -and [int]$s.json.state.memberCount -ge 2
		})
	}
	if (-not $ok) {
		$invRetry = (Api $script:FedA POST "/groups/$gid/invite-ticket" @{ ttlMs = 3600000 }).json
		Api $script:FedB POST "/groups/$gid/join" @{
			mqttRoomSecret = $invRetry.mqttRoomSecret
			mqttAppId = $invRetry.mqttAppId
			introducerPubKeyHash = $invRetry.introducerPubKeyHash
		} | Out-Null
		$ok = Wait-FedMembers $script:FedB $gid 2 120
	}
	if (-not $ok) { throw 'federation health gate: B never reached members>=2' }
	[pscustomobject]@{ groupId = $gid; channelId = $cid; seedEventId = $seedId; invite = $inv }
}

function Is-FedTestGroup($row) {
	if ($null -eq $row) { return $false }
	$name = [string]$row.name
	$desc = [string]$row.description
	if ($name -like 'Fed*') { return $true }
	if ($name -like 'DM ·*') { return $true }
	if ($desc -like '*L4 fed probe*') { return $true }
	if ($desc -like '*federation test*') { return $true }
	$false
}

function Get-FedTestGroupIds($node) {
	$list = Api $node GET '/groups/'
	if ($list.status -ne 200) { return @() }
	@($list.json | Where-Object { Is-FedTestGroup $_ } | ForEach-Object { [string]$_.groupId } | Where-Object { $_ })
}

function Leave-GroupsBestEffort($node, $groupIds) {
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

function Cleanup-AllFedTestGroups() {
	Write-Host "`n=== Cleanup all test groups ===" -ForegroundColor Cyan
	foreach ($node in @($script:FedA, $script:FedB)) {
		try {
			$ids = Get-FedTestGroupIds $node
			if ($ids.Count) { Leave-GroupsBestEffort $node $ids }
			else { Write-Host "  leave[$($node.name)] none" -ForegroundColor DarkGray }
		}
		catch {
			Write-Host "  cleanup WARN [$($node.name)] $($_.Exception.Message)" -ForegroundColor Yellow
		}
	}
}

function Cleanup-Group($groupId) {
	if (-not $groupId) { return }
	Write-Host "`n=== Cleanup ===" -ForegroundColor Cyan
	foreach ($node in @($script:FedB, $script:FedA)) {
		try {
			Leave-GroupsBestEffort $node @($groupId)
			Write-Host "  cleanup[$($node.name)] done for $groupId" -ForegroundColor DarkGray
		}
		catch {
			Write-Host "  cleanup WARN [$($node.name)] $groupId $($_.Exception.Message)" -ForegroundColor Yellow
		}
	}
	Cleanup-AllFedTestGroups
}

# 1x1 PNG
$script:FedPngBytes = [Convert]::FromBase64String(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
)
