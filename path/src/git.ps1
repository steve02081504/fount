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

# Fetch origin and drop stale remote-tracking refs under the configured refspec.
# Does not widen fetch to other branches — named targets use git_fetch_remote_branch.
function script:git_fetch_origin {
	invoke_repo_git fetch origin --prune
}

# Reject glob metacharacters and other ref-unsafe fragments for single-branch fetch.
# Aligns with git check-ref-format rules for refs/heads/<name> (plus apostrophe).
function script:git_valid_branch_name($Branch) {
	if ([string]::IsNullOrEmpty($Branch) -or $Branch -eq '@') { return $false }
	if ($Branch -match '[\?\*\[\\:~^\s'']|\.\.|@{|//|[\x00-\x1F\x7F]') { return $false }
	if ($Branch.StartsWith('/') -or $Branch.EndsWith('/')) { return $false }
	foreach ($part in $Branch.Split('/')) {
		if ([string]::IsNullOrEmpty($part)) { return $false }
		if ($part.StartsWith('.') -or $part.EndsWith('.') -or $part.EndsWith('.lock')) { return $false }
	}
	return $true
}

# 0 = branch exists on origin, 1 = confirmed absent, 2 = network/other error.
# Only call when a named ref is unknown locally — avoid on the plain-update happy path.
function script:git_remote_branch_status($Branch) {
	if (-not (git_valid_branch_name $Branch)) { return 2 }
	$output = invoke_repo_git ls-remote --heads origin "refs/heads/$Branch" 2>$null
	if ($LastExitCode -ne 0) { return 2 }
	if ($output) { return 0 }
	return 1
}

# One-shot map of a single head into origin/<branch> (does not change remote.origin.fetch).
function script:git_fetch_remote_branch($Branch) {
	if (-not (git_valid_branch_name $Branch)) {
		$global:LastExitCode = 1
		return
	}
	invoke_repo_git fetch origin --prune "+refs/heads/${Branch}:refs/remotes/origin/${Branch}"
}

# Return PR number if target names a GitHub pull request (pr/N, pull/N, #N, or github.com/…/pull/N URL); else $null.
function script:git_parse_pr_number($Target) {
	if ([string]::IsNullOrEmpty($Target)) { return $null }
	if ($Target -match '^(?i)pr/([0-9]+)$') { return $Matches[1] }
	if ($Target -match '^(?i)pull/([0-9]+)$') { return $Matches[1] }
	if ($Target -match '^#([0-9]+)$') { return $Matches[1] }
	if ($Target -match '^https?://github\.com/[^/]+/[^/]+/pull/([0-9]+)(?:[/?#].*)?$') { return $Matches[1] }
	return $null
}

# One-shot map of GitHub pull/<n>/head into origin/pr/<n> (does not widen remote.origin.fetch).
function script:git_fetch_pull_request($Pr) {
	if ($Pr -notmatch '^[0-9]+$') {
		$global:LastExitCode = 1
		return
	}
	invoke_repo_git fetch origin --prune "+refs/pull/${Pr}/head:refs/remotes/origin/pr/${Pr}"
}

