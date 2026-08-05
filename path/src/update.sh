#!/usr/bin/env bash
# fount self-update via git + deno upgrade

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
	if ! invoke_repo_git fetch origin; then
		print_i18n_yellow 'git.fetchFailed' >&2
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi
	if [ "$has_head" -eq 0 ] && ! git_ref_exists HEAD; then
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi

	local currentBranch
	currentBranch=$(invoke_repo_git rev-parse --abbrev-ref HEAD 2>/dev/null) || currentBranch=HEAD
	if [ "$currentBranch" = "HEAD" ]; then
		if ! git_ref_exists origin/master; then
			print_i18n_yellow 'git.remoteRefUnavailable' 'ref' 'origin/master' >&2
			return 1
		fi
		get_i18n 'git.notOnBranch'
		git_sync_to_ref origin/master || return 1
		invoke_repo_git checkout master
		currentBranch=$(invoke_repo_git rev-parse --abbrev-ref HEAD)
	fi

	if ! git_ref_exists HEAD; then
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi

	local remoteBranch candidateRemote
	remoteBranch=$(invoke_repo_git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
	if [ -z "$remoteBranch" ]; then
		candidateRemote="origin/$currentBranch"
		if ! git_ref_exists "$candidateRemote"; then
			print_i18n_yellow 'git.remoteRefUnavailable' 'ref' "$candidateRemote" >&2
			return 1
		fi
		print_i18n_yellow 'git.noUpstreamBranch' 'branch' "$currentBranch" 'remote' "$candidateRemote" >&2
		invoke_repo_git branch --set-upstream-to "$candidateRemote" "$currentBranch"
		remoteBranch="$candidateRemote"
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

# Explicit target: branch → track tip & clear .noupdate; commit → detach & create .noupdate.
fount_update_to_ref() {
	local target="$1" remote_ref commit
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
	if ! invoke_repo_git fetch origin; then
		print_i18n_yellow 'git.fetchFailed' >&2
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi
	# Shallow / odd tips: also ask origin for the named ref or object.
	invoke_repo_git fetch origin "$target" 2>/dev/null || true

	remote_ref="origin/$target"
	if git_ref_exists "$remote_ref" || git_ref_exists "refs/heads/$target"; then
		get_i18n 'update.switchingToBranch' 'branch' "$target"
		if git_ref_exists "$remote_ref"; then
			git_checkout_branch "$target" "$remote_ref" || return 1
		else
			git_backup_uncommitted || return 1
			invoke_repo_git checkout "$target" || return 1
		fi
		if [ -f "$FOUNT_DIR/.noupdate" ]; then
			rm -f "$FOUNT_DIR/.noupdate"
			get_i18n 'update.removedNoUpdate'
		fi
		fount_upgrade
		deno_upgrade
		return 0
	fi

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
