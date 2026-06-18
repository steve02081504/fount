# Isolate: given an ESTABLISHED live peer connection, do all event types propagate?
$ErrorActionPreference = 'Stop'
$A = @{ base = 'http://localhost:8931'; key = $env:FOUNT_API_KEY }
$B = @{ base = 'http://localhost:8932'; key = 'nodeb-fed-test-key-20260614' }
function Api($node, $method, $path, $body) {
	$uri = "$($node.base)/api/parts/shells:chat$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$($node.key)" } else { $uri += "?fount-apikey=$($node.key)" }
	$p = @{ Method = $method; Uri = $uri; UseBasicParsing = $true; TimeoutSec = 60; SkipHttpErrorCheck = $true }
	if ($null -ne $body) { $p.ContentType = 'application/json'; $p.Body = ($body | ConvertTo-Json -Depth 16 -Compress) }
	$r = Invoke-WebRequest @p; $j = $null; if ($r.Content) { try { $j = $r.Content | ConvertFrom-Json } catch { $j = $r.Content } }
	[pscustomobject]@{ status = [int]$r.StatusCode; json = $j; raw = $r.Content }
}
function PollUntil($timeoutSec, $intervalSec, $probe) {
	$deadline = (Get-Date).AddSeconds($timeoutSec)
	do { $v = & $probe; if ($v) { return $v }; Start-Sleep $intervalSec } while ((Get-Date) -lt $deadline)
	return $v
}

$g = (Api $A POST '/groups/' @{ name = 'LiveProbe' }).json
$gid = $g.groupId; $cid = $g.defaultChannelId
Api $A PUT "/groups/$gid/settings" @{ joinPolicy = 'open' } | Out-Null
$inv = (Api $A POST "/groups/$gid/invite-ticket" @{ ttlMs = 3600000 }).json
Api $B POST "/groups/$gid/join" @{ mqttRoomSecret = $inv.mqttRoomSecret; mqttAppId = $inv.mqttAppId; introducerPubKeyHash = $inv.introducerPubKeyHash } | Out-Null
Write-Host "group=$gid joined; firing events in warm window (fed_test-style timing)..." -ForegroundColor Cyan
# Mimic fed_test timing: wait a short settle for the join-time connection, then fire ALL event types.
Start-Sleep 8
Write-Host "`n--- firing events (warm) ---" -ForegroundColor Cyan
$m1 = (Api $A POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'live-M1' } }).json.event.id
$c1 = (Api $A POST "/groups/$gid/channels" @{ name = 'live-chan'; type = 'text' }).json.channelId
Api $A POST "/groups/$gid/channels/$cid/reactions" @{ targetEventId = $m1; emoji = "$([char]0xD83D)$([char]0xDC4D)" } | Out-Null
$m2 = (Api $B POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'live-M2' } }).json.event.id

$r1 = PollUntil 40 3 { @((Api $B GET "/groups/$gid/channels/$cid/messages").json.messages | Where-Object { $_.eventId -eq $m1 }).Count -ge 1 }
Write-Host ("B sees A-msg M1 (live push): {0}" -f [bool]$r1)
$r2 = PollUntil 40 3 { $s = Api $B GET "/groups/$gid/state"; $null -ne $s.json.state.channels.$c1 }
Write-Host ("B sees A-channel C1 (live push): {0}" -f [bool]$r2)
$r3 = PollUntil 40 3 { @((Api $B GET "/groups/$gid/channels/$cid/messages").json.reactionEvents | Where-Object { $_.content.targetEventId -eq $m1 }).Count -ge 1 }
Write-Host ("B sees A-reaction (live push): {0}" -f [bool]$r3)
$r4 = PollUntil 40 3 { @((Api $A GET "/groups/$gid/channels/$cid/messages").json.messages | Where-Object { $_.eventId -eq $m2 }).Count -ge 1 }
Write-Host ("A sees B-msg M2 (live push): {0}" -f [bool]$r4)

Write-Host "`n--- peers snapshot ---" -ForegroundColor Cyan
$pa = (Api $A GET "/groups/$gid/peers").json; $pb = (Api $B GET "/groups/$gid/peers").json
Write-Host ("A: fed={0} peers={1} trusted={2}" -f $pa.federationEnabled, (@($pa.peers).Count), (@($pa.trustedPeers).Count))
Write-Host ("B: fed={0} peers={1} trusted={2}" -f $pb.federationEnabled, (@($pb.peers).Count), (@($pb.trustedPeers).Count))

Api $A DELETE "/groups/$gid" | Out-Null
Write-Host "`ngroup=$gid M1=$([bool]$r1) C1=$([bool]$r2) React=$([bool]$r3) M2=$([bool]$r4)" -ForegroundColor Yellow
