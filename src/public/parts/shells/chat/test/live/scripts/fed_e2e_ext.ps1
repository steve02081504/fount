# Extended 2-node federation E2E: event propagation, file transfer, kick.
# Requires NodeA + NodeB both up (started by test/live/run.mjs).
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

Write-Host "=== Setup: A creates group, B joins ===" -ForegroundColor Cyan
$g = (Api $FedA POST '/groups/' @{ name = 'FedExt'; description = 'ext' }).json
$gid = $g.groupId; $cid = $g.defaultChannelId
Api $FedA PUT "/groups/$gid/settings" @{ joinPolicy = 'open' } | Out-Null
$inv = (Api $FedA POST "/groups/$gid/invite-ticket" @{ ttlMs = 3600000 }).json
# Seed message before join so catchup has content
$seedMsg = (Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'seed-A' } }).json.event.id
$jr = Api $FedB POST "/groups/$gid/join" @{ mqttRoomSecret = $inv.mqttRoomSecret; mqttAppId = $inv.mqttAppId; introducerPubKeyHash = $inv.introducerPubKeyHash }
Write-Host "join -> $($jr.status)"
# Wait for B to catch up membership + seed message
$caught = PollUntil 90 3 {
	$s = Api $FedB GET "/groups/$gid/state"
	if ($s.status -ne 200) { return $false }
	($s.json.state.memberCount -ge 2) -and ($s.json.state.isMember -eq $true)
}
Write-Host "B caught up membership: $caught"

Write-Host "`n=== 1. Catchup of seed message A->B ===" -ForegroundColor Cyan
Test-Case 'B sees seed message' {
	$m = PollUntil 60 3 {
		$r = Api $FedB GET "/groups/$gid/channels/$cid/messages"
		if ($r.status -ne 200) { return $false }
		@($r.json.messages | Where-Object { $_.eventId -eq $seedMsg }).Count -ge 1
	}
	[bool]$m
}

Write-Host "`n=== 2. New channel propagation A->B ===" -ForegroundColor Cyan
$newChan = (Api $FedA POST "/groups/$gid/channels" @{ name = 'fed-chan'; type = 'text' }).json.channelId
Test-Case 'B sees new channel' {
	$m = PollUntil 60 3 {
		$s = Api $FedB GET "/groups/$gid/state"
		$s.status -eq 200 -and $null -ne $s.json.state.channels.$newChan
	}
	[bool]$m
}

Write-Host "`n=== 3. Live message B->A and A->B both directions ===" -ForegroundColor Cyan
$bMsg = (Api $FedB POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'from-B' } }).json.event.id
Test-Case 'A sees B message (live)' {
	[bool](PollUntil 60 3 { @((Api $FedA GET "/groups/$gid/channels/$cid/messages").json.messages | Where-Object { $_.eventId -eq $bMsg }).Count -ge 1 })
}

Write-Host "`n=== 4. Reaction propagation A->B ===" -ForegroundColor Cyan
$emoji = "$([char]0xD83D)$([char]0xDC4D)"
Api $FedA POST "/groups/$gid/channels/$cid/reactions" @{ targetEventId = $bMsg; emoji = $emoji } | Out-Null
Test-Case 'B sees reaction on B-msg' {
	[bool](PollUntil 60 3 {
		$r = Api $FedB GET "/groups/$gid/channels/$cid/messages"
		@($r.json.reactionEvents | Where-Object { $_.content.targetId -eq $bMsg }).Count -ge 1
	})
}

Write-Host "`n=== 5. Edit propagation A->B ===" -ForegroundColor Cyan
$aMsg = (Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'orig-A' } }).json.event.id
Start-Sleep 2
Api $FedA PUT "/groups/$gid/channels/$cid/messages/$aMsg" @{ content = @{ type = 'text'; content = 'edited-A' } } | Out-Null
Test-Case 'B sees edited content' {
	[bool](PollUntil 60 3 {
		$r = Api $FedB GET "/groups/$gid/channels/$cid/messages"
		$row = $r.json.messages | Where-Object { $_.eventId -eq $aMsg }
		$txt = $row.content.content_for_show; if (-not $txt) { $txt = $row.content.content }
		$txt -match 'edited-A'
	})
}

Write-Host "`n=== 6. Delete propagation A->B ===" -ForegroundColor Cyan
Api $FedA DELETE "/groups/$gid/channels/$cid/messages/$aMsg" | Out-Null
Test-Case 'B sees message deleted/redacted' {
	[bool](PollUntil 60 3 {
		$r = Api $FedB GET "/groups/$gid/channels/$cid/messages"
		$row = $r.json.messages | Where-Object { $_.eventId -eq $aMsg }
		# deleted: either gone, or marked deleted
		(-not $row) -or ($row.content.deleted -eq $true) -or ($row.deleted -eq $true)
	})
}

Write-Host "`n=== 7. Cross-node file transfer A->B ===" -ForegroundColor Cyan
$fileId = [guid]::NewGuid().ToString()
$ci = $null
Test-Case 'A uploads + registers file' {
	$data = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('fed-file-payload-1234567890'))
	$up = Api $FedA POST "/groups/$gid/chunks" @{ fileId = $fileId; data = $data; channelId = $cid; ceMode = 'convergent' }
	if ($up.status -ne 200 -and $up.status -ne 201) { throw "chunk $($up.status): $($up.raw)" }
	$script:ci = $up.json
	$body = @{ fileId = $fileId; name = 'fed.txt'; size = 27; mimeType = 'text/plain'; folderId = $null
		ceMode = $ci.ceMode; contentHash = $ci.contentHash; ciphertextHash = $ci.ciphertextHash
		wrappedKey = $ci.wrappedKey; storageLocator = $ci.storageLocator; key_generation = $ci.key_generation; channelId = $cid }
	$reg = Api $FedA POST "/groups/$gid/files" $body
	$reg.status -eq 201
}
Test-Case 'B sees file meta (DAG sync)' {
	[bool](PollUntil 60 3 {
		$m = Api $FedB GET "/groups/$gid/files/$fileId/meta"
		$m.status -eq 200 -and $m.json.fileId -eq $fileId
	})
}
Test-Case 'B downloads file content via federation' {
	$rs = Api $FedB POST "/groups/$gid/files/$fileId/download-resume" @{}
	if ($rs.status -ne 200) { throw "resume $($rs.status): $($rs.raw)" }
	# poll status to done
	$done = PollUntil 150 4 {
		$st = Api $FedB GET "/groups/$gid/files/$fileId/download-status"
		if ($st.status -ne 200) { return $false }
		$s = $st.json.status
		if ($s.status -eq 'failed' -or $s.error) { throw "download failed: $($st.raw)" }
		($s.status -eq 'done') -or ($s.percent -eq 100) -or ($s.done -ge $s.total -and $s.total -gt 0)
	}
	[bool]$done
}

# 第 8 段 kick/治理传播由 fed_ban.ps1 专门覆盖；本套件聚焦事件传播与文件同步路径，不重复。

Clear-FedGroup $gid
Write-FedSummary 'FED-EXT' $gid
Complete-LiveScript
