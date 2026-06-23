# L4 federation: DM identity + intro link + join + bidirectional messages.
# Requires dual nodes via test/live/run.mjs (FOUNT_TEST_BASE_URL + FOUNT_TEST_NODE_B_BASE_URL).
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$gid = $null; $cid = $null

function Get-Identity($node) {
	$r = P2pApi $node GET '/federation'
	if ($r.status -ne 200) { throw "federation GET $($r.status)" }
	$r.json.identityPubKeyHex.ToLower()
}

function Get-WhoamiUser($node) {
	$r = RootApi $node GET '/api/whoami'
	if ($r.status -ne 200) { throw "whoami $($r.status)" }
	$r.json.username
}

function Build-DmIntro($node) {
	$user = Get-WhoamiUser $node
	$dataPath = (Resolve-Path $node.dataPath).Path
	$helper = Join-Path $PSScriptRoot 'fed_dm_intro_helper.mjs'
	$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
	$out = & deno run -A $helper --data-path $dataPath --user $user 2>&1
	if ($LASTEXITCODE -ne 0) { throw "dm intro helper failed: $out" }
	$out | ConvertFrom-Json
}

function Resolve-UsableChannelId($node, $gid, $currentCid) {
	if ($currentCid) { return $currentCid }
	$resolved = PollUntil 120 3 {
		$st = Api $node GET "/groups/$gid/state"
		if ($st.status -ne 200) { return $null }
		$defaultCid = $st.json.state.groupSettings.defaultChannelId
		if ($defaultCid) { return $defaultCid }
		if ($st.json.state.channels) {
			$chNames = @($st.json.state.channels.PSObject.Properties.Name)
			if ($chNames.Count -ge 1) { return $chNames[0] }
		}
		$null
	}
	return $resolved
}

Write-Host "=== Setup: identities + DM intro ===" -ForegroundColor Cyan
$aPub = Get-Identity $FedA
$bPub = Get-Identity $FedB
Write-Host "A identity=$aPub" -ForegroundColor DarkGray
Write-Host "B identity=$bPub" -ForegroundColor DarkGray

if ($aPub -lt $bPub) {
	$creator = $FedA; $joiner = $FedB; $creatorPub = $aPub; $peerPub = $bPub
}
else {
	$creator = $FedB; $joiner = $FedA; $creatorPub = $bPub; $peerPub = $aPub
}
Write-Host "DM creator=$($creator.name) (lower pubkey)" -ForegroundColor Cyan

# 清理陈旧 DM replica（仅 DELETE，避免 POST template=dm 触发 408）
foreach ($node in @($creator, $joiner)) {
	$list = Api $node GET '/groups/'
	if ($list.status -ne 200) { continue }
	foreach ($row in @($list.json)) {
		if ($row.name -like 'DM ·*') {
			Api $node DELETE "/groups/$($row.groupId)" | Out-Null
		}
	}
}
Start-Sleep 2

# 较低公钥方先建群（无需 dmIntro）；较高公钥方 join 时携带较低方的 intro 签名。
$intro = Build-DmIntro $creator

Write-Host "`n=== 1. Creator opens DM group ===" -ForegroundColor Cyan
Test-Case 'lower-pubkey node POST template=dm' {
	$r = Api $creator POST '/groups/' @{
		template = 'dm'
		myPubKeyHex = $creatorPub
		peerPubKeyHex = $peerPub
	}
	if ($r.status -ne 201) { throw "create $($r.status): $($r.raw)" }
	$script:gid = $r.json.groupId; $script:cid = $r.json.defaultChannelId
	[bool]($script:gid -and $script:cid)
}

Write-Host "`n=== 2. Peer joins DM (intro + mqtt) ===" -ForegroundColor Cyan
Test-Case 'invite-ticket mqtt creds on creator' {
	$inv = Api $creator POST "/groups/$gid/invite-ticket" @{ ttlMs = 3600000 }
	if ($inv.status -ne 201 -and $inv.status -ne 200) { throw "invite $($inv.status)" }
	$script:dmInv = $inv.json
	[bool]$script:dmInv.mqttRoomSecret
}
Test-Case 'peer join with dmIntro proof' {
	$joined = PollUntil 120 4 {
		$jr = Api $joiner POST "/groups/$gid/join" @{
			mqttRoomSecret = $script:dmInv.mqttRoomSecret
			mqttAppId = $script:dmInv.mqttAppId
				dmSessionTag = $script:dmInv.dmSessionTag
			introducerPubKeyHash = $intro.pubKeyHex
			dmIntroNonce = $intro.dmIntroNonce
			dmIntroSignatureHex = $intro.dmIntroSignatureHex
		}
		if ($jr.status -eq 200) { return $jr }
		Write-Host "    join retry status=$($jr.status) body=$($jr.raw)" -ForegroundColor DarkGray
		$false
	}
	if (-not $joined) { throw 'join did not return 200' }
	if ($joined.json.defaultChannelId) { $script:cid = $joined.json.defaultChannelId }
	[bool](PollUntil 180 4 {
		Api $joiner POST "/groups/$gid/federation/catchup" @{ waitMs = 6000 } | Out-Null
		Api $creator POST "/groups/$gid/federation/catchup" @{ waitMs = 6000 } | Out-Null
		Api $joiner POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
		$st = Api $joiner GET "/groups/$gid/state"
		if ($st.json.state.groupSettings.defaultChannelId) {
			$script:cid = $st.json.state.groupSettings.defaultChannelId
		}
		elseif ($st.json.state.channels) {
			$chNames = @($st.json.state.channels.PSObject.Properties.Name)
			if ($chNames.Count -ge 1) { $script:cid = $chNames[0] }
		}
		($st.json.state.channels.PSObject.Properties | Measure-Object).Count -ge 1
	})
}

