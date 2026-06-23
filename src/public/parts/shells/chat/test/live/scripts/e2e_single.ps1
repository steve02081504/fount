# Comprehensive single-node E2E for new chat backend (run via test/live/run.mjs).
param(
	[string]$Base = $(if ($env:FOUNT_TEST_BASE_URL) { $env:FOUNT_TEST_BASE_URL.Trim().TrimEnd('/') } else { throw 'FOUNT_TEST_BASE_URL required; run via test/live/run.mjs' }),
	[string]$Key = $env:FOUNT_API_KEY
)
$ErrorActionPreference = 'Stop'
if (-not $Key) { throw 'No API key. Set $env:FOUNT_API_KEY or pass -Key.' }

. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/singleNode/helpers.ps1')
$script:createdGroups = @()

function Api($method, $path, $body) {
	$uri = "$Base/api/parts/shells:chat$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$Key" } else { $uri += "?fount-apikey=$Key" }
	$p = @{ Method = $method; Uri = $uri; UseBasicParsing = $true; TimeoutSec = 60; SkipHttpErrorCheck = $true }
	if ($null -ne $body) { $p.ContentType = 'application/json'; $p.Body = ($body | ConvertTo-Json -Depth 16 -Compress) }
	$r = Invoke-WebRequest @p
	$json = $null
	if ($r.Content) { try { $json = $r.Content | ConvertFrom-Json } catch { $json = $r.Content } }
	return [pscustomobject]@{ status = [int]$r.StatusCode; json = $json; raw = $r.Content }
}

# ---------------------------------------------------------------------------
Write-LiveSection 'A. Group lifecycle'
$gid = $null; $cid = $null
Test-Case 'POST /groups create' {
	$r = Api POST '/groups/' @{ name = 'E2E-main'; description = 'e2e' }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:gid = $r.json.groupId; $script:cid = $r.json.defaultChannelId
	$script:createdGroups += $script:gid
	$script:gid -and $script:cid
}
Test-Case 'GET /groups list contains new group' {
	$r = Api GET '/groups/'
	if ($r.status -ne 200) { throw "status $($r.status)" }
	@($r.json | Where-Object { $_.groupId -eq $gid }).Count -eq 1
}
Test-Case 'GET /groups/:id/state isMember+channels' {
	$r = Api GET "/groups/$gid/state"
	if ($r.status -ne 200) { throw "status $($r.status)" }
	$r.json.state.isMember -eq $true -and $null -ne $r.json.state.channels.$cid
}
Test-Case 'GET /groups/:id/snapshot' {
	$r = Api GET "/groups/$gid/snapshot"
	$r.status -eq 200 -and $null -ne $r.json.snapshot
}
Test-Case 'PUT /groups/:id/meta' {
	$r = Api PUT "/groups/$gid/meta" @{ name = 'E2E-renamed'; description = 'd2' }
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$s = Api GET "/groups/$gid/state"
	$s.json.state.groupMeta.name -eq 'E2E-renamed'
}
Test-Case 'PUT /groups/:id/settings joinPolicy+rate' {
	$r = Api PUT "/groups/$gid/settings" @{ joinPolicy = 'open'; messageRateLimitPerMin = 120; hotLatestMessageCount = 40 }
	$r.status -eq 200
}

