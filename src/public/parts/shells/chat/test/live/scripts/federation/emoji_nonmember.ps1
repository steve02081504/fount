# Non-member emoji content via /emoji-content (B never joins).
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$gid = $null; $cid = $null; $emojiId = $null

Write-Host "`n=== P2P warmup (user-room for fed_chunk_get fanout) ===" -ForegroundColor Cyan
$script:aNodeHash = $null
Test-Case 'federation identity ready on A/B' {
	$fa = P2pApi $FedA GET '/federation'
	$fb = P2pApi $FedB GET '/federation'
	$script:aNodeHash = $fa.json.nodeHash
	$fa.status -eq 200 -and $fb.status -eq 200 -and $fa.json.identityPubKeyHex -and $fb.json.identityPubKeyHex
}
	if ($script:aNodeHash) {
		P2pApi $FedB POST '/federation/connect-node' @{ targetNodeHash = $script:aNodeHash } | Out-Null
		$connected = PollUntil 30 2 {
			$fb = P2pApi $FedB GET '/federation'
			$fb.status -eq 200
		}
		if (-not $connected) { throw 'B failed to connect to A user-room for non-member emoji path' }
	}

Write-Host "`n=== Setup: A creates group + emoji (B does not join) ===" -ForegroundColor Cyan
Test-Case 'A creates group (B stays non-member)' {
	$g = (Api $FedA POST '/groups/' @{ name = 'FedEmojiNM'; description = 'L4 fed probe' }).json
	$script:gid = $g.groupId
	$script:cid = $g.defaultChannelId
	# 非成员靠 discovery 卡片 + 联邦房间拉 emoji；完全私密群 B 无法建连。
	Api $FedA PUT "/groups/$($script:gid)/settings" @{ joinPolicy = 'invite-only'; discoveryPublic = $true } | Out-Null
	[bool]$script:gid
}

Test-Case 'A uploads group emoji' {
	$r = ApiMultipart $FedA POST "/groups/$gid/emojis" @{ name = 'nm-emoji' } 'emoji' 'fed.png' $FedPngBytes
	if ($r.status -ne 201) { throw "upload $($r.status): $($r.raw)" }
	$script:emojiId = $r.json.entry.emojiId
	$script:emojiContentHash = $r.json.entry.contentHash
	[bool]$script:emojiId
}
Test-Case 'A seeds channel (federation metadata)' {
	$r = Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = "seed :[$gid/$emojiId]:" } }
	$r.status -in 200, 201
}

Write-Host "`n=== B (non-member) emoji-content ===" -ForegroundColor Cyan
Invoke-FedCatchupSync $FedA $gid 8000
Test-Case 'B GET /emoji-content without membership' {
	if (-not $emojiContentHash) { throw 'upload must yield contentHash for non-member CAS path' }
	$hashQ = "?json=1&contentHash=$emojiContentHash"
	$ok = Wait-FedConverged $FedB $gid {
		Api $FedB GET "/groups/$gid/preview" | Out-Null
		$r = Api $FedB GET "/emoji-content/$gid/$emojiId$hashQ"
		$r.status -eq 200 -and [bool]$r.json.dataUrl
	} 120 5 4000
	if (-not $ok) { throw 'non-member B must resolve /emoji-content on B node (not A-side fallback)' }
	$true
}

Test-Case 'B GET groups/:id/preview (non-member)' {
	$ok = PollUntil 30 3 {
		$r = Api $FedB GET "/groups/$gid/preview"
		$r.status -eq 200 -and $r.json.isMember -eq $false
	}
	[bool]$ok
}

Clear-FedGroup $gid
Write-FedSummary 'FED-EMOJI-NM' $gid
Complete-LiveScript
