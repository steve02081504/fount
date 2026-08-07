#!/usr/bin/env bash
# Git helpers for fount self-update

invoke_repo_git() {
	GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 git -C "$FOUNT_DIR" "$@"
}

git_ref_exists() {
	invoke_repo_git rev-parse --verify "$1" &>/dev/null
}

# Fetch origin and drop stale remote-tracking refs under the configured refspec.
# Does not widen fetch to other branches — named targets use git_fetch_remote_branch.
git_fetch_origin() {
	invoke_repo_git fetch origin --prune
}

# Reject glob metacharacters and other ref-unsafe fragments for single-branch fetch.
# Aligns with git check-ref-format rules for refs/heads/<name> (plus apostrophe).
git_valid_branch_name() {
	local branch="$1" part
	[[ -n "$branch" && "$branch" != @ ]] || return 1
	case "$branch" in
	*\?*|*\**|*\[*|*\\*|*:*|*~*|*^*|*..*|*[[:cntrl:]]*|*[[:space:]]*|*"'"*) return 1 ;;
	esac
	[[ "$branch" != *'@{'* ]] || return 1
	[[ "$branch" != /* && "$branch" != */ && "$branch" != *//* ]] || return 1
	local IFS='/'
	# shellcheck disable=SC2086 # intentional IFS split on /
	for part in $branch; do
		[[ -n "$part" && "$part" != .* && "$part" != *.lock ]] || return 1
		[[ "$part" != *. ]] || return 1
	done
	return 0
}

# 0 = branch exists on origin, 1 = confirmed absent, 2 = network/other error.
# Only call when a named ref is unknown locally — avoid on the plain-update happy path.
git_remote_branch_status() {
	local branch="$1" remote_heads
	git_valid_branch_name "$branch" || return 2
	remote_heads=$(invoke_repo_git ls-remote --heads origin "refs/heads/$branch" 2>/dev/null) || return 2
	[ -n "$remote_heads" ] && return 0
	return 1
}

# One-shot map of a single head into origin/<branch> (does not change remote.origin.fetch).
git_fetch_remote_branch() {
	local branch="$1"
	git_valid_branch_name "$branch" || return 1
	invoke_repo_git fetch origin --prune "+refs/heads/${branch}:refs/remotes/origin/${branch}"
}

git_backup_uncommitted() {
	command -v git &>/dev/null || return 0
	[ -d "$FOUNT_DIR/.git" ] || return 0
	if [ -z "$(invoke_repo_git status --porcelain)" ]; then
		return 0
	fi

	local timestamp
	timestamp=$(date +'%Y%m%d_%H%M%S')
	local tmp_base="${TMPDIR:-/tmp}"
	local diff_file_path="$tmp_base/fount-local-changes-diff_$timestamp.diff"

	invoke_repo_git add -A || return 1
	if ! invoke_repo_git diff --cached >"$diff_file_path"; then
		return 1
	fi
	if git_ref_exists HEAD; then
		invoke_repo_git reset HEAD || return 1
	else
		invoke_repo_git reset || return 1
	fi

	print_i18n_yellow 'git.localChangesDetected'
	print_i18n_green 'git.backupSavedTo' 'path' "$diff_file_path"
}

git_sync_to_ref() {
	local ref="$1"
	if ! git_ref_exists "$ref"; then
		print_i18n_yellow 'git.remoteRefUnavailable' 'ref' "$ref" >&2
		return 1
	fi
	git_backup_uncommitted || return 1
	invoke_repo_git clean -fd || return 1
	invoke_repo_git reset --hard "$ref"
}

# Switch/create local branch at start_point (default origin/<branch>). Does not move other branches.
git_checkout_branch() {
	local branch="$1"
	local start_point="${2:-origin/$branch}"
	if ! git_ref_exists "$start_point"; then
		print_i18n_yellow 'git.remoteRefUnavailable' 'ref' "$start_point" >&2
		return 1
	fi
	git_backup_uncommitted || return 1
	invoke_repo_git clean -fd || return 1
	invoke_repo_git checkout -B "$branch" "$start_point" || return 1
	case "$start_point" in
	origin/*) invoke_repo_git branch --set-upstream-to "$start_point" "$branch" >/dev/null ;;
	esac
}

# Detach HEAD at ref without moving the previous branch tip.
git_detach_to_ref() {
	local ref="$1" resolved
	resolved=$(invoke_repo_git rev-parse --verify "${ref}^{commit}" 2>/dev/null) || {
		print_i18n_yellow 'git.remoteRefUnavailable' 'ref' "$ref" >&2
		return 1
	}
	git_backup_uncommitted || return 1
	invoke_repo_git clean -fd || return 1
	invoke_repo_git checkout --detach "$resolved"
}

git_reset_and_clean() {
	command -v git &>/dev/null || return 0
	invoke_repo_git config core.autocrlf false
	local has_head=0 fetch_ok=0
	if git_ref_exists HEAD; then has_head=1; fi
	if git_fetch_origin; then fetch_ok=1; fi
	if ! git_ref_exists origin/master; then
		if [ "$fetch_ok" -eq 0 ]; then
			print_i18n_yellow 'git.fetchFailed' >&2
			print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		fi
		return 1
	fi
	if [ "$has_head" -eq 0 ] && [ "$fetch_ok" -eq 0 ]; then
		print_i18n_yellow 'git.fetchFailed' >&2
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi
	if [ "$fetch_ok" -eq 0 ]; then
		print_i18n_yellow 'git.fetchFailed' >&2
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi
	if git_sync_to_ref origin/master; then
		invoke_repo_git gc --aggressive --prune=now --force
	fi
}

