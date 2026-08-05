function script:update_fount_and_deno {
	if (Test-Path -Path "$FOUNT_DIR/.noupdate") {
		Write-Host (Get-I18n -key 'update.skippingFountUpdate')
		return
	}
	fount_upgrade
	if ($LastExitCode -ne 0) { return }
	deno_upgrade
}

# Explicit target: branch → track tip & clear .noupdate; commit → detach & create .noupdate.
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
		invoke_repo_git init -b master
		invoke_repo_git config core.autocrlf false
		invoke_repo_git remote add origin https://github.com/steve02081504/fount.git
	}

	invoke_repo_git config core.autocrlf false
	invoke_repo_git fetch origin
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailed')
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}
	# Shallow / odd tips: also ask origin for the named ref or object.
	invoke_repo_git fetch origin $Target 2>$null | Out-Null

	$remoteRef = "origin/$Target"
	if ((git_ref_exists $remoteRef) -or (git_ref_exists "refs/heads/$Target")) {
		Write-Host (Get-I18n -key 'update.switchingToBranch' -params @{ branch = $Target })
		if (git_ref_exists $remoteRef) {
			git_checkout_branch $Target $remoteRef
			if ($LastExitCode -ne 0) { return }
		}
		else {
			git_backup_uncommitted
			if ($LastExitCode -ne 0) { return }
			invoke_repo_git checkout $Target
			if ($LastExitCode -ne 0) { return }
		}
		if (Test-Path -LiteralPath "$FOUNT_DIR/.noupdate") {
			Remove-Item -LiteralPath "$FOUNT_DIR/.noupdate" -Force
			Write-Host (Get-I18n -key 'update.removedNoUpdate')
		}
		fount_upgrade
		if ($LastExitCode -ne 0) { return }
		deno_upgrade
		return
	}

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
