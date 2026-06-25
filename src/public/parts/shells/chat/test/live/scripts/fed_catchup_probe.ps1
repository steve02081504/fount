# Isolation: does explicit catch-up fill a POST-JOIN gap (event created after join settled)?
# Distinguishes "heartbeat didn't trigger" from "P2P connection is down so catch-up also fails".
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$g = (Api $FedA POST '/groups/' @{ name = 'CatchupProbe' }).json
$gid = $g.groupId; $cid = $g.defaultChannelId
Api $FedA PUT "/groups/$gid/settings" @{ joinPolicy = 'open' } | Out-Null
$inv = (Api $FedA POST "/groups/$gid/invite-ticket" @{ ttlMs = 3600000 }).json
Api $FedB POST "/groups/$gid/join" @{ mqttRoomSecret = $inv.mqttRoomSecret; mqttAppId = $inv.mqttAppId; introducerPubKeyHash = $inv.introducerPubKeyHash } | Out-Null
Write-Host "group=$gid joined; waiting 14s for join-time catch-up to settle..." -ForegroundColor Cyan
Start-Sleep 14

# Create a POST-JOIN gap: M1 created well after join catch-up already ran.
$m1 = (Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'catchup-M1' } }).json.event.id
Write-Host "A created post-join M1=$m1" -ForegroundColor Cyan

# Does B see it WITHOUT explicit catchup (i.e. via live push or auto heartbeat)? Watch 25s.
$auto = $false
for ($i = 0; $i -lt 9; $i++) {
	Start-Sleep 3
	if (@((Api $FedB GET "/groups/$gid/channels/$cid/messages").json.messages | Where-Object { $_.eventId -eq $m1 }).Count -ge 1) { $auto = $true; break }
}
Write-Host ("B sees M1 WITHOUT explicit catchup (live/heartbeat): {0}  (after ~{1}s)" -f $auto, ($i * 3)) -ForegroundColor $(if ($auto) { 'Green' } else { 'Yellow' })

# Now explicitly trigger catch-up on B a few times and poll.
$expl = $false
for ($k = 0; $k -lt 6; $k++) {
	$cu = Api $FedB POST "/groups/$gid/federation/catchup" @{}
	Write-Host ("  explicit catchup #$k -> status $($cu.status)") -ForegroundColor DarkGray
	Start-Sleep 4
	if (@((Api $FedB GET "/groups/$gid/channels/$cid/messages").json.messages | Where-Object { $_.eventId -eq $m1 }).Count -ge 1) { $expl = $true; break }
}
Write-Host ("B sees M1 AFTER explicit catchup: {0}" -f $expl) -ForegroundColor $(if ($expl) { 'Green' } else { 'Red' })

$pa = (Api $FedA GET "/groups/$gid/peers").json; $pb = (Api $FedB GET "/groups/$gid/peers").json
Write-Host ("peers  A: fed={0} peers={1}  B: fed={2} peers={3}" -f $pa.federationEnabled, (@($pa.peers).Count), $pb.federationEnabled, (@($pb.peers).Count)) -ForegroundColor Cyan
Clear-FedGroup $gid
Write-Host "RESULT auto=$auto explicit=$expl" -ForegroundColor Yellow
