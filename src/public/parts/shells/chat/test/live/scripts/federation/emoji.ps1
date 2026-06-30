# L4 federation: A uploads group emoji; B fetches emojis/:id/data.
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$gid = $null; $emojiId = $null

Write-Host "=== Setup: open group + join ===" -ForegroundColor Cyan
$setup = Initialize-OpenGroupJoin 'FedEmoji' 'emoji-seed'
$gid = $setup.groupId

Write-Host "`n=== 1. A uploads group emoji ===" -ForegroundColor Cyan
Test-Case 'A POST /groups/:id/emojis multipart' {
	$r = ApiMultipart $FedA POST "/groups/$gid/emojis" @{ name = 'fed-emoji' } 'emoji' 'fed.png' $FedPngBytes
	if ($r.status -ne 201) { throw "upload $($r.status): $($r.raw)" }
	$script:emojiId = $r.json.entry.emojiId
	[bool]$script:emojiId
}
Test-Case 'A GET emoji data locally' {
	$r = Api $FedA GET "/groups/$gid/emojis/$emojiId/data?json=1"
	$r.status -eq 200 -and $r.json.dataUrl -like 'data:*'
}

Write-Host "`n=== 2. B federation pull ===" -ForegroundColor Cyan
Test-Case 'B sees emoji in manifest' {
	[bool](PollUntil 60 3 {
		$r = Api $FedB GET "/groups/$gid/emojis"
		$r.status -eq 200 -and @($r.json.entries | Where-Object { $_.emojiId -eq $script:emojiId }).Count -ge 1
	})
}
Test-Case 'B GET emojis/:id/data (federation fetch)' {
	$ok = PollUntil 90 4 {
		$r = Api $FedB GET "/groups/$gid/emojis/$emojiId/data?json=1"
		$r.status -eq 200 -and $r.json.dataUrl -like 'data:image/*'
	}
	[bool]$ok
}
Test-Case 'B data matches A (same length)' {
	$a = Api $FedA GET "/groups/$gid/emojis/$emojiId/data?json=1"
	$b = Api $FedB GET "/groups/$gid/emojis/$emojiId/data?json=1"
	$a.json.dataUrl.Length -gt 20 -and $b.json.dataUrl.Length -eq $a.json.dataUrl.Length
}

Clear-FedGroup $gid
Write-FedSummary 'FED-EMOJI' $gid
Complete-LiveScript
