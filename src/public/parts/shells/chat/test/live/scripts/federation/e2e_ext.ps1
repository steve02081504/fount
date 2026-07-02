# Extended 2-node federation E2E: event propagation, file transfer.
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
$jr = Api $FedB POST "/groups/$gid/join" @{ roomSecret = $inv.roomSecret; signalingAppId = $inv.signalingAppId; introducerPubKeyHash = $inv.introducerPubKeyHash }
Write-Host "join -> $($jr.status)"
if ($jr.status -ne 200) { throw "B join failed: $($jr.status) $($jr.raw)" }
$caught = Wait-FedMembers $FedB $gid 2 90
Write-Host "B caught up membership: $caught"
if (-not $caught) { throw 'B never reached members>=2 after join' }

Write-Host "`n=== 1. Catchup of seed message A->B ===" -ForegroundColor Cyan
Test-Case 'B sees seed message' {
	Wait-FedConverged $FedB $gid { Test-FedHasMessage $FedB $gid $cid $seedMsg } 60 3 6000
}

Write-Host "`n=== 2. New channel propagation A->B ===" -ForegroundColor Cyan
$newChan = (Api $FedA POST "/groups/$gid/channels" @{ name = 'fed-chan'; type = 'text' }).json.channelId
Test-Case 'B sees new channel' {
	Wait-FedConverged $FedB $gid { Test-FedHasChannel $FedB $gid $newChan } 60 3 6000
}

Write-Host "`n=== 3. Live message B->A ===" -ForegroundColor Cyan
$bMsg = (Api $FedB POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'from-B' } }).json.event.id
Test-Case 'A sees B message (live)' {
	Wait-FedLive $FedA $gid { Test-FedHasMessage $FedA $gid $cid $bMsg } 60 3
}

Write-Host "`n=== 4. Reaction propagation A->B ===" -ForegroundColor Cyan
$emoji = "$([char]0xD83D)$([char]0xDC4D)"
$seenOnA = Wait-FedLive $FedA $gid { Test-FedHasMessage $FedA $gid $cid $bMsg } 60 3
if (-not $seenOnA) { throw 'A must see B message before reaction (live push prerequisite)' }
$reactResp = Api $FedA POST "/groups/$gid/channels/$cid/reactions" @{ targetEventId = $bMsg; emoji = $emoji }
Test-Case 'A POST reaction succeeds' {
	$reactResp.status -eq 200
}
Test-Case 'B sees reaction on B-msg' {
	Wait-FedLive $FedB $gid { Test-FedHasReaction $FedB $gid $cid $bMsg } 60 3
}

Write-Host "`n=== 5. Edit propagation A->B ===" -ForegroundColor Cyan
$aMsg = (Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'orig-A' } }).json.event.id
Api $FedA PUT "/groups/$gid/channels/$cid/messages/$aMsg" @{ content = @{ type = 'text'; content = 'edited-A' } } | Out-Null
Test-Case 'B sees edited content' {
	Wait-FedLive $FedB $gid { Test-FedMessageContent $FedB $gid $cid $aMsg 'edited-A' } 60 3
}

Write-Host "`n=== 6. Delete propagation A->B ===" -ForegroundColor Cyan
Api $FedA DELETE "/groups/$gid/channels/$cid/messages/$aMsg" | Out-Null
Test-Case 'B sees message deleted/redacted' {
	Wait-FedLive $FedB $gid { Test-FedMessageDeleted $FedB $gid $cid $aMsg } 60 3
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
	Wait-FedConverged $FedB $gid {
		$m = Api $FedB GET "/groups/$gid/files/$fileId/meta"
		$m.status -eq 200 -and $m.json.fileId -eq $fileId
	} 60 3 6000
}
Test-Case 'B downloads file content via federation' {
	$rs = Api $FedB POST "/groups/$gid/files/$fileId/download-resume" @{}
	if ($rs.status -ne 200) { throw "resume $($rs.status): $($rs.raw)" }
	$done = PollUntil 150 4 {
		$st = Api $FedB GET "/groups/$gid/files/$fileId/download-status"
		if ($st.status -ne 200) { return $false }
		$s = $st.json.status
		if ($s.status -eq 'failed' -or $s.error) { throw "download failed: $($st.raw)" }
		($s.status -eq 'done') -or ($s.percent -eq 100) -or ($s.done -ge $s.total -and $s.total -gt 0)
	}
	[bool]$done
}

Clear-FedGroup $gid
Write-FedSummary 'FED-EXT' $gid
Complete-LiveScript
