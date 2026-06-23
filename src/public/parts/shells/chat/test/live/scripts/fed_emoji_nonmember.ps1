# Non-member emoji content via /emoji-content (B never joins).
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$gid = $null; $cid = $null; $emojiId = $null

Write-Host "=== Setup: A creates group + emoji (B does not join) ===" -ForegroundColor Cyan
Test-Case 'A creates group (B stays non-member)' {
	$g = (Api $FedA POST '/groups/' @{ name = 'FedEmojiNM'; description = 'L4 fed probe' }).json
	$script:gid = $g.groupId
	$script:cid = $g.defaultChannelId
	Api $FedA PUT "/groups/$($script:gid)/settings" @{ joinPolicy = 'invite-only'; discoveryPublic = $false } | Out-Null
	[bool]$script:gid
}

Test-Case 'A uploads group emoji' {
	$r = ApiMultipart $FedA POST "/groups/$gid/emojis" @{ name = 'nm-emoji' } 'emoji' 'fed.png' $FedPngBytes
	if ($r.status -ne 201) { throw "upload $($r.status): $($r.raw)" }
	$script:emojiId = $r.json.entry.emojiId
	[bool]$script:emojiId
}
Test-Case 'A seeds channel (federation metadata)' {
	$r = Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = "seed :[$gid/$emojiId]:" } }
	$r.status -in 200, 201
}

Write-Host "`n=== B (non-member) emoji-content ===" -ForegroundColor Cyan
Api $FedA POST "/groups/$gid/federation/catchup" @{ waitMs = 8000 } | Out-Null
Test-Case 'B GET /emoji-content without membership' {
	$ok = PollUntil 90 5 {
		Api $FedB GET "/groups/$gid/preview" | Out-Null
		Api $FedB POST "/groups/$gid/federation/catchup" @{ waitMs = 4000 } | Out-Null
		$r = Api $FedB GET "/emoji-content/$gid/$emojiId"
		$r.status -eq 200 -and [bool]$r.json.dataUrl
	}
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