# Repair a missing/corrupt $FOUNT_DIR repo: init, wire origin, then fetch master
# with CN/KP/RU mirror fallback and a low-speed timeout (mirrors runner's installer).
# Leaves origin pointed at whichever URL actually fetched.
function script:git_supplement_repo {
	$global:LastExitCode = 0
	$urls = @("https://github.com/steve02081504/fount.git")
	if ((Get-Culture).Name -match '-(CN|KP|RU)$') {
		$urls += "https://gh-proxy.org/github.com/steve02081504/fount.git"
		$urls += "https://gitclone.com/github.com/steve02081504/fount.git"
	}
	$hadGit = Test-Path -LiteralPath "$FOUNT_DIR/.git"
	invoke_repo_git init -b master
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git config core.autocrlf false
	if ($LastExitCode -ne 0) { return }
	$originAdded = $false
	foreach ($url in $urls) {
		if ($originAdded) {
			invoke_repo_git remote set-url origin $url
		}
		else {
			invoke_repo_git remote add origin $url
			$originAdded = $true
		}
		invoke_repo_git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=30 fetch origin master --depth 1
		if ($LastExitCode -eq 0) {
			$global:LastExitCode = 0
			return
		}
	}
	# All configured fetches failed: undo the .git this invocation created so the
	# caller can retry the full source sequence on the next run. Never touch a
	# pre-existing repo.
	if (-not $hadGit) {
		Remove-Item -LiteralPath "$FOUNT_DIR/.git" -Recurse -Force -ErrorAction SilentlyContinue
	}
	$global:LastExitCode = 1
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

# Ensure remote.origin.fetch maps refs/heads/<Branch> → origin/<Branch>.
# Adds a single-branch refspec only — never expands to refs/heads/*.
function script:git_ensure_origin_fetch_branch($RemoteBranch) {
	if (-not (git_valid_branch_name $RemoteBranch)) {
		$global:LastExitCode = 1
		return
	}
	$specs = @(invoke_repo_git config --get-all remote.origin.fetch 2>$null)
	if ($LastExitCode -ne 0) { $specs = @() }
	foreach ($spec in $specs) {
		if ($spec -match '^\+?refs/heads/\*:refs/remotes/origin/\*$') { return }
		if ($spec -eq "+refs/heads/${RemoteBranch}:refs/remotes/origin/${RemoteBranch}") { return }
		if ($spec -eq "refs/heads/${RemoteBranch}:refs/remotes/origin/${RemoteBranch}") { return }
	}
	invoke_repo_git config --add remote.origin.fetch "+refs/heads/${RemoteBranch}:refs/remotes/origin/${RemoteBranch}"
}

# Point local branch at origin/<name> without requiring a prior wildcard fetch refspec.
# `git branch --set-upstream-to` rejects one-shot remote-tracking refs under single-branch clones;
# add the one head to remote.origin.fetch (not *) then set branch.*.remote / merge.
function script:git_track_origin_branch($Branch, $OriginRef = $null) {
	if (-not $OriginRef) { $OriginRef = "origin/$Branch" }
	if ($OriginRef -notlike 'origin/*') {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $OriginRef })
		$global:LastExitCode = 1
		return
	}
	$remoteBranch = $OriginRef.Substring('origin/'.Length)
	git_ensure_origin_fetch_branch $remoteBranch
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git config "branch.$Branch.remote" origin
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git config "branch.$Branch.merge" "refs/heads/$remoteBranch"
}

# Switch/create local branch at StartPoint (default origin/<Branch>). Does not move other branches.
function script:git_checkout_branch($Branch, $StartPoint = $null) {
	if (-not $StartPoint) { $StartPoint = "origin/$Branch" }
	if (-not (git_ref_exists $StartPoint)) {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $StartPoint })
		return
	}
	git_backup_uncommitted
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git clean -fd
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git checkout -B $Branch $StartPoint
	if ($LastExitCode -ne 0) { return }
	if ($StartPoint -like 'origin/*') {
		git_track_origin_branch $Branch $StartPoint
	}
}

# Detach HEAD at Ref without moving the previous branch tip.
function script:git_detach_to_ref($Ref) {
	$resolved = invoke_repo_git rev-parse --verify "${Ref}^{commit}" 2>$null
	if ($LastExitCode -ne 0 -or -not $resolved) {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $Ref })
		return
	}
	git_backup_uncommitted
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git clean -fd
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git checkout --detach $resolved
}

function script:fount_resolve_upstream($Branch) {
	$hadUpstream = invoke_repo_git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
	if ($LastExitCode -ne 0) { $hadUpstream = $null }
	git_fetch_remote_branch $Branch
	if ($LastExitCode -eq 0) {
		$script:remoteBranch = "origin/$Branch"
		if (-not $hadUpstream) {
			Write-Warning (Get-I18n -key 'git.noUpstreamBranch' -params @{ branch = $Branch; remote = $script:remoteBranch })
		}
		git_track_origin_branch $Branch $script:remoteBranch
		if ($LastExitCode -ne 0) { return }
		$script:currentBranch = $Branch
		$global:LastExitCode = 0
		return
	}

	$remoteStatus = git_remote_branch_status $Branch
	if ($remoteStatus -eq 2 -or $remoteStatus -eq 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailed')
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		$global:LastExitCode = 1
		return
	}

	if ($Branch -eq 'master') {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = 'origin/master' })
		$global:LastExitCode = 1
		return
	}
	Write-Host (Get-I18n -key 'git.upstreamGoneFallbackMaster' -params @{ branch = $Branch })
	git_fetch_remote_branch 'master'
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailed')
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		$global:LastExitCode = 1
		return
	}
	git_checkout_branch 'master' 'origin/master'
	if ($LastExitCode -ne 0) { return }
	$script:currentBranch = 'master'
	$script:remoteBranch = 'origin/master'
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
		Write-Host (Get-I18n -key 'git.fetchingAndResetting')
		git_supplement_repo
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

	$script:currentBranch = invoke_repo_git rev-parse --abbrev-ref HEAD 2>$null
	if ($LastExitCode -ne 0) { $script:currentBranch = 'HEAD' }
	if ($script:currentBranch -eq 'HEAD') {
		Write-Host (Get-I18n -key 'git.notOnBranch')
		git_fetch_remote_branch 'master'
		if ($LastExitCode -ne 0) {
			Write-Warning (Get-I18n -key 'git.fetchFailed')
			Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
			return
		}
		git_sync_to_ref 'origin/master'
		if ($LastExitCode -ne 0) { return }
		invoke_repo_git checkout master
		$script:currentBranch = 'master'
		$script:remoteBranch = 'origin/master'
	}
	else {
		fount_resolve_upstream $script:currentBranch
		if ($LastExitCode -ne 0) { return }
	}

	if (-not $hasHead -and -not (git_ref_exists)) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}
	if (-not (git_ref_exists $script:remoteBranch)) {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $script:remoteBranch })
		return
	}

	$mergeBase = invoke_repo_git merge-base $script:currentBranch $script:remoteBranch 2>$null
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}
	$localCommit = invoke_repo_git rev-parse $script:currentBranch 2>$null
	if ($LastExitCode -ne 0) {
		Write-Warning (Get-I18n -key 'git.fetchFailedSkippingUpdate')
		return
	}
	$remoteCommit = invoke_repo_git rev-parse $script:remoteBranch 2>$null
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
			invoke_repo_git reset --hard $script:remoteBranch
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
			invoke_repo_git reset --hard $script:remoteBranch
		}
	}
	else {
		Write-Host (Get-I18n -key 'git.alreadyUpToDate')
		if ($status) { Write-Warning (Get-I18n -key 'git.dirtyWorkingDirectory') }
	}
}

