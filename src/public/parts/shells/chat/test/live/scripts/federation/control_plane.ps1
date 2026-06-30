# Federation control plane, history-want, discovery, and remote event verify.
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$groupId = $null; $channelId = $null

Write-Host "=== Setup: open group + join ===" -ForegroundColor Cyan
$setup = Initialize-OpenGroupJoin 'FedControl' 'control-seed'
$groupId = $setup.groupId; $channelId = $setup.channelId

Write-Host "`n=== 1. Federation control plane ===" -ForegroundColor Cyan
Test-Case 'A POST federation/rebind (first call must ok)' {
	$response = Api $FedA POST "/groups/$groupId/federation/rebind" @{ channelId = $channelId }
	$response.status -eq 200 -and $response.json.ok -eq $true
}
Test-Case 'A POST federation/rebind (idempotent second call)' {
	$response = Api $FedA POST "/groups/$groupId/federation/rebind" @{ channelId = $channelId }
	$response.status -eq 200 -and ($response.json.ok -eq $true -or $response.json.skipped -eq $true)
}
Test-Case 'A POST federation/rotate-room-secret' {
	$response = Api $FedA POST "/groups/$groupId/federation/rotate-room-secret" @{}
	$response.status -eq 200 -and [bool]$response.json.mqttRoomSecret
}
Test-Case 'B POST federation/join-snapshot' {
	$response = Api $FedB POST "/groups/$groupId/federation/join-snapshot" @{}
	$response.status -eq 200
}
Test-Case 'B POST federation/catchup after rotate' {
	$response = Api $FedB POST "/groups/$groupId/federation/catchup" @{ waitMs = 5000 }
	$response.status -eq 200
}
Test-Case 'members still>=2 after rotate' {
	[bool](Wait-FedMembers $FedB $groupId)
}

Write-Host "`n=== 2. history-want ===" -ForegroundColor Cyan
$histMsg = $null
Test-Case 'A posts history-want target' {
	$response = Api $FedA POST "/groups/$groupId/channels/$channelId/messages" @{ content = @{ type = 'text'; content = 'history-want-target' } }
	if ($response.status -ne 201) { throw "send $($response.status)" }
	$script:histMsg = $response.json.event.id
	[bool]$script:histMsg
}
Test-Case 'B POST channels/:id/history-want' {
	$response = Api $FedB POST "/groups/$groupId/channels/$channelId/history-want" @{ limit = 50 }
	$response.status -eq 200 -and @($response.json.messages).Count -ge 1
}

Write-Host "`n=== 3. Discovery ===" -ForegroundColor Cyan
Test-Case 'A GET /discovery' {
	$response = Api $FedA GET '/discovery?limit=20'
	$response.status -eq 200
}
Test-Case 'A POST /discovery/refresh' {
	$response = Api $FedA POST '/discovery/refresh' @{}
	$response.status -eq 200
}
Test-Case 'B GET /discovery sees index' {
	$response = Api $FedB GET '/discovery?limit=20'
	$response.status -eq 200
}

Write-Host "`n=== 4. POST events remote verify (B ingests A-signed row) ===" -ForegroundColor Cyan
Test-Case 'B applies signed event from A via POST /events' {
	$events = Api $FedA GET "/groups/$groupId/events?limit=5"
	if ($events.status -ne 200) { throw "events $($events.status)" }
	$row = @($events.json.events | Where-Object { $_.signature -and $_.id })[0]
	if (-not $row) { throw 'no signed event on A' }
	$eventId = [string]$row.id
	$response = Api $FedB POST "/groups/$groupId/events" @{ events = @($row) }
	if ($response.status -ne 200) { throw "ingest $($response.status): $($response.raw)" }
	$onB = Api $FedB GET "/groups/$groupId/events?limit=20"
	if ($onB.status -ne 200) { throw "B events $($onB.status)" }
	@($onB.json.events | Where-Object { $_.id -eq $eventId }).Count -eq 1
}

Clear-FedGroup $groupId
Write-FedSummary 'FED-CONTROL' $groupId
Complete-LiveScript
