$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

function Get-Identity($node) {
	$r = P2pApi $node GET '/federation'
	if ($r.status -ne 200) { throw "federation GET $($r.status)" }
	$r.json.identityPubKeyHex.ToLower()
}

function Get-WhoamiUser($node) {
	$r = RootApi $node GET '/api/whoami'
	if ($r.status -ne 200) { throw "whoami $($r.status)" }
	$r.json.username
}

function Build-DmIntro($node) {
	$user = Get-WhoamiUser $node
	$dataPath = (Resolve-Path $node.dataPath).Path
	$helper = Join-Path (Join-Path $PSScriptRoot 'federation') 'dm_intro_helper.mjs'
	$out = & deno run -A $helper --data-path $dataPath --user $user 2>&1
	if ($LASTEXITCODE -ne 0) { throw "dm intro helper failed: $out" }
	$out | ConvertFrom-Json
}

$aPub = Get-Identity $FedA
$bPub = Get-Identity $FedB
if ($aPub -lt $bPub) {
	$creator = $FedA; $joiner = $FedB; $creatorPub = $aPub; $peerPub = $bPub
}
else {
	$creator = $FedB; $joiner = $FedA; $creatorPub = $bPub; $peerPub = $aPub
}

Write-Host "creator=$($creator.name) creatorPub=$creatorPub" -ForegroundColor Cyan
Write-Host "joiner=$($joiner.name) peerPub=$peerPub" -ForegroundColor Cyan

$intro = Build-DmIntro $creator
Write-Host "intro.pubKeyHex=$($intro.pubKeyHex)" -ForegroundColor DarkGray

$create = Api $creator POST '/groups/' @{
	template = 'dm'
	myPubKeyHex = $creatorPub
	peerPubKeyHex = $peerPub
}
if ($create.status -ne 201) { throw "create failed: $($create.status) $($create.raw)" }
$gid = $create.json.groupId
$cid = $create.json.defaultChannelId
Write-Host "gid=$gid cid=$cid" -ForegroundColor Green

$inv = Api $creator POST "/groups/$gid/invite-ticket" @{ ttlMs = 3600000 }
Write-Host "invite status=$($inv.status)" -ForegroundColor Cyan

$joinBody = @{
	mqttRoomSecret = $inv.json.mqttRoomSecret
	mqttAppId = $inv.json.mqttAppId
	introducerPubKeyHash = $intro.pubKeyHex
	dmIntroNonce = $intro.dmIntroNonce
	dmIntroSignatureHex = $intro.dmIntroSignatureHex
}
$join = Api $joiner POST "/groups/$gid/join" $joinBody
Write-Host "join status=$($join.status) body=$($join.raw)" -ForegroundColor Yellow

for ($i = 0; $i -lt 8; $i++) {
	Api $joiner POST "/groups/$gid/federation/catchup" @{ waitMs = 6000 } | Out-Null
	Api $joiner POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
	Api $creator POST "/groups/$gid/federation/catchup" @{ waitMs = 6000 } | Out-Null
	Api $creator POST "/groups/$gid/dag/merge-tips" @{} | Out-Null
}

$sA = Api $creator GET "/groups/$gid/state"
$sB = Api $joiner GET "/groups/$gid/state"
Write-Host "`n=== A state ===" -ForegroundColor Magenta
Write-Host "status=$($sA.status) isMember=$($sA.json.state.isMember) memberCount=$($sA.json.state.memberCount) defaultChannel=$($sA.json.state.groupSettings.defaultChannelId)"
foreach ($m in @($sA.json.state.members)) { Write-Host " A-member $($m.pubKeyHash) roles=$($m.roles -join ',') status=$($m.status)" }
Write-Host "`n=== B state ===" -ForegroundColor Magenta
Write-Host "status=$($sB.status) isMember=$($sB.json.state.isMember) memberCount=$($sB.json.state.memberCount) defaultChannel=$($sB.json.state.groupSettings.defaultChannelId)"
foreach ($m in @($sB.json.state.members)) { Write-Host " B-member $($m.pubKeyHash) roles=$($m.roles -join ',') status=$($m.status)" }

$evA = Api $creator GET "/groups/$gid/events?limit=200"
$evB = Api $joiner GET "/groups/$gid/events?limit=200"
Write-Host "`n=== A events ===" -ForegroundColor Magenta
foreach ($e in @($evA.json.events)) {
	$extra = ''
	if ($e.type -eq 'member_join') {
		$extra = " sender=$($e.sender) intro=$($e.content.introducerPubKeyHash) dmNonce=$([string]$e.content.dmIntroNonce)"
	}
	Write-Host " A-ev $($e.type) id=$($e.id.Substring(0,8))$extra"
}
Write-Host "`n=== B events ===" -ForegroundColor Magenta
foreach ($e in @($evB.json.events)) {
	$extra = ''
	if ($e.type -eq 'member_join') {
		$extra = " sender=$($e.sender) intro=$($e.content.introducerPubKeyHash) dmNonce=$([string]$e.content.dmIntroNonce)"
	}
	Write-Host " B-ev $($e.type) id=$($e.id.Substring(0,8))$extra"
}

Write-Host "`n(Probe finished without cleanup) gid=$gid" -ForegroundColor Green
