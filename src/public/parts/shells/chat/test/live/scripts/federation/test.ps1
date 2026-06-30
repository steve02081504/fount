# Two-node federation: catchup (A1→B), live push (B1→A), catchup recovery fallback.
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

Clear-FedTestGroups

Write-Host "=== 1. NodeA: create group ===" -ForegroundColor Cyan
$g = Api $FedA POST '/groups/' @{ name = 'FedTest'; description = 'two-node federation test' }
if ($g.status -ne 201) { throw "create group failed: $($g.status)" }
$groupId = $g.json.groupId
$channelId = $g.json.defaultChannelId
Write-Host "groupId=$groupId  channelId=$channelId" -ForegroundColor Cyan

Write-Host "`n=== 2. NodeA: set joinPolicy=open ===" -ForegroundColor Cyan
Api $FedA PUT "/groups/$groupId/settings" @{ joinPolicy = 'open' } | Out-Null

Write-Host "`n=== 3. NodeA: create invite-ticket (get room creds) ===" -ForegroundColor Cyan
$inv = Api $FedA POST "/groups/$groupId/invite-ticket" @{ ttlMs = 3600000 }
if ($inv.status -ne 200 -and $inv.status -ne 201) { throw "invite-ticket failed: $($inv.status)" }
$signalingAppId = $inv.json.signalingAppId
$roomSecret = $inv.json.roomSecret
$introducer = $inv.json.introducerPubKeyHash
Write-Host "signalingAppId=$signalingAppId" -ForegroundColor Cyan
Write-Host "roomSecret=$($roomSecret.Substring(0,[Math]::Min(16,$roomSecret.Length)))..." -ForegroundColor Cyan
Write-Host "introducer=$introducer" -ForegroundColor Cyan

Write-Host "`n=== 4. NodeA: send message #A1 ===" -ForegroundColor Cyan
Api $FedA POST "/groups/$groupId/channels/$channelId/messages" @{ content = @{ type = 'text'; content = 'A1: hello from NodeA' } } | Out-Null

Write-Host "`n=== 5. NodeB: join group (no inviteCode, with room creds) ===" -ForegroundColor Cyan
$joinBody = @{ roomSecret = $roomSecret; signalingAppId = $signalingAppId; introducerPubKeyHash = $introducer }
$jr = Api $FedB POST "/groups/$groupId/join" $joinBody
if ($jr.status -ne 200) { throw "join failed: $($jr.status) $($jr.raw)" }
Write-Host "join result: $($jr.json | ConvertTo-Json -Compress)" -ForegroundColor Cyan

Write-Host "`n=== 6. NodeB: federation health gate (members>=2) ===" -ForegroundColor Cyan
$bReady = Wait-FedMembers $FedB $groupId 2 120
if (-not $bReady) { throw 'NodeB never materialized group state (members>=2)' }

Write-Host "`n=== 7. NodeB: read messages (expect A1 via catchup) ===" -ForegroundColor Cyan
$gotA1 = [bool](PollUntil 120 3 {
	try {
		Api $FedB POST "/groups/$groupId/federation/catchup" @{ waitMs = 6000 } | Out-Null
		$msgs = Api $FedB GET "/groups/$groupId/channels/$channelId/messages?limit=50"
		if ($msgs.status -ne 200) { return $false }
		$texts = @($msgs.json.messages | ForEach-Object { $_.content.content })
		Write-Host "  NodeB sees $($texts.Count) msgs: $($texts -join ' | ')" -ForegroundColor DarkGray
		$texts -match 'A1:'
	}
	catch { $false }
})
Write-Host ("NodeB received A1: " + $(if ($gotA1) { 'YES' } else { 'NO' })) -ForegroundColor $(if ($gotA1) { 'Green' } else { 'Red' })

Write-Host "`n=== 8. NodeB: send message #B1 ===" -ForegroundColor Cyan
$b1 = Api $FedB POST "/groups/$groupId/channels/$channelId/messages" @{ content = @{ type = 'text'; content = 'B1: reply from NodeB' } }
if ($b1.status -ne 201) { throw "B1 send failed: $($b1.status) $($b1.raw)" }

Write-Host "`n=== 9. NodeA: live push (no catchup during poll) ===" -ForegroundColor Cyan
$gotB1Live = [bool](PollUntil 90 3 {
	try {
		$msgs = Api $FedA GET "/groups/$groupId/channels/$channelId/messages?limit=50"
		if ($msgs.status -ne 200) { return $false }
		$texts = @($msgs.json.messages | ForEach-Object { $_.content.content })
		Write-Host "  NodeA live sees $($texts.Count) msgs: $($texts -join ' | ')" -ForegroundColor DarkGray
		$texts -match 'B1:'
	}
	catch { $false }
})
Write-Host ("NodeA received B1 via live push: " + $(if ($gotB1Live) { 'YES' } else { 'NO' })) -ForegroundColor $(if ($gotB1Live) { 'Green' } else { 'Yellow' })

$gotB1 = $gotB1Live
if (-not $gotB1) {
	Write-Host "`n=== 10. NodeA: catchup recovery (explicit catchup allowed) ===" -ForegroundColor Cyan
	$gotB1 = [bool](PollUntil 120 3 {
		try {
			Api $FedA POST "/groups/$groupId/federation/catchup" @{ waitMs = 12000 } | Out-Null
			Api $FedA POST "/groups/$groupId/dag/merge-tips" @{} | Out-Null
			$msgs = Api $FedA GET "/groups/$groupId/channels/$channelId/messages?limit=50"
			if ($msgs.status -ne 200) { return $false }
			@($msgs.json.messages | ForEach-Object { $_.content.content }) -match 'B1:'
		}
		catch { $false }
	})
	Write-Host ("NodeA received B1 via catchup recovery: " + $(if ($gotB1) { 'YES' } else { 'NO' })) -ForegroundColor $(if ($gotB1) { 'Green' } else { 'Red' })
}

Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
Write-Host "groupId=$groupId" -ForegroundColor Cyan
Write-Host ("catchup(A1->B): " + $(if ($gotA1) { 'PASS' } else { 'FAIL' }))
Write-Host ("live(B1->A):    " + $(if ($gotB1Live) { 'PASS' } else { 'WARN (catchup may recover)' }))
Write-Host ("B1 on A (any):  " + $(if ($gotB1) { 'PASS' } else { 'FAIL' }))

if (-not $gotA1) { $script:fail++ }
if (-not $gotB1) { $script:fail++ }
Clear-FedGroup $groupId
Complete-LiveScript