Write-Host "`n=== 3. Federation health gate ===" -ForegroundColor Cyan
Test-Case 'joiner join-snapshot + catchup' {
	Api $joiner POST "/groups/$gid/federation/join-snapshot" @{} | Out-Null
	$r = Api $joiner POST "/groups/$gid/federation/catchup" @{ waitMs = 25000 }
	$r.status -eq 200
}
Test-Case 'creator join-snapshot + catchup sees joiner' {
	Api $creator POST "/groups/$gid/federation/join-snapshot" @{} | Out-Null
	$r = Api $creator POST "/groups/$gid/federation/catchup" @{ waitMs = 25000 }
	if ($r.status -ne 200) { throw "catchup $($r.status)" }
	Api $creator POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
	Api $joiner POST "/groups/$gid/federation/catchup" @{ waitMs = 12000 } | Out-Null
	Api $joiner POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
	$true
}
Test-Case 'creator members>=2 after DM join' {
	[bool](Wait-FedMembers $creator $gid 2 120)
}
Test-Case 'joiner state has default channel' {
	[bool](PollUntil 90 3 {
		Api $joiner POST "/groups/$gid/federation/catchup" @{ waitMs = 4000 } | Out-Null
		$s = Api $joiner GET "/groups/$gid/state"
		if ($s.json.state.groupSettings.defaultChannelId) {
			$script:cid = $s.json.state.groupSettings.defaultChannelId
		}
		elseif ($s.json.state.channels) {
			$chNames = @($s.json.state.channels.PSObject.Properties.Name)
			if ($chNames.Count -ge 1) { $script:cid = $chNames[0] }
		}
		$s.status -eq 200 -and ($s.json.state.channels.PSObject.Properties | Measure-Object).Count -ge 1
	})
}

Write-Host "`n=== 4. Bidirectional messages ===" -ForegroundColor Cyan
$aMsg = $null; $bMsg = $null
Test-Case 'creator sends DM-A' {
	$script:cid = Resolve-UsableChannelId $creator $gid $script:cid
	if (-not $script:cid) { throw 'creator channel not materialized' }
	$r = Api $creator POST "/groups/$gid/channels/$script:cid/messages" @{ content = @{ type = 'text'; content = 'dm-A-to-B' } }
	if ($r.status -ne 201) { throw "send $($r.status)" }
	$script:aMsg = $r.json.event.id
	[bool]$script:aMsg
}
Test-Case 'joiner sees dm-A (catchup/live)' {
	[bool](PollUntil 90 3 {
		Api $joiner POST "/groups/$gid/federation/catchup" @{ waitMs = 3000 } | Out-Null
		$m = Api $joiner GET "/groups/$gid/channels/$script:cid/messages"
		$m.status -eq 200 -and @($m.json.messages | Where-Object { $_.eventId -eq $script:aMsg }).Count -ge 1
	})
}
Test-Case 'joiner sends DM-B' {
	$ready = PollUntil 90 3 {
		Api $joiner POST "/groups/$gid/federation/catchup" @{ waitMs = 4000 } | Out-Null
		$s = Api $joiner GET "/groups/$gid/state"
		if ($s.json.state.groupSettings.defaultChannelId) {
			$script:cid = $s.json.state.groupSettings.defaultChannelId
		}
		elseif ($s.json.state.channels) {
			$chNames = @($s.json.state.channels.PSObject.Properties.Name)
			if ($chNames.Count -ge 1) { $script:cid = $chNames[0] }
		}
		$s.status -eq 200 -and ($s.json.state.channels.PSObject.Properties | Measure-Object).Count -ge 1
	}
	if (-not $ready) { throw 'joiner channels not materialized' }
	$r = Api $joiner POST "/groups/$gid/channels/$script:cid/messages" @{ content = @{ type = 'text'; content = 'dm-B-to-A' } }
	if ($r.status -ne 201) { throw "send $($r.status): $($r.raw)" }
	$script:bMsg = $r.json.event.id
	[bool]$script:bMsg
}
Test-Case 'creator sees dm-B' {
	[bool](PollUntil 90 3 {
		Api $creator POST "/groups/$gid/federation/catchup" @{ waitMs = 3000 } | Out-Null
		$m = Api $creator GET "/groups/$gid/channels/$script:cid/messages"
		$m.status -eq 200 -and @($m.json.messages | Where-Object { $_.eventId -eq $script:bMsg }).Count -ge 1
	})
}

Clear-FedGroup $gid
Write-FedSummary 'FED-DM' $gid
Complete-LiveScript
