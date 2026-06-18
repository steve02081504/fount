# Member B resolves emoji via contentHash /emoji-content (CAS near-cache path).
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fed_l4_common.ps1')

$gid = $null; $emojiId = $null; $contentHash = $null

Write-Host "=== Setup: open group + A/B join ===" -ForegroundColor Cyan
$setup = Setup-OpenGroupJoin 'FedEmojiNC' 'emoji-nc-seed'
$gid = $setup.groupId

Write-Host "`n=== A uploads emoji (contentHash in manifest) ===" -ForegroundColor Cyan
T 'A POST /groups/:id/emojis' {
	$r = ApiMultipart $FedA POST "/groups/$gid/emojis" @{ name = 'nc-emoji' } 'emoji' 'fed.png' $FedPngBytes
	if ($r.status -ne 201) { throw "upload $($r.status): $($r.raw)" }
	$script:emojiId = $r.json.entry.emojiId
	$script:contentHash = $r.json.entry.contentHash
	[bool]$script:emojiId -and [bool]$script:contentHash
}

Write-Host "`n=== B near-cache via /emoji-content ===" -ForegroundColor Cyan
T 'B manifest lists contentHash after federation sync' {
	[bool](PollUntil 90 3 {
		$r = Api $FedB GET "/groups/$gid/emojis"
		if ($r.status -ne 200) { return $false }
		$e = @($r.json.entries | Where-Object { $_.emojiId -eq $script:emojiId })[0]
		$e -and $e.contentHash -eq $script:contentHash
	})
}
T 'B GET /emoji-content resolves image (first hit)' {
	$len = 0
	$ok = PollUntil 90 4 {
		$r = Api $FedB GET "/emoji-content/$gid/$emojiId?json=1"
		if ($r.status -ne 200) { return $false }
		$script:len = $r.json.dataUrl.Length
		$r.json.contentHash -eq $contentHash -and $script:len -gt 20
	}
	[bool]$ok
}
T 'B GET /emoji-content again (cached local path)' {
	$r = Api $FedB GET "/emoji-content/$gid/$emojiId?json=1"
	$r.status -eq 200 -and $r.json.dataUrl.Length -eq $len
}

Cleanup-Group $gid
Write-Host "`n=== DONE fed_emoji_nearcache ===" -ForegroundColor Green
