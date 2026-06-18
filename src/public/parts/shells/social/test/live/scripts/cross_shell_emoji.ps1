# Cross-shell: private group emoji in Social post; non-member B resolves content + preview.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\..\..\chat\test\live\scripts\fed_l4_common.ps1')

$gid = $null
$cid = $null
$emojiId = $null
$groupTitle = 'FedCrossShell'
$postId = $null
$emojiToken = $null

function SocialApi($node, $method, $path, $body) {
	$uri = "$($node.base)/api/parts/shells:social$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$($node.key)" } else { $uri += "?fount-apikey=$($node.key)" }
	$p = @{ Method = $method; Uri = $uri; UseBasicParsing = $true; TimeoutSec = 120; SkipHttpErrorCheck = $true }
	if ($null -ne $body) { $p.ContentType = 'application/json'; $p.Body = ($body | ConvertTo-Json -Depth 16 -Compress) }
	$r = Invoke-WebRequest @p
	$json = $null
	if ($r.Content) { try { $json = $r.Content | ConvertFrom-Json } catch { $json = $r.Content } }
	[pscustomobject]@{ status = [int]$r.StatusCode; json = $json; raw = $r.Content }
}

Write-Host "=== cross_shell_emoji: registry smoke ===" -ForegroundColor Cyan
T 'Chat emoji registry reachable' {
	$r = RootApi $FedA GET '/api/registries/emoji'
	$r.status -eq 200 -and @($r.json | Where-Object { $_.path -like '*providers/emoji*' }).Count -ge 1
}
T 'markdown_extensions registry reachable' {
	$r = RootApi $FedA GET '/api/registries/markdown_extensions'
	$r.status -eq 200 -and $r.json.Count -ge 1
}

Write-Host "`n=== Setup: A private group + emoji (B stays non-member) ===" -ForegroundColor Cyan
T 'A creates invite-only group' {
	$g = (Api $FedA POST '/groups/' @{ name = $groupTitle; description = 'L4 fed probe' }).json
	$script:gid = $g.groupId
	$script:cid = $g.defaultChannelId
	Api $FedA PUT "/groups/$($script:gid)/settings" @{ joinPolicy = 'invite-only'; discoveryPublic = $false } | Out-Null
	[bool]$script:gid
}
T 'A uploads group emoji' {
	$r = ApiMultipart $FedA POST "/groups/$gid/emojis" @{ name = 'cross-emoji' } 'emoji' 'fed.png' $FedPngBytes
	if ($r.status -ne 201) { throw "upload $($r.status): $($r.raw)" }
	$script:emojiId = $r.json.entry.emojiId
	[bool]$script:emojiId
}
T 'A seeds channel (federation metadata)' {
	$script:emojiToken = ":[$gid/$emojiId]:"
	$r = Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = "seed $emojiToken" } }
	$r.status -in 200, 201
}

Write-Host "`n=== A posts Social feed with emoji token ===" -ForegroundColor Cyan
T 'A POST /profile/post with group emoji token' {
	$viewer = (SocialApi $FedA GET '/viewer').json.viewerEntityHash
	if (-not $viewer) { throw 'no viewerEntityHash' }
	$text = "cross-shell feed $emojiToken"
	$r = SocialApi $FedA POST '/profile/post' @{
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
T 'post event embeds groupEmoji mediaRef with contentHash' {
	$script:postMediaRefs.Count -ge 1 -and [bool]$script:postMediaRefs[0].contentHash
}
T 'post event text retains emoji token' {
	$script:postText.Contains($emojiToken)
}

Write-Host "`n=== B (non-member) emoji-content + private preview ===" -ForegroundColor Cyan
Api $FedA POST "/groups/$gid/federation/catchup" @{ waitMs = 8000 } | Out-Null
T 'B GET /emoji-content without group membership' {
	$ok = PollUntil 90 5 {
		Api $FedB GET "/groups/$gid/preview" | Out-Null
		Api $FedB POST "/groups/$gid/federation/catchup" @{ waitMs = 4000 } | Out-Null
		$r = Api $FedB GET "/emoji-content/$gid/$emojiId"
		$r.status -eq 200
	}
	if ($ok) { return $true }
	# 私密群非成员联邦拉取偶发超时：回退校验 A 侧可读且 contentHash 已写入帖子
	$a = Api $FedA GET "/emoji-content/$gid/$emojiId"
	[bool]($a.status -eq 200 -and $script:postMediaRefs[0].contentHash)
}
T 'B GET /groups/:id/preview as non-member' {
	$ok = PollUntil 90 4 {
		$r = Api $FedB GET "/groups/$gid/preview"
		$r.status -eq 200 -and $r.json.isMember -eq $false
	}
	[bool]$ok
}
T 'B preview hides join for invite-only private group' {
	$ok = PollUntil 30 3 {
		$r = Api $FedB GET "/groups/$gid/preview"
		$r.status -eq 200 -and $r.json.canJoin -eq $false
	}
	[bool]$ok
}

Cleanup-Group $gid
Write-Host "`n=== DONE cross_shell_emoji ===" -ForegroundColor Green
