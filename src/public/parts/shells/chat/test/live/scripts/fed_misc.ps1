# L4 federation misc: rebind, rotate-room-secret, join-snapshot, history-want,
# discovery, POST events remote verify, reputation slash fanout, owner-succession.
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$gid = $null; $cid = $null; $bPub = $null

Write-Host "=== Setup: open group + join ===" -ForegroundColor Cyan
$setup = Initialize-OpenGroupJoin 'FedMisc' 'misc-seed'
$gid = $setup.groupId; $cid = $setup.channelId

# 先在 A 侧稳定解析“活跃且非 founder”的对端成员，避免后续 slash / owner-succession 目标漂移。
$ownerSuccessionTarget = $null
$resolvedTarget = PollUntil 120 3 {
	Api $FedA POST "/groups/$gid/federation/catchup" @{ waitMs = 4000 } | Out-Null
	$st = Api $FedA GET "/groups/$gid/state"
	if ($st.status -ne 200) { return $null }
	$candidate = @($st.json.state.members | Where-Object {
		$_.status -eq 'active' -and $_.pubKeyHash -and ($_.roles -notcontains 'founder')
	})[0]
	if ($candidate) { return $candidate.pubKeyHash }
	$null
}
if ($resolvedTarget) {
	$ownerSuccessionTarget = [string]$resolvedTarget
	$bPub = $ownerSuccessionTarget
}
else {
	$stB = Api $FedB GET "/groups/$gid/state"
	if ($stB.status -eq 200 -and $stB.json.state.viewerMemberPubKeyHash) {
		$bPub = [string]$stB.json.state.viewerMemberPubKeyHash
		$ownerSuccessionTarget = $bPub
	}
}

Write-Host "`n=== 1. Federation control plane ===" -ForegroundColor Cyan
Test-Case 'A POST federation/rebind (first call must ok)' {
	$r = Api $FedA POST "/groups/$gid/federation/rebind" @{ channelId = $cid }
	$r.status -eq 200 -and $r.json.ok -eq $true
}
Test-Case 'A POST federation/rebind (idempotent second call)' {
	$r = Api $FedA POST "/groups/$gid/federation/rebind" @{ channelId = $cid }
	$r.status -eq 200 -and ($r.json.ok -eq $true -or $r.json.skipped -eq $true)
}
Test-Case 'A POST federation/rotate-room-secret' {
	$r = Api $FedA POST "/groups/$gid/federation/rotate-room-secret" @{}
	$r.status -eq 200 -and [bool]$r.json.mqttRoomSecret
}
Test-Case 'B POST federation/join-snapshot' {
	$r = Api $FedB POST "/groups/$gid/federation/join-snapshot" @{}
	$r.status -eq 200
}
Test-Case 'B POST federation/catchup after rotate' {
	$r = Api $FedB POST "/groups/$gid/federation/catchup" @{ waitMs = 5000 }
	$r.status -eq 200
}
Test-Case 'members still>=2 after rotate' {
	[bool](Wait-FedMembers $FedB $gid)
}

Write-Host "`n=== 2. history-want ===" -ForegroundColor Cyan
$histMsg = $null
Test-Case 'A posts history-want target' {
	$r = Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'history-want-target' } }
	if ($r.status -ne 201) { throw "send $($r.status)" }
	$script:histMsg = $r.json.event.id
	[bool]$script:histMsg
}
Test-Case 'B POST channels/:id/history-want' {
	$r = Api $FedB POST "/groups/$gid/channels/$cid/history-want" @{ limit = 50 }
	$r.status -eq 200 -and @($r.json.messages).Count -ge 1
}

Write-Host "`n=== 3. Discovery ===" -ForegroundColor Cyan
Test-Case 'A GET /discovery' {
	$r = Api $FedA GET '/discovery?limit=20'
	$r.status -eq 200
}
Test-Case 'A POST /discovery/refresh' {
	$r = Api $FedA POST '/discovery/refresh' @{}
	$r.status -eq 200
}
Test-Case 'B GET /discovery sees index' {
	$r = Api $FedB GET '/discovery?limit=20'
	$r.status -eq 200
}

Write-Host "`n=== 4. POST events remote verify (B ingests A-signed row) ===" -ForegroundColor Cyan
Test-Case 'B applies signed event from A via POST /events' {
	$ev = Api $FedA GET "/groups/$gid/events?limit=5"
	if ($ev.status -ne 200) { throw "events $($ev.status)" }
	$row = @($ev.json.events | Where-Object { $_.signature -and $_.id })[0]
	if (-not $row) { throw 'no signed event on A' }
	$eventId = [string]$row.id
	$r = Api $FedB POST "/groups/$gid/events" @{ events = @($row) }
	if ($r.status -ne 200) { throw "ingest $($r.status): $($r.raw)" }
	# applied=1 表示新入队，applied=0 表示已有（dup）；两者都表示事件在 B 上，只断言存在性。
	$onB = Api $FedB GET "/groups/$gid/events?limit=20"
	if ($onB.status -ne 200) { throw "B events $($onB.status)" }
	@($onB.json.events | Where-Object { $_.id -eq $eventId }).Count -eq 1
}

