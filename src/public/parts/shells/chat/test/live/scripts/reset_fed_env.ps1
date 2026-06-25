$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$nodeBData = Join-Path $root 'node_b_data'

$patterns = @(
	'_node_b_run.log',
	'_node_b_run.err.log'
)
foreach ($name in $patterns) {
	$path = Join-Path $root $name
	if (Test-Path $path) {
		Remove-Item -Force $path
	}
}

$cleanupDirs = @(
	(Join-Path $nodeBData 'users/nodeb/shells/chat/groups'),
	(Join-Path $nodeBData 'users/nodeb/shells/chat/files'),
	(Join-Path $nodeBData 'users/nodeb/shells/chat/blobs'),
	(Join-Path $nodeBData 'users/nodeb/entities'),
	(Join-Path $nodeBData 'p2p/chunks')
)
foreach ($dir in $cleanupDirs) {
	if (Test-Path $dir) {
		Remove-Item -Recurse -Force $dir
	}
}

$cleanupFiles = @(
	(Join-Path $nodeBData 'users/nodeb/shells/chat/blob_refcounts.json')
)
foreach ($file in $cleanupFiles) {
	if (Test-Path $file) {
		Remove-Item -Force $file
	}
}

$seedDirs = @(
	(Join-Path $nodeBData 'users/nodeb/settings'),
	(Join-Path $nodeBData 'users/nodeb/shells/chat'),
	(Join-Path $nodeBData 'p2p')
)
foreach ($dir in $seedDirs) {
	if (-not (Test-Path $dir)) {
		New-Item -ItemType Directory -Path $dir -Force | Out-Null
	}
}

Write-Host 'Federation test artifacts cleaned.' -ForegroundColor Green
