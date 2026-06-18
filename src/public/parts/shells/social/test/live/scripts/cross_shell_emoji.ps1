# Cross-shell: Social user views feed with group emoji token (smoke).
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\..\chat\test\live\scripts\fed_l4_common.ps1')

Write-Host "=== cross_shell_emoji smoke ===" -ForegroundColor Cyan
T 'Social registry markdown_extensions reachable' {
	$r = Api $FedA GET '/registries/markdown_extensions'
	$r.status -eq 200 -and $r.json.Count -ge 0
}
Write-Host "=== DONE cross_shell_emoji ===" -ForegroundColor Green
