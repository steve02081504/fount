# Extended 2-node federation E2E: event propagation, file transfer, kick.
# Requires NodeA + NodeB both up (started by test/live/run.mjs).
$ErrorActionPreference = 'Stop'
$nodeBPort = $(if ($env:FOUNT_TEST_NODE_B_PORT) { $env:FOUNT_TEST_NODE_B_PORT } else { '8932' })
$nodeBKey = $(if ($env:FOUNT_TEST_NODE_B_KEY) { $env:FOUNT_TEST_NODE_B_KEY } else { "nodeb-fed-test-key-$nodeBPort" })
$A = @{
	base = $(if ($env:FOUNT_TEST_BASE_URL) { $env:FOUNT_TEST_BASE_URL } else { throw 'FOUNT_TEST_BASE_URL required' })
	key = $env:FOUNT_API_KEY
	name = 'A'
}
$B = @{ base = "http://localhost:$nodeBPort"; key = $nodeBKey; name = 'B' }
if (-not $A.key) { throw 'FOUNT_API_KEY required' }
$script:pass = 0; $script:fail = 0; $script:failures = @()

function Api($node, $method, $path, $body) {
	$uri = "$($node.base)/api/parts/shells:chat$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$($node.key)" } else { $uri += "?fount-apikey=$($node.key)" }
	$p = @{ Method = $method; Uri = $uri; UseBasicParsing = $true; TimeoutSec = 60; SkipHttpErrorCheck = $true }
	if ($null -ne $body) { $p.ContentType = 'application/json'; $p.Body = ($body | ConvertTo-Json -Depth 16 -Compress) }
	$r = Invoke-WebRequest @p
	$json = $null; if ($r.Content) { try { $json = $r.Content | ConvertFrom-Json } catch { $json = $r.Content } }
	[pscustomobject]@{ status = [int]$r.StatusCode; json = $json; raw = $r.Content }
}
function T($name, $block) {
	try { if ((& $block) -eq $false) { $script:fail++; $script:failures += $name; Write-Host "  FAIL  $name" -ForegroundColor Red } else { $script:pass++; Write-Host "  ok    $name" -ForegroundColor Green } }
	catch { $script:fail++; $script:failures += "$name :: $($_.Exception.Message)"; Write-Host "  FAIL  $name :: $($_.Exception.Message)" -ForegroundColor Red }
}
# Poll helper: run $probe until it returns truthy or timeout (sec). Returns last value.
function PollUntil($timeoutSec, $intervalSec, $probe) {
	$deadline = (Get-Date).AddSeconds($timeoutSec)
	do { $v = & $probe; if ($v) { return $v }; Start-Sleep $intervalSec } while ((Get-Date) -lt $deadline)
	return $v
}

Write-Host "=== Setup: A creates group, B joins ===" -ForegroundColor Cyan
$g = (Api $A POST '/groups/' @{ name = 'FedExt'; description = 'ext' }).json
$gid = $g.groupId; $cid = $g.defaultChannelId
Api $A PUT "/groups/$gid/settings" @{ joinPolicy = 'open' } | Out-Null
$inv = (Api $A POST "/groups/$gid/invite-ticket" @{ ttlMs = 3600000 }).json
# Seed message before join so catchup has content
$seedMsg = (Api $A POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'seed-A' } }).json.event.id
$jr = Api $B POST "/groups/$gid/join" @{ mqttRoomSecret = $inv.mqttRoomSecret; mqttAppId = $inv.mqttAppId; introducerPubKeyHash = $inv.introducerPubKeyHash }
Write-Host "join -> $($jr.status)"
# Wait for B to catch up membership + seed message
$caught = PollUntil 90 3 {
	$s = Api $B GET "/groups/$gid/state"
	if ($s.status -ne 200) { return $false }
	($s.json.state.memberCount -ge 2) -and ($s.json.state.isMember -eq $true)
}
Write-Host "B caught up membership: $caught"

Write-Host "`n=== 1. Catchup of seed message A->B ===" -ForegroundColor Cyan
T 'B sees seed message' {
	$m = PollUntil 60 3 {
		$r = Api $B GET "/groups/$gid/channels/$cid/messages"
		if ($r.status -ne 200) { return $false }
		@($r.json.messages | Where-Object { $_.eventId -eq $seedMsg }).Count -ge 1
	}
	[bool]$m
}

Write-Host "`n=== 2. New channel propagation A->B ===" -ForegroundColor Cyan
$newChan = (Api $A POST "/groups/$gid/channels" @{ name = 'fed-chan'; type = 'text' }).json.channelId
T 'B sees new channel' {
	$m = PollUntil 60 3 {
		$s = Api $B GET "/groups/$gid/state"
		$s.status -eq 200 -and $null -ne $s.json.state.channels.$newChan
	}
	[bool]$m
}

