$ErrorActionPreference = 'Stop'

$A = @{ base = 'http://localhost:8931'; key = $env:FOUNT_API_KEY; name = 'NodeA' }
$B = @{ base = 'http://localhost:8932'; key = 'nodeb-fed-test-key-20260614'; name = 'NodeB' }

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

function Api($node, $method, $path, $body, $quiet) {
	$uri = "$($node.base)/api/parts/shells:chat$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$($node.key)" } else { $uri += "?fount-apikey=$($node.key)" }
	$params = @{ Method = $method; Uri = $uri; UseBasicParsing = $true; TimeoutSec = 180; SkipHttpErrorCheck = $true }
	if ($null -ne $body) {
		$params.ContentType = 'application/json'
		$params.Body = ($body | ConvertTo-Json -Depth 12 -Compress)
	}
	$resp = Invoke-WebRequest @params
	$status = [int]$resp.StatusCode
	$json = $null
	if ($resp.Content) {
		try { $json = $resp.Content | ConvertFrom-Json } catch { $json = $null }
	}
	if (-not $quiet) {
		if ($status -ge 200 -and $status -lt 300) {
			Write-Host "[$($node.name) $method $path] -> $status" -ForegroundColor Green
		}
		else {
			Write-Host "[$($node.name) $method $path] -> ERROR $status" -ForegroundColor Red
			if ($resp.Content) { Write-Host $resp.Content -ForegroundColor Yellow }
		}
	}
	[pscustomobject]@{ status = $status; json = $json; raw = $resp.Content }
}

function Is-FedTestGroup($row) {
	if ($null -eq $row) { return $false }
	$name = [string]$row.name
	$desc = [string]$row.description
	if ($name -like 'Fed*') { return $true }
	if ($name -like 'DM ·*') { return $true }
	if ($desc -like '*federation test*') { return $true }
	if ($desc -like '*L4 fed probe*') { return $true }
	$false
}

function Cleanup-FedTestGroups($nodes, $extraGroupId = $null) {
	$allIds = New-Object System.Collections.Generic.HashSet[string]
	if ($extraGroupId) { [void]$allIds.Add([string]$extraGroupId) }
	foreach ($node in $nodes) {
		try {
			$list = Api $node GET '/groups/' $null $true
			if ($list.status -ne 200) { continue }
			foreach ($row in @($list.json)) {
				if (Is-FedTestGroup $row) { [void]$allIds.Add([string]$row.groupId) }
			}
		}
		catch { }
	}
	$ids = @($allIds)
	if (-not $ids.Count) { return }
	foreach ($node in $nodes) {
		try {
			Api $node POST '/groups/leave' @{ groupIds = $ids } $true | Out-Null
		}
		catch { }
		foreach ($id in $ids) {
			try { Api $node DELETE "/groups/$id" $null $true | Out-Null } catch { }
		}
	}
}

Cleanup-FedTestGroups @($A, $B)

Write-Host "=== 1. NodeA: create group ===" -ForegroundColor Cyan
$g = Api $A POST '/groups/' @{ name = 'FedTest'; description = 'two-node federation test' }
if ($g.status -ne 201) { throw "create group failed: $($g.status)" }
$groupId = $g.json.groupId
$channelId = $g.json.defaultChannelId
Write-Host "groupId=$groupId  channelId=$channelId" -ForegroundColor Cyan

Write-Host "`n=== 2. NodeA: set joinPolicy=open ===" -ForegroundColor Cyan
Api $A PUT "/groups/$groupId/settings" @{ joinPolicy = 'open' } | Out-Null

Write-Host "`n=== 3. NodeA: create invite-ticket (get mqtt creds) ===" -ForegroundColor Cyan
$inv = Api $A POST "/groups/$groupId/invite-ticket" @{ ttlMs = 3600000 }
if ($inv.status -ne 200 -and $inv.status -ne 201) { throw "invite-ticket failed: $($inv.status)" }
$mqttAppId = $inv.json.mqttAppId
$mqttRoomSecret = $inv.json.mqttRoomSecret
$introducer = $inv.json.introducerPubKeyHash
Write-Host "mqttAppId=$mqttAppId" -ForegroundColor Cyan
Write-Host "mqttRoomSecret=$($mqttRoomSecret.Substring(0,[Math]::Min(16,$mqttRoomSecret.Length)))..." -ForegroundColor Cyan
Write-Host "introducer=$introducer" -ForegroundColor Cyan

Write-Host "`n=== 4. NodeA: send message #A1 ===" -ForegroundColor Cyan
Api $A POST "/groups/$groupId/channels/$channelId/messages" @{ content = @{ type = 'text'; content = 'A1: hello from NodeA' } } | Out-Null

