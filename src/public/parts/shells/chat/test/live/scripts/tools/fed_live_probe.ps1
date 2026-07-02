# Isolate: given an ESTABLISHED live peer connection, do all event types propagate?
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$g = (Api $FedA POST '/groups/' @{ name = 'LiveProbe' }).json
$gid = $g.groupId; $cid = $g.defaultChannelId
Api $FedA PUT "/groups/$gid/settings" @{ joinPolicy = 'open' } | Out-Null
$inv = (Api $FedA POST "/groups/$gid/invite-ticket" @{ ttlMs = 3600000 }).json
Api $FedB POST "/groups/$gid/join" @{ roomSecret = $inv.roomSecret; signalingAppId = $inv.signalingAppId; introducerPubKeyHash = $inv.introducerPubKeyHash } | Out-Null
Write-Host "group=$gid joined; firing events in warm window (fed_test-style timing)..." -ForegroundColor Cyan
# Mimic fed_test timing: wait a short settle for the join-time connection, then fire ALL event types.
Start-Sleep 8
Write-Host "`n--- firing events (warm) ---" -ForegroundColor Cyan
$m1 = (Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'live-M1' } }).json.event.id
$c1 = (Api $FedA POST "/groups/$gid/channels" @{ name = 'live-chan'; type = 'text' }).json.channelId
Api $FedA POST "/groups/$gid/channels/$cid/reactions" @{ targetEventId = $m1; emoji = "$([char]0xD83D)$([char]0xDC4D)" } | Out-Null
$m2 = (Api $FedB POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'live-M2' } }).json.event.id

$r1 = PollUntil 40 3 { @((Api $FedB GET "/groups/$gid/channels/$cid/messages").json.messages | Where-Object { $_.eventId -eq $m1 }).Count -ge 1 }
Write-Host ("B sees A-msg M1 (live push): {0}" -f [bool]$r1)
$r2 = PollUntil 40 3 { $s = Api $FedB GET "/groups/$gid/state"; $null -ne $s.json.state.channels.$c1 }
Write-Host ("B sees A-channel C1 (live push): {0}" -f [bool]$r2)
$r3 = PollUntil 40 3 { Test-FedHasReaction $FedB $gid $cid $m1 }
Write-Host ("B sees A-reaction (live push): {0}" -f [bool]$r3)
$r4 = PollUntil 40 3 { @((Api $FedA GET "/groups/$gid/channels/$cid/messages").json.messages | Where-Object { $_.eventId -eq $m2 }).Count -ge 1 }
Write-Host ("A sees B-msg M2 (live push): {0}" -f [bool]$r4)

Write-Host "`n--- peers snapshot ---" -ForegroundColor Cyan
$pa = (Api $FedA GET "/groups/$gid/peers").json; $pb = (Api $FedB GET "/groups/$gid/peers").json
Write-Host ("A: fed={0} peers={1} trusted={2}" -f $pa.federationEnabled, (@($pa.peers).Count), (@($pa.trustedPeers).Count))
Write-Host ("B: fed={0} peers={1} trusted={2}" -f $pb.federationEnabled, (@($pb.peers).Count), (@($pb.trustedPeers).Count))

Clear-FedGroup $gid
Write-Host "`ngroup=$gid M1=$([bool]$r1) C1=$([bool]$r2) React=$([bool]$r3) M2=$([bool]$r4)" -ForegroundColor Yellow
