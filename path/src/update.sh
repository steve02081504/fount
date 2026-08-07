#!/usr/bin/env bash
# fount self-update via git + deno upgrade

# Refresh origin/<branch> only. On failure, ls-remote to tell deleted vs network.
# Sets remoteBranch=origin/<branch> on success. Falls back to master when branch is gone.
fount_resolve_upstream() {
	local branch="$1" remote_status had_upstream
	had_upstream=$(invoke_repo_git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null) || had_upstream=
	if git_fetch_remote_branch "$branch"; then
		remoteBranch="origin/$branch"
		if [ -z "$had_upstream" ]; then
			print_i18n_yellow 'git.noUpstreamBranch' 'branch' "$branch" 'remote' "$remoteBranch" >&2
		fi
		invoke_repo_git branch --set-upstream-to "$remoteBranch" "$branch" >/dev/null
		currentBranch="$branch"
		return 0
	fi

	git_remote_branch_status "$branch"
	remote_status=$?
	if [ "$remote_status" -eq 2 ] || [ "$remote_status" -eq 0 ]; then
		# Network error, or exists but fetch failed — never treat as deleted.
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
	if [ ! -d "$FOUNT_DIR/.git" ]; then
		get_i18n 'git.repoNotFound'
		invoke_repo_git init -b master
		invoke_repo_git config core.autocrlf false
		invoke_repo_git remote add origin https://github.com/steve02081504/fount.git || true
		get_i18n 'git.fetchingAndResetting'
		if ! invoke_repo_git fetch origin master --depth 1; then
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

# Foreground fount + deno upgrade.
update_fount_and_deno() {
	if [ -f "$FOUNT_DIR/.noupdate" ]; then
		get_i18n 'update.skippingFountUpdate'
		return
	fi
	fount_upgrade || return
	deno_upgrade
}

# Switch to a remote branch tip (one-shot fetch; does not widen remote.origin.fetch).
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

# Explicit target: branch → track tip & clear .noupdate; commit → detach & create .noupdate.
fount_update_to_ref() {
	local target="$1" commit remote_status
	install_package "git" "git" || return 0
	if git config --global --get-all safe.directory | grep -q -xF "$FOUNT_DIR"; then : else
		git config --global --add safe.directory "$FOUNT_DIR"
	fi
	if [ ! -d "$FOUNT_DIR/.git" ]; then
		get_i18n 'git.repoNotFound'
		invoke_repo_git init -b master
		invoke_repo_git config core.autocrlf false
		invoke_repo_git remote add origin https://github.com/steve02081504/fount.git || true
	fi

	invoke_repo_git config core.autocrlf false

	# Known locally / already tracked — refresh that one tip, no ls-remote.
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

	# Unknown named target — ask origin once, then one-shot fetch if it is a branch.
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

	# Bare ref → FETCH_HEAD; enough to resolve a commit/tag object.
	invoke_repo_git fetch origin "$target" 2>/dev/null || true
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

# After the first successful deno upgrade, routine starts refresh in the background.
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
