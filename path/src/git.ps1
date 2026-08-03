# Git 安装和更新
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
	Write-Host (Get-I18n -key 'git.notInstalled')
	Test-Winget
	if (Get-Command winget -ErrorAction SilentlyContinue) {
		winget install --id Git.Git -e --source winget
		New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
		Set-Content "$FOUNT_DIR/data/installer/auto_installed_git" '1'
	}
	else {
		Write-Host (Get-I18n -key 'git.installFailedWinget')
	}
	RefreshPath
	if (!(Get-Command git -ErrorAction SilentlyContinue)) {
		Write-Host (Get-I18n -key 'git.installFailedManual')
	}
}

function script:Invoke-RepoGit {
	$prevPrompt = $env:GIT_TERMINAL_PROMPT
	$prevLocks = $env:GIT_OPTIONAL_LOCKS
	$env:GIT_TERMINAL_PROMPT = '0'
	$env:GIT_OPTIONAL_LOCKS = '0'
	try {
		& git -C "$FOUNT_DIR" @args
	}
	finally {
		if ($null -ne $prevPrompt) { $env:GIT_TERMINAL_PROMPT = $prevPrompt }
		else { Remove-Item Env:\GIT_TERMINAL_PROMPT -ErrorAction Ignore }
		if ($null -ne $prevLocks) { $env:GIT_OPTIONAL_LOCKS = $prevLocks }
		else { Remove-Item Env:\GIT_OPTIONAL_LOCKS -ErrorAction Ignore }
	}
}

function script:Test-GitRef($Ref = 'HEAD') {
	Invoke-RepoGit rev-parse --verify $Ref *> $null
	return ($LastExitCode -eq 0)
}

function script:Save-GitUncommittedBackup {
	if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return }
	if (-not (Test-Path -LiteralPath "$FOUNT_DIR/.git")) { return }
	$status = Invoke-RepoGit status --porcelain
	if (-not $status) { return }

	$timestamp = (Get-Date -Format 'yyyyMMdd_HHmmss')
	$diffFilePath = Join-Path -Path $env:TEMP -ChildPath "fount-local-changes-diff_$timestamp.diff"

	$headExists = Test-GitRef

	Invoke-RepoGit add -A
	Invoke-RepoGit diff --cached | Out-File -FilePath $diffFilePath -Encoding utf8
	Invoke-RepoGit reset $(if ($headExists) { 'HEAD' } else { })

	Write-Host (Get-I18n -key 'git.localChangesDetected') -ForegroundColor Yellow
	Write-Host (Get-I18n -key 'git.backupSavedTo' -params @{ path = $diffFilePath }) -ForegroundColor Green
}

function script:Sync-GitToRef($Ref) {
	if (-not (Test-GitRef $Ref)) {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $Ref })
		return $false
	}
	Save-GitUncommittedBackup
	Invoke-RepoGit clean -fd | Out-Host
	if ($LastExitCode -ne 0) { return $false }
	Invoke-RepoGit reset --hard $Ref | Out-Host
	return ($LastExitCode -eq 0)
}

function script:fount_upgrade {
	if (!(Get-Command git -ErrorAction SilentlyContinue)) {
		Write-Host (Get-I18n -key 'git.notInstalledSkippingPull')
		return
	}
	if ($FOUNT_DIR -notin $(git config --global --get-all safe.directory)) {
		git config --global --add safe.directory "$FOUNT_DIR"
	}
	if (!(Test-Path -Path "$FOUNT_DIR/.git")) {
		Write-Host (Get-I18n -key 'git.repoNotFound')
		Invoke-RepoGit init -b master
		Invoke-RepoGit config core.autocrlf false
		Invoke-RepoGit remote add origin https://github.com/steve02081504/fount.git
		Write-Host (Get-I18n -key 'git.fetchingAndResetting')
		Invoke-RepoGit fetch origin master --depth 1
		if ($LastExitCode -ne 0) {
			Write-Warning (Get-I18n -key 'git.fetchFailed')
			Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
			return
		}
		Sync-GitToRef 'origin/master' | Out-Null
		return
	}

	Invoke-RepoGit config core.autocrlf false
	$hasHead = Test-GitRef
	Invoke-RepoGit fetch origin
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailed')
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}

	if (-not $hasHead -and -not (Test-GitRef)) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}

	$currentBranch = Invoke-RepoGit rev-parse --abbrev-ref HEAD 2>$null
	if ($LastExitCode -ne 0) { $currentBranch = 'HEAD' }
	if ($currentBranch -eq 'HEAD') {
		if (-not (Test-GitRef 'origin/master')) {
			Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = 'origin/master' })
			return
		}
		Write-Host (Get-I18n -key 'git.notOnBranch')
		if (-not (Sync-GitToRef 'origin/master')) { return }
		Invoke-RepoGit checkout master
		$currentBranch = Invoke-RepoGit rev-parse --abbrev-ref HEAD 2>$null
	}

	if (-not (Test-GitRef)) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}

	$remoteBranch = Invoke-RepoGit rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
	if (-not $remoteBranch) {
		$candidateRemote = "origin/$currentBranch"
		if (-not (Test-GitRef $candidateRemote)) {
			Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $candidateRemote })
			return
		}
		Write-Warning (Get-I18n -key 'git.noUpstreamBranch' -params @{ branch = $currentBranch; remote = $candidateRemote })
		Invoke-RepoGit branch --set-upstream-to $candidateRemote
		$remoteBranch = $candidateRemote
	}

	if (-not (Test-GitRef $remoteBranch)) {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $remoteBranch })
		return
	}

	$mergeBase = Invoke-RepoGit merge-base $currentBranch $remoteBranch 2>$null
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}
	$localCommit = Invoke-RepoGit rev-parse $currentBranch 2>$null
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}
	$remoteCommit = Invoke-RepoGit rev-parse $remoteBranch 2>$null
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}
	$status = Invoke-RepoGit status --porcelain

	if ($localCommit -ne $remoteCommit) {
		if ($mergeBase -eq $localCommit) {
			Write-Host (Get-I18n -key 'git.updatingFromRemote')
			if ($status) { Save-GitUncommittedBackup }
			Invoke-RepoGit reset --hard $remoteBranch
		}
		elseif ($mergeBase -eq $remoteCommit) {
			Write-Host (Get-I18n -key 'git.localBranchAhead')
			if ($status) { Write-Warning (Get-I18n -key 'git.dirtyWorkingDirectory') }
		}
		else {
			Write-Host (Get-I18n -key 'git.branchesDiverged')
			if ($status) { Save-GitUncommittedBackup }
			Invoke-RepoGit reset --hard $remoteBranch
		}
	}
	else {
		Write-Host (Get-I18n -key 'git.alreadyUpToDate')
		if ($status) { Write-Warning (Get-I18n -key 'git.dirtyWorkingDirectory') }
	}
}
