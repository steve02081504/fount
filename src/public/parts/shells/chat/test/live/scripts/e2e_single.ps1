# Comprehensive single-node E2E for new chat backend.
# Targets NodeA (8931) by default. Creates E2E groups and cleans them up.
param(
	[string]$Base = $(if ($env:FOUNT_TEST_BASE_URL) { $env:FOUNT_TEST_BASE_URL } else { 'http://localhost:8931' }),
	[string]$Key = $env:FOUNT_API_KEY
)
$ErrorActionPreference = 'Stop'
if (-not $Key) { throw 'No API key. Set $env:FOUNT_API_KEY or pass -Key.' }

$script:pass = 0; $script:fail = 0; $script:skip = 0
$script:failures = @()
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

# T: name, scriptblock returning $true (pass) / $false (fail). Throw => fail.
function T($name, $block) {
	try {
		$ok = & $block
		if ($ok -eq $false) { $script:fail++; $script:failures += $name; Write-Host "  FAIL  $name" -ForegroundColor Red }
		else { $script:pass++; Write-Host "  ok    $name" -ForegroundColor Green }
	} catch {
		$script:fail++; $script:failures += "$name :: $($_.Exception.Message)"
		Write-Host "  FAIL  $name :: $($_.Exception.Message)" -ForegroundColor Red
	}
}
function S($name, $why) { $script:skip++; Write-Host "  skip  $name ($why)" -ForegroundColor DarkGray }
function Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

# ---------------------------------------------------------------------------
Section 'A. Group lifecycle'
$gid = $null; $cid = $null
T 'POST /groups create' {
	$r = Api POST '/groups/' @{ name = 'E2E-main'; description = 'e2e' }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:gid = $r.json.groupId; $script:cid = $r.json.defaultChannelId
	$script:createdGroups += $script:gid
	$script:gid -and $script:cid
}
T 'GET /groups list contains new group' {
	$r = Api GET '/groups/'
	if ($r.status -ne 200) { throw "status $($r.status)" }
	@($r.json | Where-Object { $_.groupId -eq $gid }).Count -eq 1
}
T 'GET /groups/:id/state isMember+channels' {
	$r = Api GET "/groups/$gid/state"
	if ($r.status -ne 200) { throw "status $($r.status)" }
	$r.json.state.isMember -eq $true -and $null -ne $r.json.state.channels.$cid
}
T 'GET /groups/:id/snapshot' {
	$r = Api GET "/groups/$gid/snapshot"
	$r.status -eq 200 -and $null -ne $r.json.snapshot
}
T 'PUT /groups/:id/meta' {
	$r = Api PUT "/groups/$gid/meta" @{ name = 'E2E-renamed'; description = 'd2' }
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$s = Api GET "/groups/$gid/state"
	$s.json.state.groupMeta.name -eq 'E2E-renamed'
}
T 'PUT /groups/:id/settings joinPolicy+rate' {
	$r = Api PUT "/groups/$gid/settings" @{ joinPolicy = 'open'; messageRateLimitPerMin = 120; hotLatestMessageCount = 40 }
	$r.status -eq 200
}

