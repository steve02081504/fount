# Single-node E2E extension: endpoints not covered by e2e_single.ps1.
# Complements e2e_single.ps1; shares one primary group to reduce overhead.
param(
	[string]$Base = $(if ($env:FOUNT_TEST_BASE_URL) { $env:FOUNT_TEST_BASE_URL } else { throw 'FOUNT_TEST_BASE_URL required' }),
	[string]$Key = $env:FOUNT_API_KEY
)
$ErrorActionPreference = 'Stop'
if (-not $Key) { throw 'No API key. Set $env:FOUNT_API_KEY or pass -Key.' }

. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/singleNode/helpers.ps1')
Initialize-SingleNodeChatApi -Base $Base -Key $Key
$script:createdGroups = @()

# Minimal 1x1 PNG for multipart / dataUrl uploads
$script:pngBytes = [Convert]::FromBase64String(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
)
$script:pngDataUrl = 'data:image/png;base64,' + [Convert]::ToBase64String($script:pngBytes)

function Api($method, $path, $body) { Invoke-ChatApi $method $path $body -TimeoutSec 120 }

function ApiMultipart($method, $path, $fields, $fileField, $fileName, $fileBytes, $contentType = 'image/png') {
	$uri = "$Base/api/parts/shells:chat$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$Key" } else { $uri += "?fount-apikey=$Key" }
	$handler = [System.Net.Http.HttpClientHandler]::new()
	$client = [System.Net.Http.HttpClient]::new($handler)
	$client.Timeout = [TimeSpan]::FromSeconds(120)
	try {
		$form = [System.Net.Http.MultipartFormDataContent]::new()
		foreach ($kv in $fields.GetEnumerator()) {
			$sc = [System.Net.Http.StringContent]::new([string]$kv.Value)
			$form.Add($sc, $kv.Key)
		}
		$bc = [System.Net.Http.ByteArrayContent]::new($fileBytes)
		$bc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($contentType)
		$form.Add($bc, $fileField, $fileName)
		$req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($method), $uri)
		$req.Content = $form
		$resp = $client.SendAsync($req).GetAwaiter().GetResult()
		$raw = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
		$json = $null
		if ($raw) { try { $json = $raw | ConvertFrom-Json } catch { $json = $raw } }
		return [pscustomobject]@{ status = [int]$resp.StatusCode; json = $json; raw = $raw }
	}
	finally {
		$client.Dispose()
		$handler.Dispose()
	}
}

function PollUntil($predicate, $timeoutSec = 30, $intervalSec = 0.4) {
	$deadline = (Get-Date).AddSeconds($timeoutSec)
	while ((Get-Date) -lt $deadline) {
		if (& $predicate) { return $true }
		Start-Sleep -Seconds $intervalSec
	}
	return $false
}

function OkStatus($status, [int[]]$allowed = @(200, 201)) {
	$allowed -contains [int]$status
}

function EnsureTestChar($groupId) {
	foreach ($cc in @('test_streamer', 'test_char', 'TestChar')) {
		$r = Api POST "/groups/$groupId/char" @{ charname = $cc; deferGreeting = $true }
		if (OkStatus $r.status) { return $cc }
	}
	return $null
}

function TriggerCharReply($groupId, $channelId, $charname) {
	if (-not $charname) { return $false }
	$r = Api POST "/groups/$groupId/channels/$channelId/trigger-reply" @{ charname = $charname }
	OkStatus $r.status
}

function GetLatestCharMessageId($groupId, $channelId) {
	$r = Api GET "/groups/$groupId/channels/$channelId/messages"
	if ($r.status -ne 200) { return $null }
	$rows = @($r.json.messages | Where-Object { $_.charId })
	if (-not $rows.Count) { return $null }
	return $rows[-1].eventId
}

function WaitForCharMessageId($groupId, $channelId, $charname, $timeoutSec = 90) {
	$null = TriggerCharReply $groupId $channelId $charname
	$found = $null
	$ok = PollUntil {
		$script:found = GetLatestCharMessageId $groupId $channelId
		[bool]$script:found
	} $timeoutSec 0.5
	if ($ok) { return $script:found }
	return $null
}

