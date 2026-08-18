#!/usr/bin/env bash
# 通过 git + deno 升级完成 fount 自更新

# 只刷新 origin/<branch>。失败时用 ls-remote 区分已删除与网络问题。
# 成功时设置 remoteBranch=origin/<branch>。分支消失时回退到 master。
fount_resolve_upstream() {
	local branch="$1" remote_status had_upstream
	had_upstream=$(invoke_repo_git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null) || had_upstream=
	if git_fetch_remote_branch "$branch"; then
		remoteBranch="origin/$branch"
		if [ -z "$had_upstream" ]; then
			print_i18n_yellow 'git.noUpstreamBranch' 'branch' "$branch" 'remote' "$remoteBranch" >&2
		fi
		git_track_origin_branch "$branch" "$remoteBranch" || return 1
		currentBranch="$branch"
		return 0
	fi

	git_remote_branch_status "$branch"
	remote_status=$?
	if [ "$remote_status" -eq 2 ] || [ "$remote_status" -eq 0 ]; then
		# 网络错误，或存在但拉取失败 —— 绝不当作已删除。
		print_i18n_yellow 'git.fetchFailed' >&2
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi

	if [ "$branch" = "master" ]; then
		print_i18n_yellow 'git.remoteRefUnavailable' 'ref' 'origin/master' >&2
		return 1
	fi
	get_i18n 'git.upstreamGoneFallbackMaster' 'branch' "$branch"
	if ! git_fetch_remote_branch master; then
		print_i18n_yellow 'git.fetchFailed' >&2
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi
	git_checkout_branch master origin/master || return 1
	currentBranch=master
	remoteBranch=origin/master
}

fount_upgrade() {
	install_package "git" "git" || return 0
	if git config --global --get-all safe.directory | grep -q -xF "$FOUNT_DIR"; then : else
		git config --global --add safe.directory "$FOUNT_DIR"
	fi
	if [ ! -e "$FOUNT_DIR/.git" ]; then
		get_i18n 'git.repoNotFound'
		get_i18n 'git.fetchingAndResetting'
		if ! git_supplement_repo; then
			print_i18n_yellow 'git.fetchFailed' >&2
			print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
			return 1
		fi
		git_sync_to_ref origin/master || return 1
		return 0
	fi

	invoke_repo_git config core.autocrlf false
	local has_head=0
	if git_ref_exists HEAD; then has_head=1; fi

	local currentBranch remoteBranch
	currentBranch=$(invoke_repo_git rev-parse --abbrev-ref HEAD 2>/dev/null) || currentBranch=HEAD
	if [ "$currentBranch" = "HEAD" ]; then
		get_i18n 'git.notOnBranch'
		if ! git_fetch_remote_branch master; then
			print_i18n_yellow 'git.fetchFailed' >&2
			print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
			return 1
		fi
		git_sync_to_ref origin/master || return 1
		invoke_repo_git checkout master
		currentBranch=master
		remoteBranch=origin/master
	else
		fount_resolve_upstream "$currentBranch" || return 1
	fi

	if [ "$has_head" -eq 0 ] && ! git_ref_exists HEAD; then
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi
	if ! git_ref_exists "$remoteBranch"; then
		print_i18n_yellow 'git.remoteRefUnavailable' 'ref' "$remoteBranch" >&2
		return 1
	fi

	local git_status
	git_status=$(invoke_repo_git status --porcelain)
	local mergeBase localCommit remoteCommit
	mergeBase=$(invoke_repo_git merge-base "$currentBranch" "$remoteBranch" 2>/dev/null) || return 1
	localCommit=$(invoke_repo_git rev-parse "$currentBranch" 2>/dev/null) || return 1
	remoteCommit=$(invoke_repo_git rev-parse "$remoteBranch" 2>/dev/null) || return 1
	if [ "$localCommit" != "$remoteCommit" ]; then
		if [ "$mergeBase" = "$localCommit" ]; then
			get_i18n 'git.updatingFromRemote'
			if [ -n "$git_status" ]; then
				git_backup_uncommitted || return 1
			fi
			invoke_repo_git reset --hard "$remoteBranch"
		elif [ "$mergeBase" = "$remoteCommit" ]; then
			get_i18n 'git.localBranchAhead'
			if [ -n "$git_status" ]; then
				print_i18n_yellow 'git.dirtyWorkingDirectory' >&2
			fi
		else
			get_i18n 'git.branchesDiverged'
			if [ -n "$git_status" ]; then
				git_backup_uncommitted || return 1
			fi
			invoke_repo_git reset --hard "$remoteBranch"
		fi
	else
		get_i18n 'git.alreadyUpToDate'
		if [ -n "$git_status" ]; then
			print_i18n_yellow 'git.dirtyWorkingDirectory' >&2
		fi
	fi
}

# 前台执行 fount + deno 升级。
update_fount_and_deno() {
	if [ -f "$FOUNT_DIR/.noupdate" ]; then
		get_i18n 'update.skippingFountUpdate'
		return
	fi
	fount_upgrade || return
	deno_upgrade
}

