# Cross-shell: private group emoji in Social post; non-member B resolves content + preview.
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$gid = $null
$cid = $null
$emojiId = $null
$groupTitle = 'FedCrossShell'
$postId = $null
$emojiToken = $null

Write-Host "=== cross_shell_emoji: registry smoke ===" -ForegroundColor Cyan
Test-Case 'Chat emoji registry reachable' {
	$r = RootApi $FedA GET '/api/registries/emoji'
	$r.status -eq 200 -and @($r.json | Where-Object { $_.path -like '*providers/emoji*' }).Count -ge 1
}
Test-Case 'markdown_extensions registry reachable' {
	$r = RootApi $FedA GET '/api/registries/markdown_extensions'
	$r.status -eq 200 -and $r.json.Count -ge 1
}

Write-Host "`n=== Setup: B follows A (TrustGraph CAS fanout for non-member emoji) ===" -ForegroundColor Cyan
Test-Case 'B follows A operator entity' {
	$viewerA = (ShellApi $FedA 'social' GET '/viewer').json.viewerEntityHash
	if (-not $viewerA) { throw 'no viewerEntityHash on A' }
	$r = ShellApi $FedB 'social' POST '/profile/follow' @{ entityHash = $viewerA; follow = $true }
	$r.status -eq 200
}

Write-Host "`n=== P2P warmup ===" -ForegroundColor Cyan
Test-Case 'federation identity ready on A/B' {
	$fa = P2pApi $FedA GET '/federation'
	$fb = P2pApi $FedB GET '/federation'
	$fa.status -eq 200 -and $fb.status -eq 200 -and $fa.json.identityPubKeyHex -and $fb.json.identityPubKeyHex
}
Start-Sleep 5

Write-Host "`n=== Setup: A private group + emoji (B stays non-member) ===" -ForegroundColor Cyan
Test-Case 'A creates invite-only group' {
	$g = (Api $FedA POST '/groups/' @{ name = $groupTitle; description = 'L4 fed probe' }).json
	$script:gid = $g.groupId
	$script:cid = $g.defaultChannelId
	# discoveryPublic 便于非成员通过联邦发现 MQTT 口令；joinPolicy 仍为 invite-only（canJoin=false）。
	Api $FedA PUT "/groups/$($script:gid)/settings" @{ joinPolicy = 'invite-only'; discoveryPublic = $true } | Out-Null
	[bool]$script:gid
}
Test-Case 'A uploads group emoji' {
	$r = ApiMultipart $FedA POST "/groups/$gid/emojis" @{ name = 'cross-emoji' } 'emoji' 'fed.png' $FedPngBytes
	if ($r.status -ne 201) { throw "upload $($r.status): $($r.raw)" }
	$script:emojiId = $r.json.entry.emojiId
	$script:emojiContentHash = $r.json.entry.contentHash
	[bool]$script:emojiId
}
Test-Case 'A seeds channel (federation metadata)' {
	Start-Sleep 2
	Api $FedA POST "/groups/$gid/federation/catchup" @{ waitMs = 6000 } | Out-Null
	$script:emojiToken = ":[$gid/$emojiId]:"
	$r = Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = "seed $emojiToken" } }
	$r.status -in 200, 201
}

Write-Host "`n=== A posts Social feed with emoji token ===" -ForegroundColor Cyan
Test-Case 'A POST /profile/post with group emoji token' {
	$viewer = (ShellApi $FedA 'social' GET '/viewer').json.viewerEntityHash
	if (-not $viewer) { throw 'no viewerEntityHash' }
	$text = "cross-shell feed $emojiToken"
	$r = ShellApi $FedA 'social' POST '/profile/post' @{
		entityHash = $viewer
		text = $text
		visibility = 'public'
		lang = 'zh-CN'
	}
	if ($r.status -ne 200) { throw "post $($r.status): $($r.raw)" }
	$script:postId = $r.json.event.id
	$script:postMediaRefs = @($r.json.event.content.mediaRefs | Where-Object { $_.kind -eq 'groupEmoji' })
	$script:postText = $r.json.event.content.text
	[bool]$script:postId
}
Test-Case 'post event embeds groupEmoji mediaRef with contentHash' {
	$script:postMediaRefs.Count -ge 1 -and [bool]$script:postMediaRefs[0].contentHash
}
Test-Case 'post event text retains emoji token' {
	$script:postText.Contains($emojiToken)
}

Write-Host "`n=== B (non-member) emoji-content + private preview ===" -ForegroundColor Cyan
Api $FedA POST "/groups/$gid/federation/catchup" @{ waitMs = 8000 } | Out-Null
Test-Case 'B GET /emoji-content without group membership' {
	# 纯非成员经 discovery + contentHash 拉取；查询参数对齐 Social mediaRef 渲染路径。
	$hash = $script:postMediaRefs[0].contentHash
	if (-not $hash) { $hash = $script:emojiContentHash }
	if (-not $hash) { throw 'post or upload must yield contentHash for non-member CAS path' }
	$hashQ = "?json=1&contentHash=$hash"
	$ok = PollUntil 120 5 {
		Api $FedB GET "/groups/$gid/preview" | Out-Null
		Api $FedB POST "/groups/$gid/federation/catchup" @{ waitMs = 3000 } | Out-Null
		$r = Api $FedB GET "/emoji-content/$gid/$emojiId$hashQ"
		$r.status -eq 200 -and [bool]$r.json.dataUrl
	}
	if (-not $ok) {
		$last = Api $FedB GET "/emoji-content/$gid/$emojiId$hashQ"
		throw "non-member B must resolve /emoji-content (not A-side fallback); last status=$($last.status) raw=$($last.raw)"
	}
	$true
}
Test-Case 'B GET /groups/:id/preview as non-member' {
	$ok = PollUntil 120 4 {
		Api $FedA POST "/groups/$gid/federation/catchup" @{ waitMs = 3000 } | Out-Null
		$r = Api $FedB GET "/groups/$gid/preview"
		$r.status -eq 200 -and $r.json.isMember -eq $false
	}
	[bool]$ok
}
Test-Case 'B preview hides join for invite-only private group' {
	$ok = PollUntil 30 3 {
		$r = Api $FedB GET "/groups/$gid/preview"
		$r.status -eq 200 -and $r.json.canJoin -eq $false
	}
	[bool]$ok
}

Clear-FedGroup $gid
Write-FedSummary 'CROSS-SHELL-EMOJI' $gid
Complete-LiveScript