# ---------------------------------------------------------------------------
Write-LiveSection 'Setup — shared E2E-ext group'
$gid = $null; $cid = $null; $fbMsgId = $null
Test-Case 'POST /groups create (ext)' {
	$r = Api POST '/groups/' @{ name = 'E2E-ext'; description = 'ext coverage' }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:gid = $r.json.groupId; $script:cid = $r.json.defaultChannelId
	$script:createdGroups += $script:gid
	[bool]($script:gid -and $script:cid)
}
Test-Case 'warm runtime (initial-data)' {
	$r = Api GET "/groups/$gid/initial-data"
	$r.status -eq 200
}

# ---------------------------------------------------------------------------
Write-LiveSection 'A. Channels & messages (gaps)'
$delChId = $null
$fbChar = EnsureTestChar $gid
$fbMsgId = $null
if ($fbChar) {
	$script:fbMsgId = WaitForCharMessageId $gid $cid $fbChar 90
}
if ($fbMsgId) {
	Test-Case 'PUT messages/:id/feedback up' {
		$r = Api PUT "/groups/$gid/channels/$cid/messages/$fbMsgId/feedback" @{ type = 'up'; content = 'helpful' }
		if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
		[bool]$r.json.event
	}
	Test-Case 'PUT messages/:id/feedback down' {
		$r = Api PUT "/groups/$gid/channels/$cid/messages/$fbMsgId/feedback" @{ type = 'down' }
		$r.status -eq 200 -and [bool]$r.json.event
	}
} else {
	Skip-Case 'PUT messages/:id/feedback up' 'no char message for feedback'
	Skip-Case 'PUT messages/:id/feedback down' 'no char message for feedback'
}
Test-Case 'POST message (user)' {
	$r = Api POST "/groups/$gid/channels/$cid/messages" @{ content = @{ type = 'text'; content = 'ext user msg' } }
	OkStatus $r.status
}
Test-Case 'POST /compact' {
	$r = Api POST "/groups/$gid/compact" @{}
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$null -ne $r.json.eventsPruned
}
Test-Case 'POST /events (local batch peer_invite)' {
	$st = Api GET "/groups/$gid/state"
	$selfHash = $st.json.state.viewerMemberPubKeyHash
	if (-not $selfHash) { throw 'viewerMemberPubKeyHash missing' }
	$fakePeer = ('b' * 64)
	$r = Api POST "/groups/$gid/events" @{
		events = @(@{
			type = 'peer_invite'
			timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
			content = @{ from = $selfHash; to = $fakePeer }
		})
	}
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	[int]$r.json.applied -ge 1
}
Test-Case 'GET /timeline baseline' {
	$r = Api GET "/groups/$gid/timeline"
	if ($r.status -ne 200) { throw "status $($r.status)" }
	$script:tlBefore = @{ current = [int]$r.json.current; total = [int]$r.json.total }
	$script:tlBefore.total -ge 1
}
if (-not $fbChar) { $script:fbChar = EnsureTestChar $gid }
if ($fbChar) {
	$null = WaitForCharMessageId $gid $cid $fbChar 90
}
Test-Case 'PUT /timeline delta +1' {
	$r = Api PUT "/groups/$gid/timeline" @{ delta = 1; channelId = $cid }
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$script:tlDeltaPlus = $r
	[bool]$r.json.entry
}
Test-Case 'GET /timeline after +1' {
	if ($script:tlDeltaPlus.json.entry) {
		$g = Api GET "/groups/$gid/timeline"
		if ($g.status -ne 200) { return $false }
		[int]$g.json.current -ne $script:tlBefore.current -or [int]$g.json.total -gt $script:tlBefore.total
	}
	else {
		$ok = PollUntil {
			$g = Api GET "/groups/$gid/timeline"
			$g.status -eq 200 -and (
				[int]$g.json.current -ne $script:tlBefore.current -or
				[int]$g.json.total -gt $script:tlBefore.total
			)
		} 45
		if (-not $ok) { throw 'timeline did not change after delta +1' }
		$script:tlAfterPlus = Api GET "/groups/$gid/timeline"
		$true
	}
}
Test-Case 'PUT /timeline delta -1' {
	$r = Api PUT "/groups/$gid/timeline" @{ delta = -1; channelId = $cid }
	$r.status -eq 200 -and [bool]$r.json.entry
}
Test-Case 'GET /timeline restored index' {
	$g = Api GET "/groups/$gid/timeline"
	$g.status -eq 200 -and [int]$g.json.current -eq $script:tlBefore.current
}
Test-Case 'POST channel (to delete)' {
	$r = Api POST "/groups/$gid/channels" @{ name = 'ext-del'; type = 'text'; description = 'tmp' }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:delChId = $r.json.channelId
	[bool]$script:delChId
}
Test-Case 'DELETE /channels/:id (non-default)' {
	$r = Api DELETE "/groups/$gid/channels/$delChId"
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$s = Api GET "/groups/$gid/state"
	$null -eq $s.json.state.channels.$delChId
}