# $Kind = version.status.* suffix; $Warn = Write-Warning instead of Write-Host.
function script:fount_print_version_status($Kind, [switch]$Warn) {
	if ($Warn) {
		Write-Warning (Get-I18n -key 'version.status.title' -params @{ status = (Get-I18n -key "version.status.$Kind") })
	}
	else {
		Write-Host (Get-I18n -key 'version.status.title' -params @{ status = (Get-I18n -key "version.status.$Kind") })
	}
}

# $Branch = branch name, or HEAD for detached.
function script:fount_print_version_branch($Branch) {
	if ($Branch -eq 'HEAD') {
		$Branch = Get-I18n -key 'version.branch.detached'
	}
	Write-Host (Get-I18n -key 'version.branch.title' -params @{ branch = $Branch })
}

# Print branch, HEAD commit, and whether the current branch tip matches origin.
function script:fount_show_version {
	$global:LastExitCode = 0
	if (!(Get-Command git -ErrorAction SilentlyContinue)) {
		Write-Warning (Get-I18n -key 'version.noGit')
		$global:LastExitCode = 1
		return
	}
	if (!(Test-Path -LiteralPath "$FOUNT_DIR/.git")) {
		Write-Warning (Get-I18n -key 'version.noRepo')
		$global:LastExitCode = 1
		return
	}

	$branch = invoke_repo_git rev-parse --abbrev-ref HEAD 2>$null
	if ($LastExitCode -ne 0 -or -not $branch) { $branch = 'HEAD' }
	$commitHash = invoke_repo_git rev-parse HEAD 2>$null
	if ($LastExitCode -ne 0 -or -not $commitHash) {
		Write-Warning (Get-I18n -key 'version.noRepo')
		$global:LastExitCode = 1
		return
	}

	fount_print_version_branch $branch
	Write-Host (Get-I18n -key 'version.commit' -params @{ ref = $commitHash })

	if (Test-Path -LiteralPath "$FOUNT_DIR/.noupdate") {
		Write-Host (Get-I18n -key 'version.autoUpdatePaused')
	}

	if ($branch -eq 'HEAD') {
		fount_print_version_status detachedNoCompare
		$global:LastExitCode = 0
		return
	}

	git_fetch_remote_branch $branch
	if ($LastExitCode -ne 0) {
		fount_print_version_status fetchFailed -Warn
		$global:LastExitCode = 1
		return
	}
	$remoteCommitHash = invoke_repo_git rev-parse "origin/$branch" 2>$null
	if ($LastExitCode -ne 0 -or -not $remoteCommitHash) {
		fount_print_version_status fetchFailed -Warn
		$global:LastExitCode = 1
		return
	}
	Write-Host (Get-I18n -key 'version.remote' -params @{ ref = $remoteCommitHash })

	if ($commitHash -eq $remoteCommitHash) {
		fount_print_version_status upToDate
		$global:LastExitCode = 0
		return
	}
	$mergeBase = invoke_repo_git merge-base HEAD "origin/$branch" 2>$null
	if ($LastExitCode -ne 0 -or -not $mergeBase) {
		fount_print_version_status diverged -Warn
		$global:LastExitCode = 0
		return
	}
	if ($mergeBase -eq $commitHash) {
		fount_print_version_status behind -Warn
	}
	elseif ($mergeBase -eq $remoteCommitHash) {
		fount_print_version_status ahead
	}
	else {
		fount_print_version_status diverged -Warn
	}
	$global:LastExitCode = 0
}
