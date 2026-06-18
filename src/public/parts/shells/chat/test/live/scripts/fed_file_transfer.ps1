# Cross-node file transfer: A uploads chunk + registers file; B downloads via federation.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fed_l4_common.ps1')

$gid = $null; $cid = $null; $fileId = [guid]::NewGuid().ToString()

Write-Host "=== Setup: open group + join ===" -ForegroundColor Cyan
$setup = Setup-OpenGroupJoin 'FedFileXfer' 'file-xfer-seed'
$gid = $setup.groupId
$cid = $setup.defaultChannelId

Write-Host "`n=== A uploads chunk + registers file ===" -ForegroundColor Cyan
$ci = $null
T 'A uploads + registers file' {
	$data = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('fed-file-payload-1234567890'))
	$up = Api $FedA POST "/groups/$gid/chunks" @{ fileId = $fileId; data = $data; channelId = $cid; ceMode = 'convergent' }
	if ($up.status -ne 200 -and $up.status -ne 201) { throw "chunk $($up.status): $($up.raw)" }
	$script:ci = $up.json
	$body = @{
		fileId = $fileId; name = 'fed.txt'; size = 27; mimeType = 'text/plain'; folderId = $null
		ceMode = $ci.ceMode; contentHash = $ci.contentHash; ciphertextHash = $ci.ciphertextHash
		wrappedKey = $ci.wrappedKey; storageLocator = $ci.storageLocator; key_generation = $ci.key_generation; channelId = $cid
	}
	$reg = Api $FedA POST "/groups/$gid/files" $body
	$reg.status -eq 201
}

Write-Host "`n=== B federation file sync ===" -ForegroundColor Cyan
T 'B sees file meta (DAG sync)' {
	[bool](PollUntil 60 3 {
		$m = Api $FedB GET "/groups/$gid/files/$fileId/meta"
		$m.status -eq 200 -and $m.json.fileId -eq $fileId
	})
}
T 'B downloads file content via federation' {
	$rs = Api $FedB POST "/groups/$gid/files/$fileId/download-resume" @{}
	if ($rs.status -ne 200) { throw "resume $($rs.status): $($rs.raw)" }
	$done = PollUntil 150 4 {
		$st = Api $FedB GET "/groups/$gid/files/$fileId/download-status"
		if ($st.status -ne 200) { return $false }
		$s = $st.json.status
		if ($s.status -eq 'failed' -or $s.error) { throw "download failed: $($st.raw)" }
		($s.status -eq 'done') -or ($s.percent -eq 100) -or ($s.done -ge $s.total -and $s.total -gt 0)
	}
	[bool]$done
}

Cleanup-Group $gid
Write-Host "`n=== DONE fed_file_transfer ===" -ForegroundColor Green