# ---------------------------------------------------------------------------
Write-LiveSection 'C. Files — file-system / download-resume / archive delete'
$fsFolderA = 'folder_' + [guid]::NewGuid().ToString('N')
$fsFolderB = 'folder_' + [guid]::NewGuid().ToString('N')
$dlFileId = [guid]::NewGuid().ToString()
$dlChunk = $null
Test-Case 'POST file-system create folder A' {
	$r = Api POST "/groups/$gid/file-system" @{ operation = 'create'; folderId = $fsFolderA; name = 'ext-fs-a' }
	$r.status -eq 200 -or $r.status -eq 201
}
Test-Case 'POST file-system create folder B' {
	$r = Api POST "/groups/$gid/file-system" @{ operation = 'create'; folderId = $fsFolderB; name = 'ext-fs-b' }
	$r.status -eq 200 -or $r.status -eq 201
}
Test-Case 'POST file-system rename A' {
	$r = Api POST "/groups/$gid/file-system" @{ operation = 'rename'; folderId = $fsFolderA; name = 'ext-fs-a-renamed' }
	$r.status -eq 200 -or $r.status -eq 201
}
Test-Case 'POST file-system move B under A' {
	$r = Api POST "/groups/$gid/file-system" @{ operation = 'move'; folderId = $fsFolderB; parentFolderId = $fsFolderA }
	$r.status -eq 200 -or $r.status -eq 201
}
Test-Case 'POST file-system delete B' {
	$r = Api POST "/groups/$gid/file-system" @{ operation = 'delete'; folderId = $fsFolderB }
	$r.status -eq 200 -or $r.status -eq 201
}
Test-Case 'POST chunks + register file (download-resume)' {
	$data = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('ext-download-resume-payload'))
	$up = Api POST "/groups/$gid/chunks" @{ fileId = $dlFileId; data = $data; channelId = $cid; ceMode = 'convergent' }
	if ($up.status -ne 200 -and $up.status -ne 201) { throw "chunk $($up.status): $($up.raw)" }
	$script:dlChunk = $up.json
	$body = @{
		fileId = $dlFileId; name = 'resume.txt'; size = 27; mimeType = 'text/plain'; folderId = $null
		ceMode = $script:dlChunk.ceMode; contentHash = $script:dlChunk.contentHash
		ciphertextHash = $script:dlChunk.ciphertextHash; wrappedKey = $script:dlChunk.wrappedKey
		storageLocator = $script:dlChunk.storageLocator; key_generation = $script:dlChunk.key_generation
		channelId = $cid
	}
	$reg = Api POST "/groups/$gid/files" $body
	if ($reg.status -ne 201) { throw "register $($reg.status): $($reg.raw)" }
	[bool]$reg.json.event
}
Test-Case 'POST files/:id/download-resume local complete' {
	$r = Api POST "/groups/$gid/files/$dlFileId/download-resume" @{}
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$ok = PollUntil {
		$ds = Api GET "/groups/$gid/files/$dlFileId/download-status"
		$ds.status -eq 200 -and (
			$ds.json.status.status -eq 'done' -or
			($ds.json.status.total -gt 0 -and $ds.json.status.done -ge $ds.json.status.total)
		)
	} 30
	if (-not $ok) {
		$ds = Api GET "/groups/$gid/files/$dlFileId/download-status"
		throw "download not complete: $($ds.raw)"
	}
	$r.json.ok -eq $true
}
Test-Case 'GET files/:id/download-status after resume' {
	$r = Api GET "/groups/$gid/files/$dlFileId/download-status"
	$r.status -eq 200 -and (
		$r.json.status.status -eq 'done' -or
		($r.json.status.total -gt 0 -and $r.json.status.done -ge $r.json.status.total)
	)
}
Test-Case 'DELETE /archive?before= (local prune)' {
	$r = Api DELETE "/groups/$gid/archive?before=2099-01"
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$null -ne $r.json
}

