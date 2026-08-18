function script:update_fount_and_deno {
	if (Test-Path -Path "$FOUNT_DIR/.noupdate") {
		Write-Host (Get-I18n -key 'update.skippingFountUpdate')
		return
	}
	fount_upgrade
	if ($LastExitCode -ne 0) { return }
	deno_upgrade
}

# Switch to a remote branch tip (one-shot fetch; does not widen remote.origin.fetch).
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

# Explicit target: PR → detach at head & .noupdate; branch → track tip & clear .noupdate; commit → detach & .noupdate.
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

	# GitHub pull request tip — pin like a commit (re-run the same command to refresh).
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

	# Known locally / already tracked — refresh that one tip, no ls-remote.
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

	# Unknown named target — ask origin once, then one-shot fetch if it is a branch.
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

	# Bare ref → FETCH_HEAD; enough to resolve a commit/tag object.
	invoke_repo_git fetch origin $Target 2>$null | Out-Null
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

# After the first successful deno upgrade, routine starts refresh in the background.
function script:update_fount_and_deno_background {
	if (Test-Path -Path "$FOUNT_DIR/.noupdate") {
		Write-Host (Get-I18n -key 'update.skippingFountUpdate')
		return
	}
	$upgradedFlag = Join-Path $FOUNT_DIR 'data/installer/deno_upgraded'
	if (Test-Path $upgradedFlag) {
		# Start-Job cannot call in-process functions; re-enter via `fount update`.
		Start-Job -ScriptBlock {
			param($fountPs1)
			& $fountPs1 update
		} -ArgumentList (Join-Path $FOUNT_DIR 'path/fount.ps1') | Out-Null
		return
	}
	update_fount_and_deno
}