Write-Host "`n=== 5. NodeB: join group (no inviteCode, with mqtt creds) ===" -ForegroundColor Cyan
$joinBody = @{ mqttRoomSecret = $mqttRoomSecret; mqttAppId = $mqttAppId; introducerPubKeyHash = $introducer }
$jr = Api $B POST "/groups/$groupId/join" $joinBody
if ($jr.status -ne 200) { throw "join failed: $($jr.status) $($jr.raw)" }
Write-Host "join result: $($jr.json | ConvertTo-Json -Compress)" -ForegroundColor Cyan

Write-Host "`n=== 6. NodeB: poll group state for catchup (<=90s) ===" -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
	Start-Sleep 3
	try {
		$st = Api $B GET "/groups/$groupId/state" $null $true
		if ($st.status -ne 200) { return $false }
		$memberCount = $st.json.state.memberCount
		$chans = ($st.json.state.channels.PSObject.Properties | Measure-Object).Count
		$nm = $st.json.state.groupMeta.name
		Write-Host "  [t=$($i*3)s] members=$memberCount channels=$chans name='$nm'" -ForegroundColor DarkGray
		if (-not $channelId -and $st.json.state.groupSettings.defaultChannelId) {
			$channelId = $st.json.state.groupSettings.defaultChannelId
		}
		if ($nm -and $chans -ge 1) { $ok = $true; break }
	} catch {
		Write-Host "  [t=$($i*3)s] state not ready: $($_.Exception.Message)" -ForegroundColor DarkGray
	}
}
if (-not $ok) { Write-Host "!! NodeB never materialized group state" -ForegroundColor Red }

Write-Host "`n=== 7. NodeB: read messages (expect A1 via catchup) ===" -ForegroundColor Cyan
$gotA1 = [bool](PollUntil 60 3 {
	try {
		$msgs = Api $B GET "/groups/$groupId/channels/$channelId/messages?limit=50" $null $true
		if ($msgs.status -ne 200) { return $false }
		$texts = @($msgs.json.messages | ForEach-Object { $_.content.content })
		Write-Host "  NodeB sees $($texts.Count) msgs: $($texts -join ' | ')" -ForegroundColor DarkGray
		$texts -match 'A1:'
	}
	catch { $false }
})
Write-Host ("NodeB received A1: " + $(if ($gotA1) { 'YES' } else { 'NO' })) -ForegroundColor $(if ($gotA1) { 'Green' } else { 'Red' })

Write-Host "`n=== 8. NodeB: send message #B1 ===" -ForegroundColor Cyan
try { Api $B POST "/groups/$groupId/channels/$channelId/messages" @{ content = @{ type = 'text'; content = 'B1: reply from NodeB' } } | Out-Null } catch {}

Write-Host "`n=== 9. NodeA: read messages (expect B1 via live federation) ===" -ForegroundColor Cyan
$gotB1 = [bool](PollUntil 180 3 {
	try {
		Api $B POST "/groups/$groupId/federation/catchup" @{ waitMs = 6000 } $true | Out-Null
		Api $A POST "/groups/$groupId/federation/catchup" @{ waitMs = 6000 } $true | Out-Null
		Api $A POST "/groups/$groupId/dag/merge-tips" @{} $true | Out-Null
	}
	catch { }
	try {
		$msgs = Api $A GET "/groups/$groupId/channels/$channelId/messages?limit=50" $null $true
		if ($msgs.status -ne 200) { return $false }
		$texts = @($msgs.json.messages | ForEach-Object { $_.content.content })
		Write-Host "  NodeA sees $($texts.Count) msgs: $($texts -join ' | ')" -ForegroundColor DarkGray
		$texts -match 'B1:'
	}
	catch { $false }
})
if (-not $gotB1) {
	Write-Host "  retry: explicit catchup on A then re-poll..." -ForegroundColor DarkGray
	$gotB1 = [bool](PollUntil 90 3 {
		try {
			Api $A POST "/groups/$groupId/federation/catchup" @{ waitMs = 12000 } $true | Out-Null
			Api $A POST "/groups/$groupId/dag/merge-tips" @{} $true | Out-Null
			$msgs = Api $A GET "/groups/$groupId/channels/$channelId/messages?limit=50" $null $true
			if ($msgs.status -ne 200) { return $false }
			@($msgs.json.messages | ForEach-Object { $_.content.content }) -match 'B1:'
		}
		catch { $false }
	})
}
Write-Host ("NodeA received B1: " + $(if ($gotB1) { 'YES' } else { 'NO' })) -ForegroundColor $(if ($gotB1) { 'Green' } else { 'Red' })

Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
Write-Host "groupId=$groupId" -ForegroundColor Cyan
Write-Host ("catchup(A1->B): " + $(if ($gotA1) { 'PASS' } else { 'FAIL' }))
Write-Host ("live(B1->A):    " + $(if ($gotB1) { 'PASS' } else { 'FAIL' }))

Cleanup-FedTestGroups @($A, $B) $groupId