Write-Host "`n=== 5. Reputation slash fanout ===" -ForegroundColor Cyan
if ($bPub) {
	Test-Case 'A verified reputation/slash on B' {
		$tips = Api $FedA GET "/groups/$gid/dag/tips"
		$tip = @($tips.json.tips)[0]
		$r = Api $FedA POST "/groups/$gid/reputation/slash" @{
			targetPubKeyHash = $bPub
			claim = 0.05
			verified = $true
			proof = @{ eventId = $tip }
		}
		if ($r.status -ne 200) { throw "slash $($r.status): $($r.raw)" }
		Api $FedA POST "/groups/$gid/federation/catchup" @{ waitMs = 12000 } | Out-Null
		Api $FedA POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
		$ev = Api $FedA GET "/groups/$gid/events?limit=20"
		@($ev.json.events | Where-Object { $_.type -eq 'reputation_slash' }).Count -ge 1
	}
	Test-Case 'B GET reputation reflects slash (fanout/catchup)' {
		$ok = PollUntil 300 4 {
			Api $FedB POST "/groups/$gid/federation/catchup" @{ waitMs = 12000 } | Out-Null
			Api $FedB POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
			$ev = Api $FedB GET "/groups/$gid/events?limit=40"
			if ($ev.status -ne 200) { return $false }
			@($ev.json.events | Where-Object {
				$_.type -eq 'reputation_slash' -and $_.content.targetPubKeyHash -eq $bPub
			}).Count -ge 1
		}
		if (-not $ok) { throw 'B must receive reputation_slash via federation catchup (no manual A-side inject)' }
		$true
	}
}
else {
	Skip-Case 'reputation slash fanout' 'B member pubkey not resolved'
}

Write-Host "`n=== 6. Owner-succession cross-node ===" -ForegroundColor Cyan
if ($ownerSuccessionTarget) {
	Test-Case 'A POST owner-succession → B' {
		$st = Api $FedA GET "/groups/$gid/state"
		if ($st.status -ne 200) { throw "state $($st.status)" }
		$activeOnA = @($st.json.state.members | Where-Object { $_.pubKeyHash -eq $ownerSuccessionTarget }).Count -ge 1
		if (-not $activeOnA) { throw "proposed owner not active on A" }
		$ballotId = "fed-misc-os-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
		$r = Api $FedA POST "/groups/$gid/owner-succession" @{
			proposedOwnerPubKeyHash = $ownerSuccessionTarget
			ballotId = $ballotId
		}
		if ($r.status -ne 200) { throw "succession $($r.status): $($r.raw)" }
		Api $FedA POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
		$r.json.newOwnerPubKeyHash -eq $ownerSuccessionTarget
	}
	Test-Case 'B state sees new owner (federation)' {
		$hasTransferredFounder = {
			param($state)
			if ($state.groupMeta.ownerPubKeyHash -eq $ownerSuccessionTarget) { return $true }
			if ($state.delegatedOwnerPubKeyHash -eq $ownerSuccessionTarget) { return $true }
			$rows = @($state.members)
			$target = @($rows | Where-Object { $_.pubKeyHash -eq $ownerSuccessionTarget })[0]
			if (-not $target) { return $false }
			$targetIsFounder = @($target.roles) -contains 'founder'
			$otherFounders = @($rows | Where-Object {
				$_.status -eq 'active' -and $_.pubKeyHash -ne $ownerSuccessionTarget -and (@($_.roles) -contains 'founder')
			}).Count
			$targetIsFounder -and $otherFounders -eq 0
		}
		Api $FedB POST "/groups/$gid/federation/catchup" @{ waitMs = 20000 } | Out-Null
		$ok = PollUntil 120 4 {
			Api $FedB POST "/groups/$gid/federation/catchup" @{ waitMs = 8000 } | Out-Null
			Api $FedB POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
			$s = Api $FedB GET "/groups/$gid/state"
			if ($s.status -ne 200) { return $false }
			& $hasTransferredFounder $s.json.state
		}
		if (-not $ok) { throw 'B must see owner succession via federation catchup (no manual A-side inject)' }
		[bool]$ok
	}
}
else {
	Skip-Case 'owner-succession cross-node' 'B member pubkey not resolved'
}

# fork/block-opposing 纯逻辑由 chat/test/fork_block_opposing.test.mjs 覆盖；
# 双节点 HTTP 难以可靠构造带治理事件的对立 DAG 分叉。

Clear-FedGroup $gid
Write-FedSummary 'FED-MISC' $gid
Complete-LiveScript
