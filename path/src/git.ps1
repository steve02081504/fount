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

function script:invoke_repo_git {
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

function script:git_ref_exists($Ref = 'HEAD') {
	invoke_repo_git rev-parse --verify $Ref *> $null
	return ($LastExitCode -eq 0)
}

function script:git_backup_uncommitted {
	$global:LastExitCode = 0
	if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return }
	if (-not (Test-Path -LiteralPath "$FOUNT_DIR/.git")) { return }
	$status = invoke_repo_git status --porcelain
	if (-not $status) { return }

	$timestamp = (Get-Date -Format 'yyyyMMdd_HHmmss')
	$diffFilePath = Join-Path -Path $env:TEMP -ChildPath "fount-local-changes-diff_$timestamp.diff"

	$headExists = git_ref_exists

	invoke_repo_git add -A
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git diff --cached | Out-File -FilePath $diffFilePath -Encoding utf8
	if ($LastExitCode -ne 0) { return }
	if ($headExists) { invoke_repo_git reset HEAD } else { invoke_repo_git reset }
	if ($LastExitCode -ne 0) { return }

	Write-Host (Get-I18n -key 'git.localChangesDetected') -ForegroundColor Yellow
	Write-Host (Get-I18n -key 'git.backupSavedTo' -params @{ path = $diffFilePath }) -ForegroundColor Green
}

function script:git_sync_to_ref($Ref) {
	if (-not (git_ref_exists $Ref)) {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $Ref })
		return
	}
	git_backup_uncommitted
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git clean -fd
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git reset --hard $Ref
}

# Switch/create local branch at StartPoint (default origin/<Branch>). Does not move other branches.
function script:git_checkout_branch($Branch, $StartPoint = $null) {
	if (-not $StartPoint) { $StartPoint = "origin/$Branch" }
	if (-not (git_ref_exists $StartPoint)) {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $StartPoint })
		return $false
	}
	git_backup_uncommitted
	if ($LastExitCode -ne 0) { return $false }
	invoke_repo_git clean -fd | Out-Host
	if ($LastExitCode -ne 0) { return $false }
	invoke_repo_git checkout -B $Branch $StartPoint | Out-Host
	if ($LastExitCode -ne 0) { return $false }
	if ($StartPoint -like 'origin/*') {
		invoke_repo_git branch --set-upstream-to $StartPoint $Branch | Out-Null
	}
	return $true
}

# Detach HEAD at Ref without moving the previous branch tip.
function script:git_detach_to_ref($Ref) {
	$resolved = invoke_repo_git rev-parse --verify "${Ref}^{commit}" 2>$null
	if ($LastExitCode -ne 0 -or -not $resolved) {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $Ref })
		return $false
	}
	git_backup_uncommitted
	if ($LastExitCode -ne 0) { return $false }
	invoke_repo_git clean -fd | Out-Host
	if ($LastExitCode -ne 0) { return $false }
	invoke_repo_git checkout --detach $resolved | Out-Host
	return ($LastExitCode -eq 0)
}

function script:fount_upgrade {
	$global:LastExitCode = 0
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
		Write-Host (Get-I18n -key 'git.fetchingAndResetting')
		invoke_repo_git fetch origin master --depth 1
		if ($LastExitCode -ne 0) {
			Write-Warning (Get-I18n -key 'git.fetchFailed')
			Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
			return
		}
		git_sync_to_ref 'origin/master'
		return
	}

	invoke_repo_git config core.autocrlf false
	$hasHead = git_ref_exists
	invoke_repo_git fetch origin
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailed')
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}

	if (-not $hasHead -and -not (git_ref_exists)) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}

	$currentBranch = invoke_repo_git rev-parse --abbrev-ref HEAD 2>$null
	if ($LastExitCode -ne 0) { $currentBranch = 'HEAD' }
	if ($currentBranch -eq 'HEAD') {
		if (-not (git_ref_exists 'origin/master')) {
			Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = 'origin/master' })
			return
		}
		Write-Host (Get-I18n -key 'git.notOnBranch')
		git_sync_to_ref 'origin/master'
		if ($LastExitCode -ne 0) { return }
		invoke_repo_git checkout master
		$currentBranch = invoke_repo_git rev-parse --abbrev-ref HEAD 2>$null
	}

	if (-not (git_ref_exists)) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}

	$remoteBranch = invoke_repo_git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
	if (-not $remoteBranch) {
		$candidateRemote = "origin/$currentBranch"
		if (-not (git_ref_exists $candidateRemote)) {
			Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $candidateRemote })
			return
		}
		Write-Warning (Get-I18n -key 'git.noUpstreamBranch' -params @{ branch = $currentBranch; remote = $candidateRemote })
		invoke_repo_git branch --set-upstream-to $candidateRemote
		$remoteBranch = $candidateRemote
	}

	if (-not (git_ref_exists $remoteBranch)) {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $remoteBranch })
		return
	}

	$mergeBase = invoke_repo_git merge-base $currentBranch $remoteBranch 2>$null
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}
	$localCommit = invoke_repo_git rev-parse $currentBranch 2>$null
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}
	$remoteCommit = invoke_repo_git rev-parse $remoteBranch 2>$null
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}
	$status = invoke_repo_git status --porcelain

	if ($localCommit -ne $remoteCommit) {
		if ($mergeBase -eq $localCommit) {
			Write-Host (Get-I18n -key 'git.updatingFromRemote')
			if ($status) {
				git_backup_uncommitted
				if ($LastExitCode -ne 0) { return }
			}
			invoke_repo_git reset --hard $remoteBranch
		}
		elseif ($mergeBase -eq $remoteCommit) {
			Write-Host (Get-I18n -key 'git.localBranchAhead')
			if ($status) { Write-Warning (Get-I18n -key 'git.dirtyWorkingDirectory') }
		}
		else {
			Write-Host (Get-I18n -key 'git.branchesDiverged')
			if ($status) {
				git_backup_uncommitted
				if ($LastExitCode -ne 0) { return }
			}
			invoke_repo_git reset --hard $remoteBranch
		}
	}
	else {
		Write-Host (Get-I18n -key 'git.alreadyUpToDate')
		if ($status) { Write-Warning (Get-I18n -key 'git.dirtyWorkingDirectory') }
	}
}