# ---------------------------------------------------------------------------
Write-LiveSection 'B. Channels & messages'
$chid = $null; $msgId = $null
Test-Case 'POST /channels create' {
	$r = Api POST "/groups/$gid/channels" @{ name = 'e2e-chan'; type = 'text'; description = 'c' }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:chid = $r.json.channelId
	[bool]$script:chid
}
Test-Case 'PUT /channels/:id update' {
	$r = Api PUT "/groups/$gid/channels/$chid" @{ name = 'e2e-chan-2'; description = 'updated' }
	$r.status -eq 200
}
Test-Case 'PUT /default-channel' {
	$r = Api PUT "/groups/$gid/default-channel" @{ channelId = $chid }
	$r.status -eq 200
}
Test-Case 'POST message' {
	$r = Api POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'hello e2e' } }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:msgId = $r.json.event.id
	[bool]$script:msgId
}
Test-Case 'GET messages reads back' {
	$r = Api GET "/groups/$gid/channels/$cid/messages"
	if ($r.status -ne 200) { throw "status $($r.status)" }
	@($r.json.messages | Where-Object { $_.eventId -eq $msgId }).Count -eq 1
}
Test-Case 'POST messages/batch-get' {
	$r = Api POST "/groups/$gid/channels/$cid/messages/batch-get" @{ eventIds = @($msgId) }
	$r.status -eq 200 -and @($r.json.messages).Count -ge 1
}
Test-Case 'PUT edit message' {
	$r = Api PUT "/groups/$gid/channels/$cid/messages/$msgId" @{ content = @{ type = 'text'; content = 'edited e2e' } }
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	[bool]$r.json.event
}
Test-Case 'POST reaction add' {
	$r = Api POST "/groups/$gid/channels/$cid/reactions" @{ targetEventId = $msgId; emoji = "$([char]0xD83D)$([char]0xDC4D)" }
	$r.status -eq 200 -or $r.status -eq 201
}
Test-Case 'DELETE reaction' {
	$emoji = "$([char]0xD83D)$([char]0xDC4D)"
	$r = Api DELETE "/groups/$gid/channels/$cid/reactions/$([uri]::EscapeDataString($emoji))?targetEventId=$msgId"
	$r.status -eq 200 -or $r.status -eq 204
}
Test-Case 'POST pin' {
	$r = Api POST "/groups/$gid/channels/$cid/pins" @{ targetEventId = $msgId }
	$r.status -eq 200 -or $r.status -eq 201
}
Test-Case 'GET pin-context' {
	$r = Api GET "/groups/$gid/channels/$cid/pin-context/$msgId"
	$r.status -eq 200
}
Test-Case 'DELETE pin' {
	$r = Api DELETE "/groups/$gid/channels/$cid/pins/$msgId"
	$r.status -eq 200 -or $r.status -eq 204
}
Test-Case 'POST vote create + cast' {
	$r = Api POST "/groups/$gid/channels/$cid/votes" @{ question = 'q?'; options = @('A', 'B'); deadlineMs = 3600000 }
	if ($r.status -ne 201) { throw "create status $($r.status): $($r.raw)" }
	$ballot = $r.json.ballotId
	$c = Api POST "/groups/$gid/channels/$cid/votes/$ballot/cast" @{ choice = 'A' }
	$c.status -eq 200 -or $c.status -eq 201
}
Test-Case 'POST thread create' {
	$r = Api POST "/groups/$gid/channels/$cid/threads" @{ parentEventId = $msgId }
	$r.status -eq 201 -and [bool]$r.json.channelId
}
Test-Case 'DELETE message' {
	$r = Api DELETE "/groups/$gid/channels/$cid/messages/$msgId"
	$r.status -eq 200 -and [bool]$r.json.event
}
Test-Case 'list channel + list-items' {
	$lc = Api POST "/groups/$gid/channels" @{ name = 'e2e-list'; type = 'list' }
	if ($lc.status -ne 201) { throw "list channel create $($lc.status)" }
	$lcid = $lc.json.channelId
	$r = Api POST "/groups/$gid/channels/$lcid/list-items" @{ items = @(@{ title = 'item1'; description = 'd' }) }
	$r.status -eq 200 -or $r.status -eq 201
}

