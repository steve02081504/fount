# Non-member emoji content via /emoji-content (no group join).
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fed_l4_common.ps1')

$gid = $null; $emojiId = $null

Write-Host "=== Setup: A creates group + emoji (B does not join) ===" -ForegroundColor Cyan
$setup = Setup-OpenGroupJoin 'FedEmojiNM' 'emoji-nm-seed'
$gid = $setup.groupId

T 'A uploads group emoji' {
	$r = ApiMultipart $FedA POST "/groups/$gid/emojis" @{ name = 'nm-emoji' } 'emoji' 'fed.png' $FedPngBytes
	if ($r.status -ne 201) { throw "upload $($r.status): $($r.raw)" }
	$script:emojiId = $r.json.entry.emojiId
	[bool]$script:emojiId
}

Write-Host "`n=== B (non-member) emoji-content ===" -ForegroundColor Cyan
T 'B GET /emoji-content without membership' {
	$ok = PollUntil 90 4 {
		$r = Api $FedB GET "/emoji-content/$gid/$emojiId"
		$r.status -eq 200
	}
	[bool]$ok
}

T 'B GET groups/:id/preview (non-member)' {
	$r = Api $FedB GET "/groups/$gid/preview"
	$r.status -eq 200 -and $null -ne $r.json.title
}

Write-Host "`n=== DONE fed_emoji_nonmember ===" -ForegroundColor Green
