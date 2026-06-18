# Cross-node file transfer: A uploads file, B receives via federation (extends fed_e2e_ext patterns).
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fed_l4_common.ps1')

Write-Host "=== fed_file_transfer: delegated to fed_e2e_ext file section ===" -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'fed_e2e_ext.ps1')
Write-Host "=== DONE fed_file_transfer ===" -ForegroundColor Green