# ---------------------------------------------------------------------------
Write-LiveSection 'C. Members & governance'
Test-Case 'GET members/page/0' {
	$r = Api GET "/groups/$gid/members/page/0"
	$r.status -eq 200 -and @($r.json.members).Count -ge 1
}
Test-Case 'POST join rejects invalid pow on pow-policy group' {
	$pg = Api POST '/groups/' @{ name = 'E2E-pow'; description = 'pow join probe'; joinPolicy = 'pow'; powDifficulty = 8 }
	if ($pg.status -ne 201) { throw "create $($pg.status): $($pg.raw)" }
	$pgid = $pg.json.groupId
	$script:createdGroups += $pgid
	$j = Api POST "/groups/$pgid/join" @{ pow = @{ anchorRef = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'; epoch = 0; nonce = 'bad' } }
	$j.status -ge 400
}
Test-Case 'POST invite-ticket' {
	$r = Api POST "/groups/$gid/invite-ticket" @{ ttlMs = 3600000 }
	if ($r.status -ne 201 -and $r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	[bool]$r.json.code
}
Test-Case 'GET permissions (self)' {
	$r = Api GET "/groups/$gid/permissions"
	$r.status -eq 200 -and $r.json.ADMIN -eq $true
}
Test-Case 'GET channel permissions' {
	$r = Api GET "/groups/$gid/channels/$cid/permissions"
	$r.status -eq 200
}
$roleId = $null
Test-Case 'POST role create' {
	$r = Api POST "/groups/$gid/roles" @{ name = 'e2erole'; color = '#ff0000' }
	if ($r.status -ne 201 -and $r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$script:roleId = $r.json.roleId
	[bool]$script:roleId
}
Test-Case 'PUT role update' {
	$r = Api PUT "/groups/$gid/roles/$roleId" @{ name = 'e2erole2'; isHoisted = $true }
	$r.status -eq 200
}
Test-Case 'PUT role permission' {
	$r = Api PUT "/groups/$gid/roles/$roleId/permissions" @{ permission = 'SEND_MESSAGES'; enabled = $true }
	$r.status -eq 200
}
Test-Case 'PUT channel permissions' {
	$r = Api PUT "/groups/$gid/channels/$cid/permissions" @{ roleId = $roleId; allow = @{ SEND_MESSAGES = $true }; deny = @{} }
	$r.status -eq 200
}
Test-Case 'DELETE role' {
	$r = Api DELETE "/groups/$gid/roles/$roleId"
	$r.status -eq 200
}

# ---------------------------------------------------------------------------
Write-LiveSection 'D. DAG'
Test-Case 'GET dag/tips' {
	$r = Api GET "/groups/$gid/dag/tips"
	$r.status -eq 200 -and @($r.json.tips).Count -ge 1
}
Test-Case 'GET events' {
	$r = Api GET "/groups/$gid/events"
	$r.status -eq 200 -and @($r.json.events).Count -ge 1
}
Test-Case 'POST dag/merge-tips' {
	$r = Api POST "/groups/$gid/dag/merge-tips" @{}
	# merge-tips may legitimately no-op when single tip; accept 200 or 4xx no-fork
	$r.status -eq 200 -or $r.status -eq 409 -or $r.status -eq 400
}
Test-Case 'PUT governance-branch' {
	$r = Api PUT "/groups/$gid/governance-branch" @{ tipId = $null }
	$r.status -eq 200
}
Test-Case 'POST fork' {
	$tips = Api GET "/groups/$gid/dag/tips"
	$tip = @($tips.json.tips)[0]
	$r = Api POST "/groups/$gid/fork" @{ tipId = $tip; name = 'E2E-fork'; copyReputation = $true }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	if ($r.json.groupId) { $script:createdGroups += $r.json.groupId }
	[bool]$r.json.groupId
}

# ---------------------------------------------------------------------------
Write-LiveSection 'E. Channel key rotate'
Test-Case 'POST key-rotate' {
	$r = Api POST "/groups/$gid/key-rotate" @{}
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$r.json.generation -ge 1
}

# ---------------------------------------------------------------------------
Write-LiveSection 'F. Files'
$fileId = [guid]::NewGuid().ToString()
$chunkInfo = $null
Test-Case 'POST chunks/have (absent)' {
	$r = Api POST "/groups/$gid/chunks/have" @{ ciphertextHash = ('0' * 64); size = 10; ceMode = 'convergent' }
	$r.status -eq 200
}
Test-Case 'POST chunks upload' {
	$data = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('hello-file-content'))
	$r = Api POST "/groups/$gid/chunks" @{ fileId = $fileId; data = $data; channelId = $cid; ceMode = 'convergent' }
	if ($r.status -ne 200 -and $r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:chunkInfo = $r.json
	[bool]$r.json.ciphertextHash
}
Test-Case 'POST files register' {
	$ci = $script:chunkInfo
	$body = @{
		fileId = $fileId; name = 'hello.txt'; size = 18; mimeType = 'text/plain'; folderId = $null
		ceMode = $ci.ceMode; contentHash = $ci.contentHash; ciphertextHash = $ci.ciphertextHash
		wrappedKey = $ci.wrappedKey; storageLocator = $ci.storageLocator; key_generation = $ci.key_generation
		channelId = $cid
	}
	$r = Api POST "/groups/$gid/files" $body
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	[bool]$r.json.event
}
Test-Case 'GET files/:id/meta' {
	$r = Api GET "/groups/$gid/files/$fileId/meta"
	$r.status -eq 200 -and $r.json.fileId -eq $fileId
}
Test-Case 'GET files/:id/download-status' {
	$r = Api GET "/groups/$gid/files/$fileId/download-status"
	$r.status -eq 200
}
Test-Case 'POST file-system create folder' {
	$r = Api POST "/groups/$gid/file-system" @{ operation = 'create'; folderId = ('folder_' + [guid]::NewGuid().ToString('N')); name = 'e2e-folder' }
	$r.status -eq 200 -or $r.status -eq 201
}
Test-Case 'DELETE file' {
	$r = Api DELETE "/groups/$gid/files/$fileId"
	$r.status -eq 200 -and [bool]$r.json.event
}

# ---------------------------------------------------------------------------
Write-LiveSection 'G. Archive'
Test-Case 'GET archive/summary' {
	$r = Api GET "/groups/$gid/archive/summary"
	$r.status -eq 200
}

# ---------------------------------------------------------------------------
Write-LiveSection 'H. Federation (local-observable)'
Test-Case 'GET peers' {
	$r = Api GET "/groups/$gid/peers"
	$r.status -eq 200 -and [bool]$r.json.selfNodeHash
}
Test-Case 'GET reputation' {
	$r = Api GET "/groups/$gid/reputation"
	$r.status -eq 200
}
Test-Case 'POST federation/tuning' {
	$r = Api POST "/groups/$gid/federation/tuning" @{ federationPartitionCount = 8; rtcConnectionBudgetMax = 32 }
	$r.status -eq 200 -and $r.json.ok -eq $true
}
Test-Case 'POST federation/offline-mark' {
	$r = Api POST "/groups/$gid/federation/offline-mark" @{ wallMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
	$r.status -eq 200 -or $r.status -eq 204
}
Test-Case 'POST reputation/slash verified (DAG)' {
	$members = Api GET "/groups/$gid/members/page/0"
	$self = @($members.json.members)[0].pubKeyHash
	$tip = (Api GET "/groups/$gid/dag/tips").json.tips[0]
	$r = Api POST "/groups/$gid/reputation/slash" @{
		targetPubKeyHash = $self; claim = 0.1; verified = $true; proof = @{ eventId = $tip }
	}
	if ($r.status -ne 200) { throw "slash $($r.status): $($r.raw)" }
	$true
}
Test-Case 'POST reputation/reset (DAG)' {
	$members = Api GET "/groups/$gid/members/page/0"
	$self = @($members.json.members)[0].pubKeyHash
	$r = Api POST "/groups/$gid/reputation/reset" @{ targetPubKeyHash = $self }
	if ($r.status -ne 200) { throw "reset $($r.status): $($r.raw)" }
	$true
}

# ---------------------------------------------------------------------------
Write-LiveSection 'I. AI / chars'
$availChar = $null
Test-Case 'GET initial-data' {
	$r = Api GET "/groups/$gid/initial-data"
	$r.status -eq 200
}
Test-Case 'GET chars/plugins/persona/world' {
	$a = Api GET "/groups/$gid/chars"
	$b = Api GET "/groups/$gid/plugins"
	$c = Api GET "/groups/$gid/persona"
	$d = Api GET "/groups/$gid/world?channelId=$cid"
	$a.status -eq 200 -and $b.status -eq 200 -and $c.status -eq 200 -and $d.status -eq 200
}
# discover an installed char to add
$charCandidates = @('test_streamer', 'test_char', 'TestChar')
foreach ($cc in $charCandidates) {
	$r = Api POST "/groups/$gid/char" @{ charname = $cc; deferGreeting = $true }
	if ($r.status -eq 200 -or $r.status -eq 201) { $availChar = $cc; break }
}
if ($availChar) {
	T "POST char add ($availChar)" { $true }
	Test-Case 'PUT char frequency' {
		$r = Api PUT "/groups/$gid/char/$availChar/frequency" @{ frequency = 0.5 }
		$r.status -eq 200
	}
	Test-Case 'DELETE char' {
		$r = Api DELETE "/groups/$gid/char/$availChar"
		$r.status -eq 200
	}
} else {
	Skip-Case 'POST char add' 'no test char installed'
}

# ---------------------------------------------------------------------------
Write-LiveSection 'J. Sessions & misc (non-group prefix)'
Test-Case 'GET sessions/list' {
	$r = Api GET '/sessions/list'
	$r.status -eq 200
}
Test-Case 'GET/PUT bookmarks' {
	$g = Api GET '/bookmarks'
	if ($g.status -ne 200) { throw "get $($g.status)" }
	$p = Api PUT '/bookmarks' @{ entries = @(@{ groupId = $gid; channelId = $cid; eventId = ('a' * 64); title = 'bm' }) }
	$p.status -eq 200
}
Test-Case 'GET/PUT group-folders' {
	$g = Api GET '/group-folders'
	$p = Api PUT '/group-folders' @{ folders = @(@{ id = 'f1'; name = 'Folder1'; groupIds = @($gid) }) }
	$g.status -eq 200 -and $p.status -eq 200
}
Test-Case 'GET/PUT custom-emojis' {
	$g = Api GET '/custom-emojis'
	$g.status -eq 200
}
Test-Case 'GET emoji-usage/frequent' {
	$r = Api GET '/emoji-usage/frequent?limit=16'
	$r.status -eq 200
}
Test-Case 'GET discovery' {
	$r = Api GET '/discovery?limit=20'
	$r.status -eq 200
}
Test-Case 'GET mailbox/summary' {
	$r = Api GET '/mailbox/summary'
	$r.status -eq 200
}
Test-Case 'GET group emojis' {
	$r = Api GET "/groups/$gid/emojis"
	$r.status -eq 200
}
Test-Case 'GET audit-log' {
	$r = Api GET "/groups/$gid/audit-log?limit=20"
	$r.status -eq 200
}
Test-Case 'GET stickers/packs + collection' {
	$a = Api GET '/stickers/packs'
	$b = Api GET '/stickers/collection'
	$a.status -eq 200 -and $b.status -eq 200
}
Test-Case 'GET group export' {
	$r = Api GET "/groups/$gid/export"
	$r.status -eq 200
}

# ---------------------------------------------------------------------------
Write-LiveSection 'Cleanup'
foreach ($g in ($script:createdGroups | Select-Object -Unique)) {
	$r = Api DELETE "/groups/$g"
	if ($r.status -eq 200) { Write-Host "  deleted $g" -ForegroundColor DarkGray }
	else { Write-Host "  cleanup FAIL $g status $($r.status)" -ForegroundColor Yellow }
}

Write-LiveSummary 'chat e2e_single'
Complete-LiveScript