Write-Host "`n=== 3. Live message B->A and A->B both directions ===" -ForegroundColor Cyan
$bMsg = (Api $B POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'from-B' } }).json.event.id
T 'A sees B message (live)' {
	[bool](PollUntil 60 3 { @((Api $A GET "/groups/$gid/channels/$cid/messages").json.messages | Where-Object { $_.eventId -eq $bMsg }).Count -ge 1 })
}

Write-Host "`n=== 4. Reaction propagation A->B ===" -ForegroundColor Cyan
$emoji = "$([char]0xD83D)$([char]0xDC4D)"
Api $A POST "/groups/$gid/channels/$cid/reactions" @{ targetEventId = $bMsg; emoji = $emoji } | Out-Null
T 'B sees reaction on B-msg' {
	[bool](PollUntil 60 3 {
		$r = Api $B GET "/groups/$gid/channels/$cid/messages"
		@($r.json.reactionEvents | Where-Object { $_.content.targetId -eq $bMsg }).Count -ge 1
	})
}

Write-Host "`n=== 5. Edit propagation A->B ===" -ForegroundColor Cyan
$aMsg = (Api $A POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'orig-A' } }).json.event.id
Start-Sleep 2
Api $A PUT "/groups/$gid/channels/$cid/messages/$aMsg" @{ content = @{ type = 'text'; content = 'edited-A' } } | Out-Null
T 'B sees edited content' {
	[bool](PollUntil 60 3 {
		$r = Api $B GET "/groups/$gid/channels/$cid/messages"
		$row = $r.json.messages | Where-Object { $_.eventId -eq $aMsg }
		$txt = $row.content.content_for_show; if (-not $txt) { $txt = $row.content.content }
		$txt -match 'edited-A'
	})
}

Write-Host "`n=== 6. Delete propagation A->B ===" -ForegroundColor Cyan
Api $A DELETE "/groups/$gid/channels/$cid/messages/$aMsg" | Out-Null
T 'B sees message deleted/redacted' {
	[bool](PollUntil 60 3 {
		$r = Api $B GET "/groups/$gid/channels/$cid/messages"
		$row = $r.json.messages | Where-Object { $_.eventId -eq $aMsg }
		# deleted: either gone, or marked deleted
		(-not $row) -or ($row.content.deleted -eq $true) -or ($row.deleted -eq $true)
	})
}

Write-Host "`n=== 7. Cross-node file transfer A->B ===" -ForegroundColor Cyan
$fileId = [guid]::NewGuid().ToString()
$ci = $null
T 'A uploads + registers file' {
	$data = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('fed-file-payload-1234567890'))
	$up = Api $A POST "/groups/$gid/chunks" @{ fileId = $fileId; data = $data; channelId = $cid; ceMode = 'convergent' }
	if ($up.status -ne 200 -and $up.status -ne 201) { throw "chunk $($up.status): $($up.raw)" }
	$script:ci = $up.json
	$body = @{ fileId = $fileId; name = 'fed.txt'; size = 27; mimeType = 'text/plain'; folderId = $null
		ceMode = $ci.ceMode; contentHash = $ci.contentHash; ciphertextHash = $ci.ciphertextHash
		wrappedKey = $ci.wrappedKey; storageLocator = $ci.storageLocator; key_generation = $ci.key_generation; channelId = $cid }
	$reg = Api $A POST "/groups/$gid/files" $body
	$reg.status -eq 201
}
T 'B sees file meta (DAG sync)' {
	[bool](PollUntil 60 3 {
		$m = Api $B GET "/groups/$gid/files/$fileId/meta"
		$m.status -eq 200 -and $m.json.fileId -eq $fileId
	})
}
T 'B downloads file content via federation' {
	$rs = Api $B POST "/groups/$gid/files/$fileId/download-resume" @{}
	if ($rs.status -ne 200) { throw "resume $($rs.status): $($rs.raw)" }
	# poll status to done
	$done = PollUntil 150 4 {
		$st = Api $B GET "/groups/$gid/files/$fileId/download-status"
		if ($st.status -ne 200) { return $false }
		$s = $st.json.status
		if ($s.status -eq 'failed' -or $s.error) { throw "download failed: $($st.raw)" }
		($s.status -eq 'done') -or ($s.percent -eq 100) -or ($s.done -ge $s.total -and $s.total -gt 0)
	}
	[bool]$done
}

# 第 8 段 kick/治理传播由 fed_ban.ps1 专门覆盖；本套件聚焦事件传播与文件同步路径，不重复。

Write-Host "`n=== Cleanup ===" -ForegroundColor Cyan
Api $A DELETE "/groups/$gid" | Out-Null
Write-Host "deleted group on A"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "FED-EXT  PASS=$script:pass  FAIL=$script:fail" -ForegroundColor Cyan
if ($script:failures.Count) { Write-Host "FAILURES:" -ForegroundColor Red; $script:failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red } }
Write-Host "groupId=$gid" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan
