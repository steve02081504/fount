# L4 federation: mailbox summary + room-ready ingest hooks (loopback deliver is best-effort).
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$gid = $null; $cid = $null

Write-Host "=== 1. Mailbox summary (local observable) ===" -ForegroundColor Cyan
Test-Case 'A GET chat/mailbox/summary' {
	$r = Api $FedA GET '/mailbox/summary'
	$r.status -eq 200 -and $null -ne $r.json.pending
}
Test-Case 'B GET chat/mailbox/summary' {
	$r = Api $FedB GET '/mailbox/summary'
	$r.status -eq 200 -and $null -ne $r.json.pending
}
Test-Case 'A GET p2p/mailbox/summary' {
	$r = P2pApi $FedA GET '/mailbox/summary'
	$r.status -eq 200 -and $null -ne $r.json.pending
}
Test-Case 'B GET p2p/mailbox/summary' {
	$r = P2pApi $FedB GET '/mailbox/summary'
	$r.status -eq 200 -and $null -ne $r.json.pending
}

Write-Host "`n=== Setup: federated group ===" -ForegroundColor Cyan
$setup = Initialize-OpenGroupJoin 'FedMailbox' 'mailbox-seed'
$gid = $setup.groupId; $cid = $setup.channelId

Write-Host "`n=== 2. Room ready → mailbox pull path ===" -ForegroundColor Cyan
Test-Case 'B POST federation/rebind (room bind)' {
	$r = Api $FedB POST "/groups/$gid/federation/rebind" @{}
	$r.status -eq 200 -and $r.json.ok -eq $true
}
Test-Case 'B POST federation/catchup (room activity)' {
	$r = Api $FedB POST "/groups/$gid/federation/catchup" @{ waitMs = 3000 }
	$r.status -eq 200
}
Test-Case 'summary still healthy after room ops' {
	$a = Api $FedA GET '/mailbox/summary'
	$b = Api $FedB GET '/mailbox/summary'
	$a.status -eq 200 -and $b.status -eq 200
}

Write-Host "`n=== 3. Live message while room up (not mailbox) ===" -ForegroundColor Cyan
$liveId = $null
Test-Case 'A sends while B room warm' {
	$r = Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'mailbox-live-check' } }
	if ($r.status -ne 201) { throw "send $($r.status)" }
	$script:liveId = $r.json.event.id
	[bool]$script:liveId
}
Test-Case 'B receives via federation (not mailbox)' {
	[bool](PollUntil 60 3 {
		$m = Api $FedB GET "/groups/$gid/channels/$cid/messages"
		@($m.json.messages | Where-Object { $_.eventId -eq $script:liveId }).Count -ge 1
	})
}

# cross-node mailbox 投递依赖 loopback 上不稳定的 User Room / WebRTC，无 HTTP 注入 mailbox_put 端点；
# mailbox ingest/dispatch 由 src/scripts/p2p/test/mailbox_deliver.test.mjs 覆盖。

Clear-FedGroup $gid
Write-FedSummary 'FED-MAILBOX' $gid
Complete-LiveScript
