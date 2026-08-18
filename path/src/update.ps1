function script:update_fount_and_deno {
	if (Test-Path -Path "$FOUNT_DIR/.noupdate") {
		Write-Host (Get-I18n -key 'update.skippingFountUpdate')
		return
	}
	fount_upgrade
	if ($LastExitCode -ne 0) { return }
	deno_upgrade
}

# 切换到远端分支尖端（一次性拉取；不扩展 remote.origin.fetch）。
function script:fount_switch_to_branch($Target) {
	Write-Host (Get-I18n -key 'update.switchingToBranch' -params @{ branch = $Target })
	git_fetch_remote_branch $Target
	if ($LastExitCode -ne 0) { return }
	git_checkout_branch $Target "origin/$Target"
	if ($LastExitCode -ne 0) { return }
	if (Test-Path -LiteralPath "$FOUNT_DIR/.noupdate") {
		Remove-Item -LiteralPath "$FOUNT_DIR/.noupdate" -Force
		Write-Host (Get-I18n -key 'update.removedNoUpdate')
	}
}

# 显式目标：PR → 分离到 head 并写 .noupdate；分支 → 跟踪尖端并清除 .noupdate；提交 → 分离并写 .noupdate。
function script:fount_update_to_ref($Target) {
	if (!(Get-Command git -ErrorAction SilentlyContinue)) {
		Write-Host (Get-I18n -key 'git.notInstalledSkippingPull')
		return
	}
	if ($FOUNT_DIR -notin $(git config --global --get-all safe.directory)) {
		git config --global --add safe.directory "$FOUNT_DIR"
	}
	if (!(Test-Path -Path "$FOUNT_DIR/.git")) {
		Write-Host (Get-I18n -key 'git.repoNotFound')
		git_supplement_repo
		if ($LastExitCode -ne 0) {
			Write-Warning (Get-I18n -key 'git.fetchFailed')
			Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
			return
		}
	}

	invoke_repo_git config core.autocrlf false

	# GitHub pull request 尖端 —— 像提交一样固定（重复运行同一命令即可刷新）。
	$prNumber = git_parse_pr_number $Target
	if ($prNumber) {
		Write-Host (Get-I18n -key 'update.pinningToPullRequest' -params @{ pr = $prNumber })
		git_fetch_pull_request $prNumber
		if ($LastExitCode -ne 0) {
			Write-Warning (Get-I18n -key 'git.fetchFailed')
			Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
			return
		}
		git_detach_to_ref "origin/pr/$prNumber"
		if ($LastExitCode -ne 0) { return }
		New-Item -Path "$FOUNT_DIR/.noupdate" -ItemType File -Force | Out-Null
		Write-Host (Get-I18n -key 'update.createdNoUpdate')
		deno_upgrade
		return
	}

	# 远程 URL —— 把 origin 指到该远程并切到其默认分支。
	if (git_is_remote_url $Target) {
		fount_update_to_url $Target
		return
	}

	# 本地已知/已跟踪 —— 只刷新那一个尖端，不做 ls-remote。
	if ((git_ref_exists "origin/$Target") -or (git_ref_exists "refs/heads/$Target")) {
		if (git_ref_exists "origin/$Target") {
			fount_switch_to_branch $Target
			if ($LastExitCode -ne 0) { return }
			deno_upgrade
			return
		}
		Write-Host (Get-I18n -key 'update.switchingToBranch' -params @{ branch = $Target })
		git_backup_uncommitted
		if ($LastExitCode -ne 0) { return }
		invoke_repo_git checkout $Target
		if ($LastExitCode -ne 0) { return }
		if (Test-Path -LiteralPath "$FOUNT_DIR/.noupdate") {
			Remove-Item -LiteralPath "$FOUNT_DIR/.noupdate" -Force
			Write-Host (Get-I18n -key 'update.removedNoUpdate')
		}
		fount_upgrade
		if ($LastExitCode -ne 0) { return }
		deno_upgrade
		return
	}

	# 未知具名目标 —— 先询问 origin 一次，若是分支再做一次性拉取。
	$remoteStatus = git_remote_branch_status $Target
	if ($remoteStatus -eq 2) {
		Write-Warning (Get-I18n -key 'git.fetchFailed')
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}
	if ($remoteStatus -eq 0) {
		fount_switch_to_branch $Target
		if ($LastExitCode -ne 0) { return }
		deno_upgrade
		return
	}

	# 裸 ref → FETCH_HEAD；足以解析一个 commit/tag 对象。
	git_fetch_with_fallback $Target 2>$null | Out-Null
	$commit = invoke_repo_git rev-parse --verify "${Target}^{commit}" 2>$null
	if ($LastExitCode -ne 0 -or -not $commit) {
		Write-Warning (Get-I18n -key 'update.unknownTarget' -params @{ target = $Target })
		return
	}

	Write-Host (Get-I18n -key 'update.pinningToCommit' -params @{ ref = $commit })
	git_detach_to_ref $commit
	if ($LastExitCode -ne 0) { return }
	New-Item -Path "$FOUNT_DIR/.noupdate" -ItemType File -Force | Out-Null
	Write-Host (Get-I18n -key 'update.createdNoUpdate')
	deno_upgrade
}

# `fount update <remote-url>` —— 把 origin 指到该远程并切到其默认分支（随后普通更新跟随它）。
function script:fount_update_to_url($Url) {
	if (invoke_repo_git remote 2>$null -contains 'origin') {
		invoke_repo_git remote set-url origin $Url
	}
	else {
		invoke_repo_git remote add origin $Url
	}
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailed')
		return
	}
	$symref = invoke_repo_git ls-remote --symref $Url HEAD 2>$null
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailed')
		return
	}
	$defaultBranch = $null
	foreach ($line in $symref) {
		if ($line -match '^ref:\s*refs/heads/([^\s\t]+)') { $defaultBranch = $Matches[1]; break }
	}
	if (-not $defaultBranch) { $defaultBranch = 'master' }
	fount_switch_to_branch $defaultBranch
	if ($LastExitCode -ne 0) { return }
	deno_upgrade
}

# 首次成功升级 deno 后，例程改为在后台刷新。
function script:update_fount_and_deno_background {
	if (Test-Path -Path "$FOUNT_DIR/.noupdate") {
		Write-Host (Get-I18n -key 'update.skippingFountUpdate')
		return
	}
	$upgradedFlag = Join-Path $FOUNT_DIR 'data/installer/deno_upgraded'
	if (Test-Path $upgradedFlag) {
		# Start-Job 无法调用进程内函数；通过 `fount update` 重新进入。
		Start-Job -ScriptBlock {
			param($fountPs1)
			& $fountPs1 update
		} -ArgumentList (Join-Path $FOUNT_DIR 'path/fount.ps1') | Out-Null
		return
	}
	update_fount_and_deno
}
