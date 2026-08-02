function Invoke-FountFirstInstall {
	param([string[]]$CommandArgs)
	if (!(Test-Path -Path "$FOUNT_DIR/node_modules") -or $CommandArgs[0] -eq 'init') {
		if (!(Test-Path -Path "$FOUNT_DIR/.noupdate")) {
			if (Get-Command git -ErrorAction Ignore) {
				Invoke-GitForFount config core.autocrlf false
				$hasHead = Test-FountGitRef
				Invoke-GitForFount fetch origin 2>$null
				$fetchOk = ($LastExitCode -eq 0)
				if ((Test-FountGitRef 'origin/master') -and ($hasHead -or $fetchOk)) {
					if (Sync-FountGitToRef 'origin/master') {
						Invoke-GitForFount gc --aggressive --prune=now --force
					}
				}
				elseif (-not $fetchOk) {
					Write-Warning (Get-I18n -key 'git.fetchFailed')
					Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
				}
			}
		}
		if (Test-Path -Path "$FOUNT_DIR/node_modules") {
			run shutdown
		}
		New-Item -Path "$FOUNT_DIR/node_modules" -ItemType Directory -ErrorAction Ignore -Force | Out-Null
		Write-TaskbarProgress -Percent 70
		Write-Host (Get-I18n -key 'install.installingDependencies')
		deno install --prod --reload --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" --entrypoint "$FOUNT_DIR/src/server/index.mjs"
		Write-TaskbarProgress -Percent 85
		Write-Host "======================================================" -ForegroundColor Green
		Write-Warning (Get-I18n -key 'install.untrustedPartsWarning')
		Write-Host "======================================================" -ForegroundColor Green
		Write-TaskbarProgressClear

		# 隐藏文件设置和desktop.ini生效
		if ((Test-Path "$FOUNT_DIR/.git") -and (-not (Test-Path "$FOUNT_DIR/.git/desktop.ini"))) {
			Copy-Item "$FOUNT_DIR/default/git_desktop.ini" "$FOUNT_DIR/.git/desktop.ini" -Force
		}
		New-InstallerDir # For data/desktop.ini
		if (-not (Test-Path "$FOUNT_DIR/data/desktop.ini")) {
			Copy-Item "$FOUNT_DIR/default/default_desktop.ini" "$FOUNT_DIR/data/desktop.ini" -Force
		}
		if (-not (Test-Path "$FOUNT_DIR/node_modules/desktop.ini")) {
			Copy-Item "$FOUNT_DIR/default/node_modules_desktop.ini" "$FOUNT_DIR/node_modules/desktop.ini" -Force
		}
		Set-FountFileAttributes

		# 生成 桌面快捷方式 和 Start Menu 快捷方式
		New-FountShortcut

		# fount 协议注册
		Register-FountProtocol

		# fount Terminal注册
		Register-FountTerminalProfile
		Register-FountTerminalKeybindings
		Register-FountBootBackground

		Invoke-FountExplorerRefresh
	}
}