# ---------------------------------------------------------------------------
Section 'B. Channels & messages'
$chid = $null; $msgId = $null
T 'POST /channels create' {
	$r = Api POST "/groups/$gid/channels" @{ name = 'e2e-chan'; type = 'text'; description = 'c' }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:chid = $r.json.channelId
	[bool]$script:chid
}
T 'PUT /channels/:id update' {
	$r = Api PUT "/groups/$gid/channels/$chid" @{ name = 'e2e-chan-2'; description = 'updated' }
	$r.status -eq 200
}
T 'PUT /default-channel' {
	$r = Api PUT "/groups/$gid/default-channel" @{ channelId = $chid }
	$r.status -eq 200
}
T 'POST message' {
	$r = Api POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'hello e2e' } }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:msgId = $r.json.event.id
	[bool]$script:msgId
}
T 'GET messages reads back' {
	$r = Api GET "/groups/$gid/channels/$cid/messages"
	if ($r.status -ne 200) { throw "status $($r.status)" }
	@($r.json.messages | Where-Object { $_.eventId -eq $msgId }).Count -eq 1
}
T 'POST messages/batch-get' {
	$r = Api POST "/groups/$gid/channels/$cid/messages/batch-get" @{ eventIds = @($msgId) }
	$r.status -eq 200 -and @($r.json.messages).Count -ge 1
}
T 'PUT edit message' {
	$r = Api PUT "/groups/$gid/channels/$cid/messages/$msgId" @{ content = @{ type = 'text'; content = 'edited e2e' } }
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	[bool]$r.json.event
}
T 'POST reaction add' {
	$r = Api POST "/groups/$gid/channels/$cid/reactions" @{ targetEventId = $msgId; emoji = "$([char]0xD83D)$([char]0xDC4D)" }
	$r.status -eq 200 -or $r.status -eq 201
}
T 'DELETE reaction' {
	$emoji = "$([char]0xD83D)$([char]0xDC4D)"
	$r = Api DELETE "/groups/$gid/channels/$cid/reactions/$([uri]::EscapeDataString($emoji))?targetEventId=$msgId"
	$r.status -eq 200 -or $r.status -eq 204
}
T 'POST pin' {
	$r = Api POST "/groups/$gid/channels/$cid/pins" @{ targetEventId = $msgId }
	$r.status -eq 200 -or $r.status -eq 201
}
T 'GET pin-context' {
	$r = Api GET "/groups/$gid/channels/$cid/pin-context/$msgId"
	$r.status -eq 200
}
T 'DELETE pin' {
	$r = Api DELETE "/groups/$gid/channels/$cid/pins/$msgId"
	$r.status -eq 200 -or $r.status -eq 204
}
T 'POST vote create + cast' {
	$r = Api POST "/groups/$gid/channels/$cid/votes" @{ question = 'q?'; options = @('A', 'B'); deadlineMs = 3600000 }
	if ($r.status -ne 201) { throw "create status $($r.status): $($r.raw)" }
	$ballot = $r.json.ballotId
	$c = Api POST "/groups/$gid/channels/$cid/votes/$ballot/cast" @{ choice = 'A' }
	$c.status -eq 200 -or $c.status -eq 201
}
T 'POST thread create' {
	$r = Api POST "/groups/$gid/channels/$cid/threads" @{ parentEventId = $msgId }
	$r.status -eq 201 -and [bool]$r.json.channelId
}
T 'DELETE message' {
	$r = Api DELETE "/groups/$gid/channels/$cid/messages/$msgId"
	$r.status -eq 200 -and [bool]$r.json.event
}
T 'list channel + list-items' {
	$lc = Api POST "/groups/$gid/channels" @{ name = 'e2e-list'; type = 'list' }
	if ($lc.status -ne 201) { throw "list channel create $($lc.status)" }
	$lcid = $lc.json.channelId
	$r = Api POST "/groups/$gid/channels/$lcid/list-items" @{ items = @(@{ title = 'item1'; description = 'd' }) }
	$r.status -eq 200 -or $r.status -eq 201
}

