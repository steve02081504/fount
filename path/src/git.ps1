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

# 按配置的 refspec 拉取 origin 并清理过期的远端跟踪引用。
# 不扩展到其他分支 —— 具名目标使用 git_fetch_remote_branch。
function script:git_fetch_origin {
	invoke_repo_git fetch origin --prune
}

# 拒绝 glob 元字符等单分支拉取不安全的片段。
# 与 git check-ref-format 对 refs/heads/<name> 的规则一致（外加撇号）。
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

# 0 = 分支在 origin 存在，1 = 确认不存在，2 = 网络/其他错误。
# 仅当本地未知该具名引用时调用 —— 普通更新的顺利路径不要走这里。
function script:git_remote_branch_status($Branch) {
	if (-not (git_valid_branch_name $Branch)) { return 2 }
	$output = invoke_repo_git ls-remote --heads origin "refs/heads/$Branch" 2>$null
	if ($LastExitCode -ne 0) { return 2 }
	if ($output) { return 0 }
	return 1
}

# 一次性将单个 head 映射到 origin/<branch>（不修改 remote.origin.fetch）。
function script:git_fetch_remote_branch($Branch) {
	if (-not (git_valid_branch_name $Branch)) {
		$global:LastExitCode = 1
		return
	}
	git_fetch_with_fallback "+refs/heads/${Branch}:refs/remotes/origin/${Branch}"
}

# 若 target 指向 GitHub pull request（pr/N、pull/N、#N 或 github.com/…/pull/N 链接），返回 PR 号；否则返回 $null。
function script:git_parse_pr_number($Target) {
	if ([string]::IsNullOrEmpty($Target)) { return $null }
	if ($Target -match '^(?i)pr/([0-9]+)$') { return $Matches[1] }
	if ($Target -match '^(?i)pull/([0-9]+)$') { return $Matches[1] }
	if ($Target -match '^#([0-9]+)$') { return $Matches[1] }
	if ($Target -match '^https?://github\.com/[^/]+/[^/]+/pull/([0-9]+)(?:[/?#].*)?$') { return $Matches[1] }
	return $null
}

# 检测是否为远程 URL（http(s)/ssh/git/ftp/file 协议，或 scp-like 的 user@host:path）。
function script:git_is_remote_url($Target) {
	if ([string]::IsNullOrEmpty($Target)) { return $false }
	if ($Target -match '^(?i)(https?|ssh|git\+ssh|git|ftp|file)://') { return $true }
	if ($Target -match '^[^/:]+@[^/:]+:') { return $true }
	return $false
}

# 一次性将 GitHub 的 pull/<n>/head 映射到 origin/pr/<n>（不扩展 remote.origin.fetch）。
function script:git_fetch_pull_request($Pr) {
	if ($Pr -notmatch '^[0-9]+$') {
		$global:LastExitCode = 1
		return
	}
	git_fetch_with_fallback "+refs/pull/${Pr}/head:refs/remotes/origin/pr/${Pr}"
}

# 修复缺失/损坏的 $FOUNT_DIR 仓库：初始化、配置 origin，然后用 CN/KP/RU 镜像回退
# 和低速超时拉取 master（与 runner 安装器一致）。
# 拉取成功后 origin 保留指向实际拉取到的那个 URL。
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
	# 所有配置的拉取都失败了：撤销本次调用创建的 .git，以便下次运行时调用方
	# 可重试完整的源码序列。绝不触碰已存在的仓库。
	if (-not $hadGit) {
		Remove-Item -LiteralPath "$FOUNT_DIR/.git" -Recurse -Force -ErrorAction SilentlyContinue
	}
	$global:LastExitCode = 1
}