# ---------------------------------------------------------------------------
Write-LiveSection 'D. Stickers — full write path'
$packId = $null; $stickerId = $null; $stickerFile = $null; $importStickerId = $null
Test-Case 'POST /stickers/packs create' {
	$r = Api POST '/stickers/packs' @{ name = 'E2E-ext-pack'; description = 'ext'; isPublic = $true }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:packId = $r.json.pack.packId
	if (-not $script:packId) { $script:packId = $r.json.pack.id }
	[bool]$script:packId
}
Test-Case 'GET /stickers/packs/:id' {
	$r = Api GET "/stickers/packs/$packId"
	$r.status -eq 200 -and $r.json.pack.packId -eq $packId
}
Test-Case 'PUT /stickers/packs/:id' {
	$r = Api PUT "/stickers/packs/$packId" @{ name = 'E2E-ext-pack-2'; description = 'updated' }
	$r.status -eq 200 -and $r.json.pack.name -eq 'E2E-ext-pack-2'
}
Test-Case 'POST /stickers/packs/:id/stickers upload' {
	$r = ApiMultipart POST "/stickers/packs/$packId/stickers" @{ name = 'e2e-sticker' } 'sticker' 'e2e.png' $script:pngBytes
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:stickerId = $r.json.sticker.id
	if (-not $script:stickerId) { $script:stickerId = $r.json.sticker.stickerId }
	$stickerUrl = [string]$r.json.sticker.url
	if ($stickerUrl -match '/file/([^/?]+)') { $script:stickerFile = $Matches[1] }
	else { $script:stickerFile = $r.json.sticker.file }
	[bool]$script:stickerId
}
Test-Case 'GET /stickers/packs/:id/file/:name' {
	if (-not $stickerFile) { throw 'sticker file name missing' }
	$r = Api GET "/stickers/packs/$packId/file/$stickerFile"
	$r.status -eq 200 -and $r.raw.Length -gt 0
}
Test-Case 'POST /stickers/install/:packId' {
	$r = Api POST "/stickers/install/$packId" @{}
	$r.status -eq 200
}
Test-Case 'GET /stickers/collection installed' {
	$r = Api GET '/stickers/collection'
	$r.status -eq 200 -and ($r.json.collection.installedPacks -contains $packId)
}
Test-Case 'POST /stickers/favorites/:stickerId' {
	$r = Api POST "/stickers/favorites/$stickerId" @{}
	$r.status -eq 200
}
Test-Case 'DELETE /stickers/favorites/:stickerId' {
	$r = Api DELETE "/stickers/favorites/$stickerId"
	$r.status -eq 200
}
Test-Case 'POST /stickers/import' {
	$r = Api POST '/stickers/import' @{ dataUrl = $script:pngDataUrl; name = 'imported-ext' }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:importStickerId = $r.json.sticker.id
	if (-not $script:importStickerId) { $script:importStickerId = $r.json.sticker.stickerId }
	[bool]$script:importStickerId
}
Test-Case 'POST /stickers/recent/:stickerId' {
	$sid = if ($importStickerId) { $importStickerId } else { $stickerId }
	$r = Api POST "/stickers/recent/$sid" @{}
	$r.status -eq 200
}
Test-Case 'DELETE /stickers/packs/:id/stickers/:stickerId' {
	$r = Api DELETE "/stickers/packs/$packId/stickers/$stickerId"
	$r.status -eq 200
}
Test-Case 'POST /stickers/uninstall/:packId' {
	$r = Api POST "/stickers/uninstall/$packId" @{}
	$r.status -eq 200
}
Test-Case 'DELETE /stickers/packs/:id' {
	$r = Api DELETE "/stickers/packs/$packId"
	$r.status -eq 200
}

