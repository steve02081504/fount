# Social shell single-node HTTP E2E smoke.
param(
	[string]$Base = $(if ($env:FOUNT_TEST_BASE_URL) { $env:FOUNT_TEST_BASE_URL.Trim().TrimEnd('/') } else { throw 'FOUNT_TEST_BASE_URL required; run via test/live/run.mjs' }),
	[string]$Key = $env:FOUNT_API_KEY
)
$ErrorActionPreference = 'Stop'
if (-not $Key) { throw 'No API key. Set $env:FOUNT_API_KEY or pass -Key.' }

. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/singleNode/helpers.ps1')
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

Write-LiveSection 'A. Viewer & discover'
Test-Case 'GET /viewer' {
	$r = Api GET '/viewer'
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$script:entityHash = $r.json.viewerEntityHash
	[bool]$script:entityHash
}
Test-Case 'GET /profile/likes' {
	$r = Api GET "/profile/$($script:entityHash)/likes"
	$r.status -eq 200 -and $null -ne $r.json.items
}
Test-Case 'GET /feed' {
	$r = Api GET '/feed?sync=false&limit=20'
	$r.status -eq 200 -and $null -ne $r.json.items
}
Test-Case 'GET /explore/posts' {
	$r = Api GET '/explore/posts?limit=10'
	$r.status -eq 200
}
Test-Case 'GET /explore' {
	$r = Api GET '/explore?limit=10'
	$r.status -eq 200
}
Test-Case 'GET /hashtags/trending' {
	$r = Api GET '/hashtags/trending?limit=8'
	$r.status -eq 200 -and $null -ne $r.json.tags
}
Test-Case 'GET /notifications' {
	$r = Api GET '/notifications?limit=10'
	$r.status -eq 200 -and $null -ne $r.json.notifications
}
Test-Case 'GET /mentions/suggest' {
	$r = Api GET '/mentions/suggest?q=ab&limit=5'
	$r.status -eq 200
}
Test-Case 'GET /search short query 400' {
	$r = Api GET '/search?q=a'
	$r.status -eq 400
}

Write-LiveSection 'B. Profile read & post'
Test-Case 'POST /profile/post' {
	$r = Api POST '/profile/post' @{ entityHash = $entityHash; text = 'social e2e post'; visibility = 'public'; lang = 'zh-CN' }
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$script:postId = $r.json.event.id
	[bool]$script:postId
}
Test-Case 'GET /profile/:hash' {
	$r = Api GET "/profile/$entityHash"
	$r.status -eq 200 -and $r.json.entityHash -eq $entityHash
}
Test-Case 'GET /profile/:hash/posts' {
	$r = Api GET "/profile/$entityHash/posts"
	$r.status -eq 200 -and @($r.json.items).Count -ge 1
}
Test-Case 'GET /profile/:hash/following' {
	$r = Api GET "/profile/$entityHash/following"
	$r.status -eq 200
}
Test-Case 'GET /profile/:hash/replies/:postId' {
	$r = Api GET "/profile/$entityHash/replies/$postId"
	$r.status -eq 200
}
Test-Case 'GET /search hashtag' {
	$r = Api GET '/search?q=%23social'
	$r.status -eq 200
}

Write-LiveSection 'C. Interactions'
Test-Case 'POST /profile/like' {
	$r = Api POST '/profile/like' @{ entityHash = $entityHash; postId = $postId; like = $true }
	$r.status -eq 200 -and $r.json.event.type -eq 'like'
}
Test-Case 'POST /profile/repost' {
	$r = Api POST '/profile/repost' @{ entityHash = $entityHash; postId = $postId; comment = 'e2e repost' }
	$r.status -eq 200 -and $r.json.event.type -eq 'repost'
}
Test-Case 'POST /profile/follow dummy (no-op target)' {
	$r = Api POST '/profile/follow' @{ entityHash = $dummyTarget; follow = $true }
	$r.status -eq 200
}
Test-Case 'POST /profile/follow unfollow dummy' {
	$r = Api POST '/profile/follow' @{ entityHash = $dummyTarget; follow = $false }
	$r.status -eq 200
}
Test-Case 'POST /profile/meta' {
	$r = Api POST '/profile/meta' @{ exploreBlurb = 'e2e blurb'; isProtected = $false }
	$r.status -eq 200
}
Test-Case 'POST /profile/block + unblock dummy' {
	$b = Api POST '/profile/block' @{ entityHash = $dummyTarget; block = $true }
	if ($b.status -ne 200) { throw "block $($b.status)" }
	$u = Api POST '/profile/block' @{ entityHash = $dummyTarget; block = $false }
	$u.status -eq 200
}
Test-Case 'POST /profile/hide + unhide dummy' {
	$h = Api POST '/profile/hide' @{ entityHash = $dummyTarget; hide = $true }
	if ($h.status -ne 200) { throw "hide $($h.status)" }
	$u = Api POST '/profile/hide' @{ entityHash = $dummyTarget; hide = $false }
	$u.status -eq 200
}
Test-Case 'GET /profile/personal-lists' {
	$r = Api GET '/profile/personal-lists'
	if ($r.status -ne 200) { throw "status $($r.status): $($r.raw)" }
	$null -ne $r.json.blockedEntityHashes -and $null -ne $r.json.hiddenEntityHashes
}

Write-LiveSection 'D. Saved posts'
Test-Case 'POST /saved-posts/folders' {
	$r = Api POST '/saved-posts/folders' @{ name = 'E2E Saved' }
	if ($r.status -ne 200) { throw "status $($r.status)" }
	$script:folderId = ($r.json.folders.PSObject.Properties | Select-Object -First 1).Name
	[bool]$script:folderId
}
Test-Case 'POST /saved-posts/add' {
	$r = Api POST '/saved-posts/add' @{ entityHash = $entityHash; postId = $postId; folderId = $folderId }
	$r.status -eq 200
}
Test-Case 'GET /saved-posts' {
	$r = Api GET '/saved-posts'
	$r.status -eq 200
}
Test-Case 'POST /saved-posts/folders/rename' {
	$r = Api POST '/saved-posts/folders/rename' @{ folderId = $folderId; name = 'E2E Starred' }
	$r.status -eq 200
}
Test-Case 'POST /saved-posts/remove' {
	$r = Api POST '/saved-posts/remove' @{ entityHash = $entityHash; postId = $postId; folderId = $folderId }
	$r.status -eq 200
}
Test-Case 'POST /saved-posts/folders/delete' {
	$r = Api POST '/saved-posts/folders/delete' @{ folderId = $folderId }
	$r.status -eq 200
}

Write-LiveSection 'E. Vault & translate'
Test-Case 'POST /translate' {
	$r = Api POST '/translate' @{ text = 'hello world'; targetLang = 'zh-CN' }
	$r.status -eq 200 -and $null -ne $r.json.translated
}
Test-Case 'POST /files register' {
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
Test-Case 'GET /files/:shareId' {
	$r = Api GET "/files/$shareId"
	$r.status -eq 200 -and $r.json.entry.shareId -eq $shareId
}

Write-LiveSection 'F. Cleanup'
Test-Case 'POST /profile/post-delete' {
	$r = Api POST '/profile/post-delete' @{ postId = $postId }
	$r.status -eq 200 -and $r.json.event.type -eq 'post_delete'
}

Write-LiveSummary 'social e2e_single'
Complete-LiveScript
