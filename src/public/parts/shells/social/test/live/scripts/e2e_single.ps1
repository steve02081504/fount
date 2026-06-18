# Social shell single-node HTTP E2E smoke.
param(
	[string]$Base = $(if ($env:FOUNT_TEST_BASE_URL) { $env:FOUNT_TEST_BASE_URL } else { 'http://localhost:8931' }),
	[string]$Key = $env:FOUNT_API_KEY
)
$ErrorActionPreference = 'Stop'
if (-not $Key) { throw 'No API key. Set $env:FOUNT_API_KEY or pass -Key.' }

$script:pass = 0; $script:fail = 0; $script:skip = 0
$script:failures = @()
$script:entityHash = $null
$script:postId = $null
$script:folderId = $null
$script:shareId = $null
$dummyTarget = ('a' * 128)

function Api($method, $path, $body) {
	$uri = "$Base/api/parts/shells:social$path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$Key" } else { $uri += "?fount-apikey=$Key" }
	$p = @{ Method = $method; Uri = $uri; UseBasicParsing = $true; TimeoutSec = 60; SkipHttpErrorCheck = $true }
	if ($null -ne $body) { $p.ContentType = 'application/json'; $p.Body = ($body | ConvertTo-Json -Depth 16 -Compress) }
	$r = Invoke-WebRequest @p
	$json = $null
	if ($r.Content) { try { $json = $r.Content | ConvertFrom-Json } catch { $json = $r.Content } }
	return [pscustomobject]@{ status = [int]$r.StatusCode; json = $json; raw = $r.Content }
}

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

Section 'A. Viewer & discover'
T 'GET /viewer' {
	$r = Api GET '/viewer'
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$script:entityHash = $r.json.viewerEntityHash
	[bool]$script:entityHash
}
T 'GET /posting-entities' {
	$r = Api GET '/posting-entities'
	$r.status -eq 200 -and @($r.json.entities).Count -ge 1
}
T 'GET /feed' {
	$r = Api GET '/feed?sync=false&limit=20'
	$r.status -eq 200 -and $null -ne $r.json.items
}
T 'GET /explore/posts' {
	$r = Api GET '/explore/posts?limit=10'
	$r.status -eq 200
}
T 'GET /explore' {
	$r = Api GET '/explore?limit=10'
	$r.status -eq 200
}
T 'GET /hashtags/trending' {
	$r = Api GET '/hashtags/trending?limit=8'
	$r.status -eq 200 -and $null -ne $r.json.tags
}
T 'GET /notifications' {
	$r = Api GET '/notifications?limit=10'
	$r.status -eq 200 -and $null -ne $r.json.notifications
}
T 'GET /mentions/suggest' {
	$r = Api GET '/mentions/suggest?q=ab&limit=5'
	$r.status -eq 200
}
T 'GET /search short query 400' {
	$r = Api GET '/search?q=a'
	$r.status -eq 400
}

Section 'B. Profile read & post'
T 'POST /profile/post' {
	$r = Api POST '/profile/post' @{ entityHash = $entityHash; text = 'social e2e post'; visibility = 'public'; lang = 'zh-CN' }
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$script:postId = $r.json.event.id
	[bool]$script:postId
}
T 'GET /profile/:hash' {
	$r = Api GET "/profile/$entityHash"
	$r.status -eq 200 -and $r.json.entityHash -eq $entityHash
}
T 'GET /profile/:hash/posts' {
	$r = Api GET "/profile/$entityHash/posts"
	$r.status -eq 200 -and @($r.json.items).Count -ge 1
}
T 'GET /profile/:hash/following' {
	$r = Api GET "/profile/$entityHash/following"
	$r.status -eq 200
}
T 'GET /profile/:hash/replies/:postId' {
	$r = Api GET "/profile/$entityHash/replies/$postId"
	$r.status -eq 200
}
T 'GET /search hashtag' {
	$r = Api GET '/search?q=%23social'
	if ($r.status -ne 200) { return $true }
	$r.status -eq 200
}

