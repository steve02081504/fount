function script:cmd_default {
	require terminal env run
	bootstrap_full @args
	$originalTitle = Get-Title
	try {
		if ($args[0]) {
			run @args
		}
		elseif (in_container) {
			& (Join-Path $FOUNT_DIR 'path/fount.ps1') keepalive @args
		}
		else {
			# 服务器已在运行则只启 log viewer，不再重复拉一个 keepalive（省一次无效服务器启动）。
			# Test-FountRunning 来自 fount-pwsh 模块（IPC ping 16698，~100ms 快速失败）；模块缺失时按未运行回退。
			if (-not (try { Import-Module fount-pwsh -ErrorAction Stop; Test-FountRunning } catch { $false })) {
				Write-TaskbarProgress -Percent 25
				Set-Title "𝓯"
				& (Join-Path $FOUNT_DIR 'path/fount.ps1') background keepalive @args
				Set-Title "𝓯𝓸"
				Write-TaskbarProgress
			}
			& (Join-Path $FOUNT_DIR 'path/fount.ps1') log
		}
		exit $LastExitCode
	}
	finally {
		Set-Title $originalTitle
		Write-TaskbarProgressClear
	}
}
