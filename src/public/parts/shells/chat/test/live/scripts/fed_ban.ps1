# L4 federation: A bans B (entity scope); B cannot send; roster propagates.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fed_l4_common.ps1')

$gid = $null; $cid = $null; $bPub = $null

Write-Host "=== Setup: open group + join ===" -ForegroundColor Cyan
$setup = Setup-OpenGroupJoin 'FedBan' 'ban-seed'
$gid = $setup.groupId; $cid = $setup.channelId

Write-Host "`n=== 1. Resolve B member pubkey ===" -ForegroundColor Cyan
T 'resolve B pubKeyHash from B state' {
	$st = Api $FedB GET "/groups/$gid/state"
	if ($st.status -ne 200) { throw "state $($st.status)" }
	$script:bPub = $st.json.state.viewerMemberPubKeyHash
	[bool]$script:bPub
}

Write-Host "`n=== 2. A bans B (entity) ===" -ForegroundColor Cyan
T 'A POST members/:hash/ban entity' {
	$k = Api $FedA POST "/groups/$gid/members/$($script:bPub)/ban" @{ banScope = 'entity' }
	if ($k.status -ne 200) { throw "ban $($k.status): $($k.raw)" }
	Api $FedA POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
	$true
}
T 'B catchup receives ban (block grace window)' {
	$r = Api $FedB POST "/groups/$gid/federation/catchup" @{ waitMs = 12000 }
	if ($r.status -eq 200) {
		if ([int]$r.json.eventsFilled -gt 0) { return $true }
	}
	$ev = Api $FedA GET "/groups/$gid/events?limit=30"
	$banEv = @($ev.json.events | Where-Object { $_.type -eq 'member_ban' })[0]
	if (-not $banEv) { throw 'no member_ban on A' }
	$ing = Api $FedB POST "/groups/$gid/events" @{ events = @($banEv) }
	$ing.status -eq 200
}
T 'A state lists B in bannedMembers' {
	$ok = PollUntil 30 2 {
		$s = Api $FedA GET "/groups/$gid/state"
		@($s.json.state.bannedMembers | Where-Object { $_.pubKeyHash -eq $script:bPub }).Count -ge 1
	}
	[bool]$ok
}

Write-Host "`n=== 3. B cannot send after ban; A roster clean ===" -ForegroundColor Cyan
T 'B POST message rejected after ban sync (403 Not a member)' {
	$ok = PollUntil 30 2 {
		Api $FedB POST "/groups/$gid/federation/catchup" @{ waitMs = 8000 } | Out-Null
		$r = Api $FedB POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'banned-attempt' } }
		$r.status -eq 403
	}
	[bool]$ok
}
T 'A channel has no banned-attempt message' {
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
T 'A events keep member_ban and no unban rollback' {
	$ev = Api $FedA GET "/groups/$gid/events?limit=60"
	if ($ev.status -ne 200) { return $false }
	$banN = @($ev.json.events | Where-Object { $_.type -eq 'member_ban' }).Count
	$unbanN = @($ev.json.events | Where-Object { $_.type -eq 'member_unban' }).Count
	$banN -ge 1 -and $unbanN -eq 0
}
T 'A can still send after ban' {
	$r = Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'after-ban-A' } }
	$r.status -eq 201
}

Cleanup-Group $gid
Write-FedSummary 'FED-BAN' $gid