# 切换到远端分支尖端（一次性拉取；不扩展 remote.origin.fetch）。
fount_switch_to_branch() {
	local target="$1"
	get_i18n 'update.switchingToBranch' 'branch' "$target"
	git_fetch_remote_branch "$target" || return 1
	git_checkout_branch "$target" "origin/$target" || return 1
	if [ -f "$FOUNT_DIR/.noupdate" ]; then
		rm -f "$FOUNT_DIR/.noupdate"
		get_i18n 'update.removedNoUpdate'
	fi
}

# 显式目标：PR → 分离到 head 并写 .noupdate；分支 → 跟踪尖端并清除 .noupdate；提交 → 分离并写 .noupdate。
fount_update_to_ref() {
	local target="$1" commit remote_status pr_number
	install_package "git" "git" || return 0
	if git config --global --get-all safe.directory | grep -q -xF "$FOUNT_DIR"; then : else
		git config --global --add safe.directory "$FOUNT_DIR"
	fi
	if [ ! -e "$FOUNT_DIR/.git" ]; then
		get_i18n 'git.repoNotFound'
		if ! git_supplement_repo; then
			print_i18n_yellow 'git.fetchFailed' >&2
			print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
			return 1
		fi
	fi

	invoke_repo_git config core.autocrlf false

	# GitHub pull request 尖端 —— 像提交一样固定（重复运行同一命令即可刷新）。
	if pr_number=$(git_parse_pr_number "$target"); then
		get_i18n 'update.pinningToPullRequest' 'pr' "$pr_number"
		if ! git_fetch_pull_request "$pr_number"; then
			print_i18n_yellow 'git.fetchFailed' >&2
			print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
			return 1
		fi
		git_detach_to_ref "origin/pr/$pr_number" || return 1
		: >"$FOUNT_DIR/.noupdate"
		get_i18n 'update.createdNoUpdate'
		deno_upgrade
		return
	fi

	# 远程 URL —— 把 origin 指到该远程并切到其默认分支。
	if git_is_remote_url "$target"; then
		fount_update_to_url "$target"
		return
	fi

	# 本地已知/已跟踪 —— 只刷新那一个尖端，不做 ls-remote。
	if git_ref_exists "origin/$target" || git_ref_exists "refs/heads/$target"; then
		if git_ref_exists "origin/$target"; then
			fount_switch_to_branch "$target" || return 1
			deno_upgrade
			return
		fi
		get_i18n 'update.switchingToBranch' 'branch' "$target"
		git_backup_uncommitted || return 1
		invoke_repo_git checkout "$target" || return 1
		if [ -f "$FOUNT_DIR/.noupdate" ]; then
			rm -f "$FOUNT_DIR/.noupdate"
			get_i18n 'update.removedNoUpdate'
		fi
		fount_upgrade || return
		deno_upgrade
		return
	fi

	# 未知具名目标 —— 先询问 origin 一次，若是分支再做一次性拉取。
	git_remote_branch_status "$target"
	remote_status=$?
	if [ "$remote_status" -eq 2 ]; then
		print_i18n_yellow 'git.fetchFailed' >&2
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi
	if [ "$remote_status" -eq 0 ]; then
		fount_switch_to_branch "$target" || return 1
		deno_upgrade
		return
	fi

	# 裸 ref → FETCH_HEAD；足以解析一个 commit/tag 对象。
	git_fetch_with_fallback "$target" 2>/dev/null || true
	commit=$(invoke_repo_git rev-parse --verify "${target}^{commit}" 2>/dev/null) || {
		print_i18n_yellow 'update.unknownTarget' 'target' "$target" >&2
		return 1
	}

	get_i18n 'update.pinningToCommit' 'ref' "$commit"
	git_detach_to_ref "$commit" || return 1
	: >"$FOUNT_DIR/.noupdate"
	get_i18n 'update.createdNoUpdate'
	deno_upgrade
}

# `fount update <remote-url>` —— 把 origin 指到该远程并切到其默认分支（随后普通更新跟随它）。
fount_update_to_url() {
	local url="$1" default_branch symref
	if invoke_repo_git remote | grep -qx origin; then
		if ! invoke_repo_git remote set-url origin "$url"; then
			print_i18n_yellow 'git.fetchFailed' >&2
			return 1
		fi
	else
		if ! invoke_repo_git remote add origin "$url"; then
			print_i18n_yellow 'git.fetchFailed' >&2
			return 1
		fi
	fi
	symref=$(invoke_repo_git ls-remote --symref "$url" HEAD 2>/dev/null) || {
		print_i18n_yellow 'git.fetchFailed' >&2
		return 1
	}
	default_branch=$(printf '%s\n' "$symref" | sed -n 's/^ref: refs\/heads\///p' | head -n 1)
	[ -z "$default_branch" ] && default_branch=master
	get_i18n 'update.switchingToRemote' 'url' "$url" 'branch' "$default_branch"
	fount_switch_to_branch "$default_branch" || return 1
	deno_upgrade
}

# 首次成功升级 deno 后，例程改为在后台刷新。
update_fount_and_deno_background() {
	if [ -f "$FOUNT_DIR/.noupdate" ]; then
		get_i18n 'update.skippingFountUpdate'
		return
	fi
	local upgraded_flag="$FOUNT_DIR/data/installer/deno_upgraded"
	if [ -f "$upgraded_flag" ]; then
		( update_fount_and_deno ) &
		return
	fi
	update_fount_and_deno
}
