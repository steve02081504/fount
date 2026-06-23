# Two-node federation catchup + live message sync (run via test/live/run.mjs).
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

Write-Host "`n=== 3. NodeA: create invite-ticket (get mqtt creds) ===" -ForegroundColor Cyan
$inv = Api $FedA POST "/groups/$groupId/invite-ticket" @{ ttlMs = 3600000 }
if ($inv.status -ne 200 -and $inv.status -ne 201) { throw "invite-ticket failed: $($inv.status)" }
$mqttAppId = $inv.json.mqttAppId
$mqttRoomSecret = $inv.json.mqttRoomSecret
$introducer = $inv.json.introducerPubKeyHash
Write-Host "mqttAppId=$mqttAppId" -ForegroundColor Cyan
Write-Host "mqttRoomSecret=$($mqttRoomSecret.Substring(0,[Math]::Min(16,$mqttRoomSecret.Length)))..." -ForegroundColor Cyan
Write-Host "introducer=$introducer" -ForegroundColor Cyan

Write-Host "`n=== 4. NodeA: send message #A1 ===" -ForegroundColor Cyan
Api $FedA POST "/groups/$groupId/channels/$channelId/messages" @{ content = @{ type = 'text'; content = 'A1: hello from NodeA' } } | Out-Null

Write-Host "`n=== 5. NodeB: join group (no inviteCode, with mqtt creds) ===" -ForegroundColor Cyan
$joinBody = @{ mqttRoomSecret = $mqttRoomSecret; mqttAppId = $mqttAppId; introducerPubKeyHash = $introducer }
$jr = Api $FedB POST "/groups/$groupId/join" $joinBody
if ($jr.status -ne 200) { throw "join failed: $($jr.status) $($jr.raw)" }
Write-Host "join result: $($jr.json | ConvertTo-Json -Compress)" -ForegroundColor Cyan

Write-Host "`n=== 6. NodeB: poll group state for catchup (<=90s) ===" -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
	Start-Sleep 3
	try {
		$st = Api $FedB GET "/groups/$groupId/state"
		if ($st.status -ne 200) { continue }
		$memberCount = $st.json.state.memberCount
		$chans = ($st.json.state.channels.PSObject.Properties | Measure-Object).Count
		$nm = $st.json.state.groupMeta.name
		Write-Host "  [t=$($i*3)s] members=$memberCount channels=$chans name='$nm'" -ForegroundColor DarkGray
		if (-not $channelId -and $st.json.state.groupSettings.defaultChannelId) {
			$channelId = $st.json.state.groupSettings.defaultChannelId
		}
		if ($nm -and $chans -ge 1) { $ok = $true; break }
	}
	catch {
		Write-Host "  [t=$($i*3)s] state not ready: $($_.Exception.Message)" -ForegroundColor DarkGray
	}
}
if (-not $ok) { Write-Host "!! NodeB never materialized group state" -ForegroundColor Red }

Write-Host "`n=== 7. NodeB: read messages (expect A1 via catchup) ===" -ForegroundColor Cyan
$gotA1 = [bool](PollUntil 60 3 {
	try {
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
try { Api $FedB POST "/groups/$groupId/channels/$channelId/messages" @{ content = @{ type = 'text'; content = 'B1: reply from NodeB' } } | Out-Null } catch {}

Write-Host "`n=== 9. NodeA: read messages (expect B1 via live federation) ===" -ForegroundColor Cyan
$gotB1 = [bool](PollUntil 180 3 {
	try {
		Api $FedB POST "/groups/$groupId/federation/catchup" @{ waitMs = 6000 } | Out-Null
		Api $FedA POST "/groups/$groupId/federation/catchup" @{ waitMs = 6000 } | Out-Null
		Api $FedA POST "/groups/$groupId/dag/merge-tips" @{} | Out-Null
	}
	catch { }
	try {
		$msgs = Api $FedA GET "/groups/$groupId/channels/$channelId/messages?limit=50"
		if ($msgs.status -ne 200) { return $false }
		$texts = @($msgs.json.messages | ForEach-Object { $_.content.content })
		Write-Host "  NodeA sees $($texts.Count) msgs: $($texts -join ' | ')" -ForegroundColor DarkGray
		$texts -match 'B1:'
	}
	catch { $false }
})
if (-not $gotB1) {
	Write-Host "  retry: explicit catchup on A then re-poll..." -ForegroundColor DarkGray
	$gotB1 = [bool](PollUntil 90 3 {
		try {
			Api $FedA POST "/groups/$groupId/federation/catchup" @{ waitMs = 12000 } | Out-Null
			Api $FedA POST "/groups/$groupId/dag/merge-tips" @{} | Out-Null
			$msgs = Api $FedA GET "/groups/$groupId/channels/$channelId/messages?limit=50"
			if ($msgs.status -ne 200) { return $false }
			@($msgs.json.messages | ForEach-Object { $_.content.content }) -match 'B1:'
		}
		catch { $false }
	})
}
Write-Host ("NodeA received B1: " + $(if ($gotB1) { 'YES' } else { 'NO' })) -ForegroundColor $(if ($gotB1) { 'Green' } else { 'Red' })

Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
Write-Host "groupId=$groupId" -ForegroundColor Cyan
Write-Host ("catchup(A1->B): " + $(if ($gotA1) { 'PASS' } else { 'FAIL' }))
Write-Host ("live(B1->A):    " + $(if ($gotB1) { 'PASS' } else { 'FAIL' }))

if (-not $gotA1) { $script:fail++ }
if (-not $gotB1) { $script:fail++ }
Clear-FedGroup $groupId
Complete-LiveScript