# ---------------------------------------------------------------------------
Write-LiveSection 'E. Group emojis — write'
$gEmojiId = $null
Test-Case 'POST /groups/:id/emojis' {
	$r = ApiMultipart POST "/groups/$gid/emojis" @{ name = 'ext-emoji' } 'emoji' 'emoji.png' $script:pngBytes
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:gEmojiId = $r.json.entry.emojiId
	[bool]$script:gEmojiId
}
Test-Case 'GET /groups/:id/emojis/:id/data (json)' {
	$r = Api GET "/groups/$gid/emojis/$gEmojiId/data?json=1"
	$r.status -eq 200 -and $r.json.dataUrl -like 'data:*'
}
Test-Case 'POST /custom-emojis/save (from group emoji)' {
	$r = Api POST '/custom-emojis/save' @{
		groupId = $gid; emojiId = $gEmojiId; dataUrl = $script:pngDataUrl
	}
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	[bool]$r.json.entry.id
}
Test-Case 'DELETE /groups/:id/emojis/:id' {
	$r = Api DELETE "/groups/$gid/emojis/$gEmojiId"
	$r.status -eq 200
}

# ---------------------------------------------------------------------------
Write-LiveSection 'F. Sessions & misc writes'
$init = Api GET "/groups/$gid/initial-data"
$personaName = $init.json.personaname
$worldName = $init.json.worldname
$importedGid = $null; $copyGid = $null
Test-Case 'GET /custom-emojis contains saved entry' {
	$r = Api GET '/custom-emojis'
	$r.status -eq 200 -and @($r.json.entries | Where-Object { $_.groupId -eq $gid }).Count -ge 1
}
Test-Case 'POST /groups/import' {
	$exp = Api GET "/groups/$gid/export"
	if ($exp.status -ne 200) { throw "export $($exp.status): $($exp.raw)" }
	if (-not $exp.json.messages -or @($exp.json.messages).Count -lt 1) {
		if ($fbChar) { $null = WaitForCharMessageId $gid $cid $fbChar 60 }
		$exp = Api GET "/groups/$gid/export"
	}
	if (-not $exp.json.messages -or @($exp.json.messages).Count -lt 1) { throw 'export has no chatLog messages' }
	$body = @{
		chars = @($exp.json.chars)
		world = $exp.json.world
		persona = $exp.json.persona
		plugins = @($exp.json.plugins)
		frequency = $exp.json.frequency
		messages = @($exp.json.messages)
	}
	$r = Api POST '/groups/import' $body
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$script:importedGid = $r.json.groupId
	if ($script:importedGid) { $script:createdGroups += $script:importedGid }
	[bool]$script:importedGid
}
Test-Case 'POST /groups/:id/copy' {
	$r = Api POST "/groups/$gid/copy" @{}
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$script:copyGid = $r.json.newGroupId
	if ($script:copyGid) { $script:createdGroups += $script:copyGid }
	[bool]$script:copyGid
}
Test-Case 'DELETE /sessions/:groupId' {
	if (-not $script:importedGid) { throw 'import group missing' }
	$r = Api DELETE "/sessions/$($script:importedGid)"
	$r.status -eq 200
}
# CI-user 仅安装 test_streamer fixture，initial-data 常无默认 world/persona；有值时才测 PUT 写路径。
if ($worldName) {
	Test-Case 'PUT /groups/:id/world' {
		$r = Api PUT "/groups/$gid/world" @{ worldname = $worldName; channelId = $cid }
		$r.status -eq 200
	}
} else {
	Skip-Case 'PUT /groups/:id/world' 'no default world on CI-user (initial-data.worldname null)'
}
if ($personaName) {
	Test-Case 'PUT /groups/:id/persona' {
		$r = Api PUT "/groups/$gid/persona" @{ personaname = $personaName }
		$r.status -eq 200
	}
} else {
	Skip-Case 'PUT /groups/:id/persona' 'no default persona on CI-user (initial-data.personaname null)'
}
$pluginName = $null
$script:pluginAddStatus = $null
foreach ($pn in @('timer', 'file-operations', 'fount-api')) {
	$pr = Api POST "/groups/$gid/plugin" @{ pluginname = $pn }
	if ($pr.status -eq 200) {
		$script:pluginName = $pn
		$script:pluginAddStatus = $pr.status
		break
	}
}
if ($pluginName) {
	Test-Case "POST /groups/:id/plugin ($pluginName)" { $script:pluginAddStatus -eq 200 }
	Test-Case 'DELETE /groups/:id/plugin/:name' {
		$r = Api DELETE "/groups/$gid/plugin/$pluginName"
		$r.status -eq 200
	}
} else {
	Skip-Case 'POST/DELETE plugin' 'no installable test plugin found'
}
Test-Case 'POST /groups/leave (copy group)' {
	if (-not $script:copyGid) { throw 'copy group missing' }
	$r = Api POST '/groups/leave' @{ groupIds = @($script:copyGid) }
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$lists = Api GET '/sessions/list'
	@($lists.json | Where-Object { $_.groupId -eq $script:copyGid }).Count -eq 0
}

