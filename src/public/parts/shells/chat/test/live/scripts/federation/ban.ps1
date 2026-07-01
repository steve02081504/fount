# L4 federation ABC: A bans B; C receives ban; B self-judges via fed_shun.
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

if (-not $script:FedC) { throw 'fed_ban requires FOUNT_TEST_NODE_COUNT >= 3' }

$gid = $null; $cid = $null; $bPub = $null; $banEventId = $null

Write-Host "=== Setup: open group + join A/B/C ===" -ForegroundColor Cyan
$setup = Initialize-OpenGroupJoinMulti 'FedBan' 'ban-seed-abc' @($script:FedB, $script:FedC)
$gid = $setup.groupId; $cid = $setup.channelId

Write-Host "`n=== 1. Resolve B member pubkey ===" -ForegroundColor Cyan
Test-Case 'resolve B pubKeyHash from B state' {
	$st = Api $FedB GET "/groups/$gid/state"
	if ($st.status -ne 200) { throw "state $($st.status)" }
	$script:bPub = $st.json.state.viewerMemberPubKeyHash
	[bool]$script:bPub
}

Write-Host "`n=== 2. A bans B (entity) ===" -ForegroundColor Cyan
Test-Case 'A memberCount >= 3 before ban' {
	$s = Api $FedA GET "/groups/$gid/state"
	$s.status -eq 200 -and [int]$s.json.state.memberCount -ge 3
}
Test-Case 'A POST members/:hash/ban entity' {
	$k = Api $FedA POST "/groups/$gid/members/$($script:bPub)/ban" @{ banScope = 'entity' }
	if ($k.status -ne 200) { throw "ban $($k.status): $($k.raw)" }
	Api $FedA POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
	Api $FedA POST "/groups/$gid/federation/catchup" @{ waitMs = 6000 } | Out-Null
	$true
}
Test-Case 'A state lists B in bannedMembers' {
	$ok = PollUntil 30 2 {
		$s = Api $FedA GET "/groups/$gid/state"
		@($s.json.state.bannedMembers | Where-Object { $_.pubKeyHash -eq $script:bPub }).Count -ge 1
	}
	[bool]$ok
}

Write-Host "`n=== 3. C receives ban via federation ===" -ForegroundColor Cyan
Test-Case 'C catchup receives ban (third-party sync)' {
	$ok = PollUntil 180 4 {
		# 仅 A/C 需 rebind；B 已被封禁，反复 rebind 会徒增 P2P 负载且与「C 收 ban」无关
		foreach ($node in @($script:FedA, $script:FedC)) {
			Api $node POST "/groups/$gid/federation/rebind" @{} | Out-Null
		}
		Api $FedA POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
		Api $FedA POST "/groups/$gid/federation/catchup" @{ waitMs = 8000 } | Out-Null
		$ev = Api $FedA GET "/groups/$gid/events?limit=40"
		if ($ev.status -eq 200) {
			$banRow = @($ev.json.events | Where-Object { $_.type -eq 'member_ban' } | Select-Object -Last 1)
			if ($banRow) { $script:banEventId = $banRow.id }
		}
		Api $FedC POST "/groups/$gid/federation/join-snapshot" @{} | Out-Null
		$body = @{ waitMs = 10000 }
		if ($script:banEventId) { $body.extraWantIds = @($script:banEventId) }
		Api $FedC POST "/groups/$gid/federation/catchup" $body | Out-Null
		Api $FedC POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
		$s = Api $FedC GET "/groups/$gid/state"
		if ($s.status -ne 200) { return $false }
		@($s.json.state.bannedMembers | Where-Object { $_.pubKeyHash -eq $script:bPub }).Count -ge 1
	}
	if (-not $ok) { throw 'C must receive member_ban via normal federation catchup' }
	$true
}

Write-Host "`n=== 4. B probes peers and self-judges removed ===" -ForegroundColor Cyan
Test-Case 'B catchup probes shunned by A and C -> suspectedRemoved' {
	$ok = PollUntil 180 4 {
		foreach ($node in @($script:FedB, $script:FedA, $script:FedC)) {
			Api $node POST "/groups/$gid/federation/rebind" @{} | Out-Null
		}
		$r = Api $FedB POST "/groups/$gid/federation/catchup" @{ waitMs = 15000 }
		if ($r.status -ne 200) { return $false }
		if ($r.json.suspectedRemoved -eq $true) { return $true }
		$s = Api $FedB GET "/groups/$gid/state"
		$s.status -eq 200 -and $s.json.state.suspectedRemoved -eq $true
	}
	if (-not $ok) { throw 'B must suspect removal after shuns from known member nodes' }
	$true
}
Test-Case 'B state does not materialize ban event locally' {
	$s = Api $FedB GET "/groups/$gid/state"
	@($s.json.state.bannedMembers | Where-Object { $_.pubKeyHash -eq $script:bPub }).Count -eq 0
}

Write-Host "`n=== 5. B cannot send; A roster clean ===" -ForegroundColor Cyan
Test-Case 'B POST message rejected after suspectedRemoved (403)' {
	$ok = PollUntil 30 2 {
		$s = Api $FedB GET "/groups/$gid/state"
		if ($s.status -ne 200 -or $s.json.state.suspectedRemoved -ne $true) { return $false }
		$r = Api $FedB POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'banned-attempt' } }
		$r.status -eq 403
	}
	if (-not $ok) { throw 'B must be suspectedRemoved and get 403 on POST message' }
	$true
}
Test-Case 'A channel has no banned-attempt message' {
	$ok = PollUntil 30 3 {
		Api $FedA POST "/groups/$gid/federation/catchup" @{ waitMs = 4000 } | Out-Null
		$m = Api $FedA GET "/groups/$gid/channels/$cid/messages?limit=80"
		if ($m.status -ne 200) { return $false }
		@($m.json.messages | Where-Object {
			$_.content.content -match 'banned-attempt'
		}).Count -eq 0
	}
	[bool]$ok
}
Test-Case 'A events keep member_ban and no unban rollback' {
	$ev = Api $FedA GET "/groups/$gid/events?limit=60"
	if ($ev.status -ne 200) { return $false }
	$banN = @($ev.json.events | Where-Object { $_.type -eq 'member_ban' }).Count
	$unbanN = @($ev.json.events | Where-Object { $_.type -eq 'member_unban' }).Count
	$banN -ge 1 -and $unbanN -eq 0
}
Test-Case 'A can still send after ban' {
	$r = Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'after-ban-A' } }
	$r.status -eq 201
}

Clear-FedGroup $gid
Write-FedSummary 'FED-BAN' $gid
Complete-LiveScript
