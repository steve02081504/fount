# L4 federation: cold archive month on A, B syncs via offline-mark + archive/sync.
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$gid = $null; $cid = $null; $targetMonth = $null

Write-Host "=== Setup: open group + join ===" -ForegroundColor Cyan
$setup = Initialize-OpenGroupJoin 'FedArchive' 'archive-seed-0'
$gid = $setup.groupId; $cid = $setup.channelId
$targetMonth = (Get-Date).ToUniversalTime().ToString('yyyy-MM')
Write-Host "targetMonth=$targetMonth" -ForegroundColor DarkGray

Write-Host "`n=== 1. A: shrink hot window + seed messages ===" -ForegroundColor Cyan
Test-Case 'A set hotLatestMessageCount=1' {
	$r = Api $FedA PUT "/groups/$gid/settings" @{ hotLatestMessageCount = 1 }
	$r.status -eq 200
}
Test-Case 'A posts archive candidates' {
	for ($i = 1; $i -le 4; $i++) {
		$m = Api $FedA POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = "archive-msg-$i" } }
		if ($m.status -ne 201) { throw "msg $i status $($m.status)" }
	}
	$true
}

Write-Host "`n=== 2. A: compact → cold archive files ===" -ForegroundColor Cyan
Test-Case 'A POST compact triggers archive fold' {
	$r = Api $FedA POST "/groups/$gid/compact" @{}
	if ($r.status -ne 200) { throw "compact $($r.status)" }
	$true
}
Test-Case 'A archive/summary has month file' {
	$found = PollUntil 45 3 {
		$s = Api $FedA GET "/groups/$gid/archive/summary"
		if ($s.status -ne 200) { return $false }
		@($s.json.files | Where-Object { $_.month -eq $targetMonth -and $_.bytes -gt 0 }).Count -ge 1
	}
	[bool]$found
}

Write-Host "`n=== 3. B: offline-mark + archive/sync ===" -ForegroundColor Cyan
Test-Case 'B POST federation/offline-mark' {
	$r = Api $FedB POST "/groups/$gid/federation/offline-mark" @{ wallMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
	$r.status -eq 200 -or $r.status -eq 204
}
Test-Case 'B POST archive/sync' {
	$r = Api $FedB POST "/groups/$gid/archive/sync" @{}
	if ($r.status -ne 200) { throw "sync $($r.status): $($r.raw)" }
	$true
}
Test-Case 'B archive/summary has target month' {
	$found = PollUntil 90 4 {
		$s = Api $FedB GET "/groups/$gid/archive/summary"
		if ($s.status -ne 200) { return $false }
		@($s.json.files | Where-Object { $_.month -eq $targetMonth -and $_.bytes -gt 0 }).Count -ge 1
	}
	[bool]$found
}
Test-Case 'B can read archived message via GET messages' {
	$found = PollUntil 60 3 {
		$m = Api $FedB GET "/groups/$gid/channels/$cid/messages?limit=50"
		if ($m.status -ne 200) { return $false }
		@($m.json.messages | Where-Object { $_.content.content -match 'archive-msg-' }).Count -ge 1
	}
	[bool]$found
}

Clear-FedGroup $gid
Write-FedSummary 'FED-ARCHIVE-MONTH' $gid
Complete-LiveScript