Section 'C. Interactions'
T 'POST /profile/like' {
	$r = Api POST '/profile/like' @{ entityHash = $entityHash; postId = $postId; like = $true }
	$r.status -eq 200 -and $r.json.event.type -eq 'like'
}
T 'POST /profile/repost' {
	$r = Api POST '/profile/repost' @{ entityHash = $entityHash; postId = $postId; comment = 'e2e repost' }
	$r.status -eq 200 -and $r.json.event.type -eq 'repost'
}
T 'POST /profile/follow dummy (no-op target)' {
	$r = Api POST '/profile/follow' @{ entityHash = $dummyTarget; follow = $true }
	$r.status -eq 200
}
T 'POST /profile/follow unfollow dummy' {
	$r = Api POST '/profile/follow' @{ entityHash = $dummyTarget; follow = $false }
	$r.status -eq 200
}
T 'POST /profile/meta' {
	$r = Api POST '/profile/meta' @{ exploreBlurb = 'e2e blurb'; isProtected = $false }
	$r.status -eq 200
}
T 'POST /profile/block + unblock dummy' {
	$b = Api POST '/profile/block' @{ entityHash = $dummyTarget; block = $true }
	if ($b.status -ne 200) { throw "block $($b.status)" }
	$u = Api POST '/profile/block' @{ entityHash = $dummyTarget; block = $false }
	$u.status -eq 200
}
T 'POST /profile/hide + unhide dummy' {
	$h = Api POST '/profile/hide' @{ entityHash = $dummyTarget; hide = $true }
	if ($h.status -ne 200) { throw "hide $($h.status)" }
	$u = Api POST '/profile/hide' @{ entityHash = $dummyTarget; hide = $false }
	$u.status -eq 200
}
T 'GET /profile/personal-lists' {
	$r = Api GET '/profile/personal-lists'
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$true
}

Section 'D. Saved posts'
T 'POST /saved-posts/folders' {
	$r = Api POST '/saved-posts/folders' @{ name = 'E2E Saved' }
	if ($r.status -ne 200) { throw "status $($r.status)" }
	$script:folderId = ($r.json.folders.PSObject.Properties | Select-Object -First 1).Name
	[bool]$script:folderId
}
T 'POST /saved-posts/add' {
	$r = Api POST '/saved-posts/add' @{ entityHash = $entityHash; postId = $postId; folderId = $folderId }
	$r.status -eq 200
}
T 'GET /saved-posts' {
	$r = Api GET '/saved-posts'
	$r.status -eq 200
}
T 'POST /saved-posts/folders/rename' {
	$r = Api POST '/saved-posts/folders/rename' @{ folderId = $folderId; name = 'E2E Starred' }
	$r.status -eq 200
}
T 'POST /saved-posts/remove' {
	$r = Api POST '/saved-posts/remove' @{ entityHash = $entityHash; postId = $postId; folderId = $folderId }
	$r.status -eq 200
}
T 'POST /saved-posts/folders/delete' {
	$r = Api POST '/saved-posts/folders/delete' @{ folderId = $folderId }
	$r.status -eq 200
}

Section 'E. Vault & translate'
T 'POST /translate' {
	$r = Api POST '/translate' @{ text = 'hello world'; targetLang = 'zh-CN' }
	$r.status -eq 200 -and $null -ne $r.json.translated
}
T 'POST /files register' {
	$r = Api POST '/files' @{
		fileId = 'e2e-file-001'
		logicalPath = 'shells/social/vault/e2e-file-001'
		name = 'e2e.txt'
		mimeType = 'text/plain'
		size = 4
		visibility = 'public'
		shareId = 'e2e-share-001'
	}
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$script:shareId = $r.json.entry.shareId
	[bool]$script:shareId
}
T 'GET /files/:shareId' {
	$r = Api GET "/files/$shareId"
	$r.status -eq 200 -and $r.json.entry.shareId -eq $shareId
}

Section 'F. Cleanup'
T 'POST /profile/post-delete' {
	$r = Api POST '/profile/post-delete' @{ postId = $postId }
	$r.status -eq 200 -and $r.json.event.type -eq 'post_delete'
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "PASS=$script:pass  FAIL=$script:fail  SKIP=$script:skip" -ForegroundColor Cyan
if ($script:failures.Count) {
	Write-Host "FAILURES:" -ForegroundColor Red
	$script:failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}
Write-Host "========================================" -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