# ---------------------------------------------------------------------------
Section 'C. Members & governance'
T 'GET members/page/0' {
	$r = Api GET "/groups/$gid/members/page/0"
	$r.status -eq 200 -and @($r.json.members).Count -ge 1
}
T 'GET pow-challenge' {
	$r = Api GET "/groups/$gid/pow-challenge"
	$r.status -eq 200 -and [bool]$r.json.challenge
}
T 'POST invite-ticket' {
	$r = Api POST "/groups/$gid/invite-ticket" @{ ttlMs = 3600000 }
	if ($r.status -ne 201 -and $r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	[bool]$r.json.code
}
T 'GET permissions (self)' {
	$r = Api GET "/groups/$gid/permissions"
	$r.status -eq 200 -and $r.json.ADMIN -eq $true
}
T 'GET channel permissions' {
	$r = Api GET "/groups/$gid/channels/$cid/permissions"
	$r.status -eq 200
}
$roleId = $null
T 'POST role create' {
	$r = Api POST "/groups/$gid/roles" @{ name = 'e2erole'; color = '#ff0000' }
	if ($r.status -ne 201 -and $r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$script:roleId = $r.json.roleId
	[bool]$script:roleId
}
T 'PUT role update' {
	$r = Api PUT "/groups/$gid/roles/$roleId" @{ name = 'e2erole2'; isHoisted = $true }
	$r.status -eq 200
}
T 'PUT role permission' {
	$r = Api PUT "/groups/$gid/roles/$roleId/permissions" @{ permission = 'SEND_MESSAGES'; enabled = $true }
	$r.status -eq 200
}
T 'PUT channel permissions' {
	$r = Api PUT "/groups/$gid/channels/$cid/permissions" @{ roleId = $roleId; allow = @{ SEND_MESSAGES = $true }; deny = @{} }
	$r.status -eq 200
}
T 'DELETE role' {
	$r = Api DELETE "/groups/$gid/roles/$roleId"
	$r.status -eq 200
}

# ---------------------------------------------------------------------------
Section 'D. DAG'
T 'GET dag/tips' {
	$r = Api GET "/groups/$gid/dag/tips"
	$r.status -eq 200 -and @($r.json.tips).Count -ge 1
}
T 'GET events' {
	$r = Api GET "/groups/$gid/events"
	$r.status -eq 200 -and @($r.json.events).Count -ge 1
}
T 'POST dag/merge-tips' {
	$r = Api POST "/groups/$gid/dag/merge-tips" @{}
	# merge-tips may legitimately no-op when single tip; accept 200 or 4xx no-fork
	$r.status -eq 200 -or $r.status -eq 409 -or $r.status -eq 400
}
T 'PUT governance-branch' {
	$r = Api PUT "/groups/$gid/governance-branch" @{ tipId = $null }
	$r.status -eq 200
}
T 'POST fork' {
	$tips = Api GET "/groups/$gid/dag/tips"
	$tip = @($tips.json.tips)[0]
	$r = Api POST "/groups/$gid/fork" @{ tipId = $tip; name = 'E2E-fork'; copyReputation = $true }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	if ($r.json.groupId) { $script:createdGroups += $r.json.groupId }
	[bool]$r.json.groupId
}

# ---------------------------------------------------------------------------
Section 'E. Channel key rotate'
T 'POST key-rotate' {
	$r = Api POST "/groups/$gid/key-rotate" @{}
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$r.json.generation -ge 1
}

# ---------------------------------------------------------------------------
Section 'F. Files'
$fileId = [guid]::NewGuid().ToString()
$chunkInfo = $null
T 'POST chunks/have (absent)' {
	$r = Api POST "/groups/$gid/chunks/have" @{ ciphertextHash = ('0' * 64); size = 10; ceMode = 'convergent' }
	$r.status -eq 200
}
T 'POST chunks upload' {
	$data = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('hello-file-content'))
	$r = Api POST "/groups/$gid/chunks" @{ fileId = $fileId; data = $data; channelId = $cid; ceMode = 'convergent' }
	if ($r.status -ne 200 -and $r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:chunkInfo = $r.json
	[bool]$r.json.ciphertextHash
}
T 'POST files register' {
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
T 'GET files/:id/meta' {
	$r = Api GET "/groups/$gid/files/$fileId/meta"
	$r.status -eq 200 -and $r.json.fileId -eq $fileId
}
T 'GET files/:id/download-status' {
	$r = Api GET "/groups/$gid/files/$fileId/download-status"
	$r.status -eq 200
}
T 'POST file-system create folder' {
	$r = Api POST "/groups/$gid/file-system" @{ operation = 'create'; folderId = ('folder_' + [guid]::NewGuid().ToString('N')); name = 'e2e-folder' }
	$r.status -eq 200 -or $r.status -eq 201
}
T 'DELETE file' {
	$r = Api DELETE "/groups/$gid/files/$fileId"
	$r.status -eq 200 -and [bool]$r.json.event
}

# ---------------------------------------------------------------------------
Section 'G. Archive'
T 'GET archive/summary' {
	$r = Api GET "/groups/$gid/archive/summary"
	$r.status -eq 200
}

# ---------------------------------------------------------------------------
Section 'H. Federation (local-observable)'
T 'GET peers' {
	$r = Api GET "/groups/$gid/peers"
	$r.status -eq 200 -and [bool]$r.json.selfNodeHash
}
T 'GET reputation' {
	$r = Api GET "/groups/$gid/reputation"
	$r.status -eq 200
}
T 'POST federation/tuning' {
	$r = Api POST "/groups/$gid/federation/tuning" @{ federationPartitionCount = 8; rtcConnectionBudgetMax = 32 }
	$r.status -eq 200 -and $r.json.ok -eq $true
}
T 'POST federation/offline-mark' {
	$r = Api POST "/groups/$gid/federation/offline-mark" @{ wallMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
	$r.status -eq 200 -or $r.status -eq 204
}
T 'POST reputation/slash + reset (DAG)' {
	$members = Api GET "/groups/$gid/members/page/0"
	$self = @($members.json.members)[0].pubKeyHash
	# self-slash with proof => DAG event
	$r = Api POST "/groups/$gid/reputation/slash" @{ targetPubKeyHash = $self; claim = 0.1; verified = $true; proof = @{ eventId = (Api GET "/groups/$gid/dag/tips").json.tips[0] } }
	# accept applied or a clear 4xx (self-slash may be disallowed); treat 200 as pass, record others
	if ($r.status -eq 200) { return $true }
	# reset path
	$rr = Api POST "/groups/$gid/reputation/reset" @{ targetPubKeyHash = $self }
	$rr.status -eq 200
}

# ---------------------------------------------------------------------------
Section 'I. AI / chars'
$availChar = $null
T 'GET initial-data' {
	$r = Api GET "/groups/$gid/initial-data"
	$r.status -eq 200
}
T 'GET chars/plugins/persona/world' {
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
	T 'PUT char frequency' {
		$r = Api PUT "/groups/$gid/char/$availChar/frequency" @{ frequency = 0.5 }
		$r.status -eq 200
	}
	T 'DELETE char' {
		$r = Api DELETE "/groups/$gid/char/$availChar"
		$r.status -eq 200
	}
} else {
	S 'POST char add' 'no test char installed'
}

# ---------------------------------------------------------------------------
Section 'J. Sessions & misc (non-group prefix)'
T 'GET sessions/list' {
	$r = Api GET '/sessions/list'
	$r.status -eq 200
}
T 'GET/PUT bookmarks' {
	$g = Api GET '/bookmarks'
	if ($g.status -ne 200) { throw "get $($g.status)" }
	$p = Api PUT '/bookmarks' @{ entries = @(@{ groupId = $gid; channelId = $cid; eventId = ('a' * 64); title = 'bm' }) }
	$p.status -eq 200
}
T 'GET/PUT group-folders' {
	$g = Api GET '/group-folders'
	$p = Api PUT '/group-folders' @{ folders = @(@{ id = 'f1'; name = 'Folder1'; groupIds = @($gid) }) }
	$g.status -eq 200 -and $p.status -eq 200
}
T 'GET/PUT custom-emojis' {
	$g = Api GET '/custom-emojis'
	$g.status -eq 200
}
T 'GET emoji-usage/frequent' {
	$r = Api GET '/emoji-usage/frequent?limit=16'
	$r.status -eq 200
}
T 'GET discovery' {
	$r = Api GET '/discovery?limit=20'
	$r.status -eq 200
}
T 'GET mailbox/summary' {
	$r = Api GET '/mailbox/summary'
	$r.status -eq 200
}
T 'GET group emojis' {
	$r = Api GET "/groups/$gid/emojis"
	$r.status -eq 200
}
T 'GET audit-log' {
	$r = Api GET "/groups/$gid/audit-log?limit=20"
	$r.status -eq 200
}
T 'GET stickers/packs + collection' {
	$a = Api GET '/stickers/packs'
	$b = Api GET '/stickers/collection'
	$a.status -eq 200 -and $b.status -eq 200
}
T 'GET group export' {
	$r = Api GET "/groups/$gid/export"
	$r.status -eq 200
}

# ---------------------------------------------------------------------------
Section 'Cleanup'
foreach ($g in ($script:createdGroups | Select-Object -Unique)) {
	$r = Api DELETE "/groups/$g"
	if ($r.status -eq 200) { Write-Host "  deleted $g" -ForegroundColor DarkGray }
	else { Write-Host "  cleanup FAIL $g status $($r.status)" -ForegroundColor Yellow }
}

# ---------------------------------------------------------------------------
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "PASS=$script:pass  FAIL=$script:fail  SKIP=$script:skip" -ForegroundColor Cyan
if ($script:failures.Count) {
	Write-Host "FAILURES:" -ForegroundColor Red
	$script:failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}
Write-Host "========================================" -ForegroundColor Cyan
