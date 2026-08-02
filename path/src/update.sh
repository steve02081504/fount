#!/usr/bin/env bash
# fount self-update via git + deno upgrade

fount_upgrade() {
	install_package "git" "git" || return 0
	if git config --global --get-all safe.directory | grep -q -xF "$FOUNT_DIR"; then : else
		git config --global --add safe.directory "$FOUNT_DIR"
	fi
	if [ ! -d "$FOUNT_DIR/.git" ]; then
		get_i18n 'git.repoNotFound'
		invoke_git_for_fount init -b master
		invoke_git_for_fount config core.autocrlf false
		invoke_git_for_fount remote add origin https://github.com/steve02081504/fount.git || true
		get_i18n 'git.fetchingAndResetting'
		if ! invoke_git_for_fount fetch origin master --depth 1; then
			print_i18n_yellow 'git.fetchFailed' >&2
			print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
			return 1
		fi
		fount_git_sync_to_ref origin/master || return 1
		return 0
	fi

	invoke_git_for_fount config core.autocrlf false
	local has_head=0
	if fount_git_ref_exists HEAD; then has_head=1; fi
	if ! invoke_git_for_fount fetch origin; then
		print_i18n_yellow 'git.fetchFailed' >&2
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi
	if [ "$has_head" -eq 0 ] && ! fount_git_ref_exists HEAD; then
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi

	local currentBranch
	currentBranch=$(invoke_git_for_fount rev-parse --abbrev-ref HEAD 2>/dev/null) || currentBranch=HEAD
	if [ "$currentBranch" = "HEAD" ]; then
		if ! fount_git_ref_exists origin/master; then
			print_i18n_yellow 'git.remoteRefUnavailable' 'ref' 'origin/master' >&2
			return 1
		fi
		get_i18n 'git.notOnBranch'
		fount_git_sync_to_ref origin/master || return 1
		invoke_git_for_fount checkout master
		currentBranch=$(invoke_git_for_fount rev-parse --abbrev-ref HEAD)
	fi

	if ! fount_git_ref_exists HEAD; then
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi

	local remoteBranch candidateRemote
	remoteBranch=$(invoke_git_for_fount rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
	if [ -z "$remoteBranch" ]; then
		candidateRemote="origin/$currentBranch"
		if ! fount_git_ref_exists "$candidateRemote"; then
			print_i18n_yellow 'git.remoteRefUnavailable' 'ref' "$candidateRemote" >&2
			return 1
		fi
		print_i18n_yellow 'git.noUpstreamBranch' 'branch' "$currentBranch" 'remote' "$candidateRemote" >&2
		invoke_git_for_fount branch --set-upstream-to "$candidateRemote" "$currentBranch"
		remoteBranch="$candidateRemote"
	fi
	if ! fount_git_ref_exists "$remoteBranch"; then
		print_i18n_yellow 'git.remoteRefUnavailable' 'ref' "$remoteBranch" >&2
		return 1
	fi

	local git_status
	git_status=$(invoke_git_for_fount status --porcelain)
	local mergeBase localCommit remoteCommit
	mergeBase=$(invoke_git_for_fount merge-base "$currentBranch" "$remoteBranch" 2>/dev/null) || return 1
	localCommit=$(invoke_git_for_fount rev-parse "$currentBranch" 2>/dev/null) || return 1
	remoteCommit=$(invoke_git_for_fount rev-parse "$remoteBranch" 2>/dev/null) || return 1
	if [ "$localCommit" != "$remoteCommit" ]; then
		if [ "$mergeBase" = "$localCommit" ]; then
			get_i18n 'git.updatingFromRemote'
			if [ -n "$git_status" ]; then
				fount_git_backup_uncommitted || return 1
			fi
			invoke_git_for_fount reset --hard "$remoteBranch"
		elif [ "$mergeBase" = "$remoteCommit" ]; then
			get_i18n 'git.localBranchAhead'
			if [ -n "$git_status" ]; then
				print_i18n_yellow 'git.dirtyWorkingDirectory' >&2
			fi
		else
			get_i18n 'git.branchesDiverged'
			if [ -n "$git_status" ]; then
				fount_git_backup_uncommitted || return 1
			fi
			invoke_git_for_fount reset --hard "$remoteBranch"
		fi
	else
		get_i18n 'git.alreadyUpToDate'
		if [ -n "$git_status" ]; then
			print_i18n_yellow 'git.dirtyWorkingDirectory' >&2
		fi
	fi
}

update_fount_and_deno() {
	if [ -f "$FOUNT_DIR/.noupdate" ]; then
		get_i18n 'update.skippingFountUpdate'
	else
		fount_upgrade
		deno_upgrade
	fi
}

