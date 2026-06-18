# Cross-shell: Social user views feed with group emoji token (smoke).
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\..\chat\test\live\scripts\fed_l4_common.ps1')

Write-Host "=== cross_shell_emoji smoke ===" -ForegroundColor Cyan
T 'Chat emoji registry reachable' {
	$r = RootApi $FedA GET '/api/registries/emoji'
	$r.status -eq 200 -and @($r.json | Where-Object { $_.path -like '*providers/emoji*' }).Count -ge 1
}
T 'markdown_extensions registry reachable' {
	$r = RootApi $FedA GET '/api/registries/markdown_extensions'
	$r.status -eq 200 -and $r.json.Count -ge 1
}
Write-Host "=== DONE cross_shell_emoji ===" -ForegroundColor Green
