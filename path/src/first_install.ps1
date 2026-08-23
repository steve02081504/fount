function script:fount_first_install_if_needed {
	if (!(Test-Path -Path "$FOUNT_DIR/node_modules") -or $args[0] -eq 'init') {
		if (Test-Path -Path "$FOUNT_DIR/node_modules") {
			run shutdown
		}
		if (!(Test-Path -Path "$FOUNT_DIR/.noupdate")) {
			if ((Get-Command git -ErrorAction Ignore) -and (Test-Path -Path "$FOUNT_DIR/.git")) {
				invoke_repo_git config core.autocrlf false
				$hasHead = git_ref_exists
				git_fetch_origin 2>$null
				$fetchOk = ($LastExitCode -eq 0)
				if ((git_ref_exists 'origin/master') -and ($hasHead -or $fetchOk)) {
					git_sync_to_ref 'origin/master'
					if ($LastExitCode -eq 0) {
						invoke_repo_git gc --aggressive --prune=now --force
					}
				}
				elseif (-not $fetchOk) {
					Write-Warning (Get-I18n -key 'git.fetchFailed')
					Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
				}
			}
		}
		Write-TaskbarProgress -Percent 70
		Write-Host (Get-I18n -key 'install.installingDependencies')
		# 仓库 pin 了 deno 版本（.deno-version）时先按其升级，避免首装用到错误的 deno 版本导致依赖解析失败
		if (deno_pinned_spec) {
			deno_upgrade
		}
		deno install --prod --reload --allow-scripts -c "$FOUNT_DIR/deno.json" --entrypoint "$FOUNT_DIR/src/server/index.mjs"
		$global:LastExitCode = 0
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
			Copy-Item "$FOUNT_DIR/default/default_desktop.ini" "$FOUNT_DIR/data/desktop.ini" -Force -ErrorAction SilentlyContinue
		}
		if (-not (Test-Path "$FOUNT_DIR/node_modules/desktop.ini")) {
			Copy-Item "$FOUNT_DIR/default/node_modules_desktop.ini" "$FOUNT_DIR/node_modules/desktop.ini" -Force -ErrorAction SilentlyContinue
		}
		Set-FountFileAttributes

		# 生成 桌面快捷方式 和 Start Menu 快捷方式
		New-FountShortcut

		# fount 协议注册
		Register-FountProtocol

		# fount Terminal注册
		Register-FountTerminalProfile
		register_fount_terminal_keybindings
		Register-FountBootBackground

		invoke_explorer_refresh

		Register-FountSteam
	}
}