# 对 origin 拉取给定的 refspec，为已存在仓库复用 git_supplement_repo 的区域镜像回退
# 和低速超时。用 -c http.lowSpeed* 和 -c remote.origin.url 依次尝试每个候选 URL（origin、
# 主库及各镜像）而不改动配置；自定义 origin（fork/自托管）也以主库兜底。refs 是内容寻址的，
# 因此从镜像拉取对后续读者而言与主源无异。
function script:git_fetch_with_fallback {
	$originUrl = invoke_repo_git config --get remote.origin.url 2>$null
	if ($LastExitCode -ne 0) { $originUrl = $null }
	$candidates = @($originUrl, 'https://github.com/steve02081504/fount.git')
	if ((Get-Culture).Name -match '-(CN|KP|RU)$') {
		$candidates += @(
			'https://gh-proxy.org/github.com/steve02081504/fount.git',
			'https://gitclone.com/github.com/steve02081504/fount.git'
		)
	}
	$candidates = $candidates | Select-Object -Unique
	foreach ($url in $candidates) {
		invoke_repo_git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=30 -c "remote.origin.url=$url" fetch origin --prune @args
		if ($LastExitCode -eq 0) {
			$global:LastExitCode = 0
			return
		}
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
	# 先 reset 再 clean：ZIP 解压后工作树里已存在的 tracked 文件此时尚未入 index，
	# 若先 clean 会被当作 untracked 删除（如 .esh/ 目录删除失败还会陷入反复确认）。
	invoke_repo_git reset --hard $Ref
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git clean -fd
}

# 确保 remote.origin.fetch 将 refs/heads/<Branch> 映射到 origin/<Branch>。
# 只添加单分支 refspec —— 绝不扩展为 refs/heads/*。
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

# 将本地分支指向 origin/<name>，无需事先配置通配符拉取 refspec。
# 单分支克隆下 `git branch --set-upstream-to` 会拒绝一次性远端跟踪引用；
# 把该 head 加进 remote.origin.fetch（而非 *），再设置 branch.*.remote / merge。
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

# 在 StartPoint（默认 origin/<Branch>）处切换/创建本地分支。不动其他分支。
function script:git_checkout_branch($Branch, $StartPoint = $null) {
	if (-not $StartPoint) { $StartPoint = "origin/$Branch" }
	if (-not (git_ref_exists $StartPoint)) {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $StartPoint })
		return
	}
	git_backup_uncommitted
	if ($LastExitCode -ne 0) { return }
	# 先 checkout 再 clean：同 git_sync_to_ref，避免把已存在但未入 index 的 tracked 文件清掉。
	# -f 覆盖工作树里与新 ref 冲突的 untracked 文件（其内容已由 git_backup_uncommitted 备份）。
	invoke_repo_git checkout -f -B $Branch $StartPoint
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git clean -fd
	if ($LastExitCode -ne 0) { return }
	if ($StartPoint -like 'origin/*') {
		git_track_origin_branch $Branch $StartPoint
	}
}

# 在 Ref 处分离 HEAD，不动此前分支的尖端。
function script:git_detach_to_ref($Ref) {
	$resolved = invoke_repo_git rev-parse --verify "${Ref}^{commit}" 2>$null
	if ($LastExitCode -ne 0 -or -not $resolved) {
		Write-Warning (Get-I18n -key 'git.remoteRefUnavailable' -params @{ ref = $Ref })
		return
	}
	git_backup_uncommitted
	if ($LastExitCode -ne 0) { return }
	# 先 checkout 再 clean：同 git_sync_to_ref / git_checkout_branch。
	invoke_repo_git checkout --detach -f $resolved
	if ($LastExitCode -ne 0) { return }
	invoke_repo_git clean -fd
	if ($LastExitCode -ne 0) { return }
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

# $Kind = version.status.* 的后缀；$Warn = 用 Write-Warning 而非 Write-Host。
function script:fount_print_version_status($Kind, [switch]$Warn) {
	if ($Warn) {
		Write-Warning (Get-I18n -key 'version.status.title' -params @{ status = (Get-I18n -key "version.status.$Kind") })
	}
	else {
		Write-Host (Get-I18n -key 'version.status.title' -params @{ status = (Get-I18n -key "version.status.$Kind") })
	}
}

# $Branch = 分支名，分离状态为 HEAD。
function script:fount_print_version_branch($Branch) {
	if ($Branch -eq 'HEAD') {
		$Branch = Get-I18n -key 'version.branch.detached'
	}
	Write-Host (Get-I18n -key 'version.branch.title' -params @{ branch = $Branch })
}

# 打印分支、HEAD 提交，以及当前分支尖端是否与 origin 一致。
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