# ---------------------------------------------------------------------------
Write-LiveSection 'G. Streaming'
$streamChId = $null
Test-Case 'POST streaming channel' {
	$r = Api POST "/groups/$gid/channels" @{ name = 'ext-stream'; type = 'streaming'; description = 'sfu/webrtc' }
	if ($r.status -ne 201) { throw "status $($r.status): $($r.raw)" }
	$script:streamChId = $r.json.channelId
	[bool]$script:streamChId
}
Test-Case 'POST /channels/:id/streaming-auth' {
	$r = Api POST "/groups/$gid/channels/$streamChId/streaming-auth" @{}
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$r.json.mode -in @('webrtc', 'sfu')
}
Test-Case 'GET /channels/:id/streaming-view' {
	$r = Api GET "/groups/$gid/channels/$streamChId/streaming-view"
	# Without streamingSfuWss configured, handler returns 404 — assert expected branch
	if ($r.status -eq 404) { return $r.raw -match 'SFU|not configured' }
	$r.status -eq 200 -and $r.raw -match 'streaming-embed-frame|DOCTYPE'
}

# ---------------------------------------------------------------------------
Write-LiveSection 'B. Governance — ban / unban / owner-succession / fork'
$agentChar = $fbChar
$agentKey = $null
if (-not $agentChar) { $agentChar = EnsureTestChar $gid }
if ($agentChar) {
	Test-Case "agent member via POST char ($agentChar)" {
		$s = Api GET "/groups/$gid/state"
		$row = @($s.json.state.members | Where-Object { $_.charname -eq $agentChar })[0]
		if (-not $row) { throw 'agent member row missing' }
		$script:agentKey = $row.memberKey
		[bool]$script:agentKey
	}
	Test-Case 'POST members/:key/ban (entity scope)' {
		$r = Api POST "/groups/$gid/members/$([uri]::EscapeDataString($agentKey))/ban" @{ banScope = 'entity' }
		if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
		$s = Api GET "/groups/$gid/state"
		@($s.json.state.members | Where-Object { $_.memberKey -eq $agentKey }).Count -eq 0
	}
	Test-Case 'ban blocks agent trigger-reply' {
		Invoke-WithAllowedNoise -Patterns 'char not found' -Script {
			$r = Api POST "/groups/$gid/channels/$cid/trigger-reply" @{ charname = $agentChar }
			$r.status -ne 200
		}
	}
	Test-Case 'POST members/:key/unban' {
		$r = Api POST "/groups/$gid/members/$([uri]::EscapeDataString($agentKey))/unban" @{}
		if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
		$ok = PollUntil {
			$s = Api GET "/groups/$gid/state"
			@($s.json.state.members | Where-Object { $_.memberKey -eq $agentKey }).Count -ge 1
		} 20
		if (-not $ok) { throw 'agent not visible after unban' }
		$true
	}
	Test-Case 'unban restores agent active' {
		$ok = PollUntil {
			$s = Api GET "/groups/$gid/state"
			@($s.json.state.members | Where-Object { $_.memberKey -eq $agentKey }).Count -ge 1
		} 20
		if (-not $ok) { throw 'agent member not visible after unban' }
		$true
	}
	Test-Case 'POST members/:key/kick removes agent member (owner may kick own agent)' {
		$r = Api POST "/groups/$gid/members/$([uri]::EscapeDataString($agentKey))/kick" @{}
		if ($r.status -ne 200) { throw "kick $($r.status): $($r.raw)" }
		$s = Api GET "/groups/$gid/state"
		@($s.json.state.members | Where-Object { $_.memberKey -eq $agentKey -and $_.status -eq 'active' }).Count -eq 0
	}
	# 非管理员踢人（403）由 chat/test/authorize_governance.test.mjs 覆盖；单用户 live 无法构造无 ADMIN 且非 owner 的踢人场景。
	# 在独立临时群上跑 owner-succession，避免把 MANAGE_ADMINS 从共享 ext 群转走影响后续用例。
	Test-Case 'POST owner-succession (single admin → agent)' {
		$og = Api POST '/groups/' @{ name = 'E2E-ext-os'; description = 'owner succession probe' }
		if ($og.status -ne 201) { throw "create $($og.status): $($og.raw)" }
		$ogid = $og.json.groupId
		$script:createdGroups += $ogid
		try {
			$ac = Api POST "/groups/$ogid/char" @{ charname = $agentChar; deferGreeting = $true }
			if (-not (OkStatus $ac.status)) { throw "char add $($ac.status)" }
			$s0 = Api GET "/groups/$ogid/state"
			$agentRow = @($s0.json.state.members | Where-Object { $_.charname -eq $agentChar })[0]
			if (-not $agentRow.pubKeyHash) { throw 'agent pubKeyHash missing' }
			$ballotId = "e2e-ext-os-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
			$r = Api POST "/groups/$ogid/owner-succession" @{
				proposedOwnerPubKeyHash = $agentRow.pubKeyHash
				ballotId                = $ballotId
			}
			if ($r.status -ne 200) { throw "succession $($r.status): $($r.raw)" }
			if ($r.json.newOwnerPubKeyHash -ne $agentRow.pubKeyHash) { throw 'newOwnerPubKeyHash mismatch' }
			$s1 = Api GET "/groups/$ogid/state"
			$s1.json.state.delegatedOwnerPubKeyHash -eq $agentRow.pubKeyHash
		}
		finally {
			Api POST '/groups/leave' @{ groupIds = @($ogid) } | Out-Null
		}
	}
} else {
	Skip-Case 'agent member + ban/unban' 'no test char installed'
}
# fork/block-opposing 在独立小群上跑 HTTP smoke，避免共享 ext 群 DAG 过大导致超时。
Test-Case 'POST fork/block-opposing with current tip (HTTP smoke)' {
	$fg = Api POST '/groups/' @{ name = 'E2E-ext-fork'; description = 'fork smoke probe' }
	if ($fg.status -ne 201) { throw "create $($fg.status): $($fg.raw)" }
	$fgid = $fg.json.groupId
	$script:createdGroups += $fgid
	try {
		$tips = Api GET "/groups/$fgid/dag/tips"
		if ($tips.status -ne 200) { throw "tips $($tips.status)" }
		$tip = @($tips.json.tips)[0]
		if (-not $tip) { throw 'no dag tip' }
		$r = Api POST "/groups/$fgid/fork/block-opposing" @{ acceptedTipId = $tip }
		$r.status -eq 200 -and $null -ne $r.json
	}
	finally {
		Api POST '/groups/leave' @{ groupIds = @($fgid) } | Out-Null
	}
}
# fork/block-opposing 对立分支治理逻辑由 chat/test/fork_block_opposing.test.mjs 覆盖。

# ---------------------------------------------------------------------------
# Quarantine future-HLC 处置（message 类未来 HLC → quarantine）由
# chat/test/hlc_policy.test.mjs 覆盖；HTTP 层无注入 future-HLC 签名事件的简便路径。

# ---------------------------------------------------------------------------
Write-LiveSection 'Cleanup'
foreach ($g in ($script:createdGroups | Select-Object -Unique)) {
	$r = Api DELETE "/groups/$g"
	# 403/404：已离开 / 导入副本非属主 / 已被前序用例删除 —— 均视作已清理，回退一次 leave 兜底。
	if ($r.status -eq 200) { Write-Host "  deleted $g" -ForegroundColor DarkGray }
	elseif ($r.status -in @(403, 404)) {
		Api POST '/groups/leave' @{ groupIds = @($g) } | Out-Null
		Write-Host "  released $g (status $($r.status))" -ForegroundColor DarkGray
	}
	else { Write-Host "  cleanup WARN $g status $($r.status)" -ForegroundColor Yellow }
}

Write-LiveSummary 'chat e2e_single_ext'
Complete-LiveScript
