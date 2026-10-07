function script:cmd_default {
	require terminal env run
	bootstrap_full @args
	# `run` / `runas` 是 part 调用：终端标题与任务栏归调用方，这里不保存也不恢复。
	$isInvocation = $args[0] -in @('run', 'runas')
	if (-not $isInvocation) { $originalTitle = Get-Title }
	try {
		if ($args[0]) {
			if ($isInvocation) {
				if (-not $(try { Import-Module fount-pwsh -ErrorAction Stop; Test-FountRunning } catch { $false })) {
					& (Join-Path $FOUNT_DIR 'path/fount.ps1') background keepalive *> $null
					if ($LastExitCode -ne 0) { exit $LastExitCode }
					$deadline = (Get-Date).AddSeconds(60)
					while (-not $(try { Test-FountRunning } catch { $false })) {
						if ((Get-Date) -ge $deadline) { Write-Error 'fount server did not start in time'; exit 1 }
						Start-Sleep -Milliseconds 200
					}
				}
			}
			run @args
		}
		elseif (in_container) {
			& (Join-Path $FOUNT_DIR 'path/fount.ps1') keepalive @args
		}
		else {
			# 服务器已在运行则只启 log viewer，不再重复拉一个 keepalive（省一次无效服务器启动）。
			# Test-FountRunning 来自 fount-pwsh 模块（IPC ping 16698，~100ms 快速失败）；模块缺失时按未运行回退。
			if (-not $(try { Import-Module fount-pwsh -ErrorAction Stop; Test-FountRunning } catch { $false })) {
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
		if (-not $isInvocation) { Set-Title $originalTitle; Write-TaskbarProgressClear }
	}
}
