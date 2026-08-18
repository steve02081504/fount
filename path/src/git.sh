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
	git_fetch_with_fallback "+refs/heads/${branch}:refs/remotes/origin/${branch}"
}

# Echo PR number if target names a GitHub pull request (pr/N, pull/N, #N, or github.com/…/pull/N URL); else return 1.
git_parse_pr_number() {
	local target="$1" number=
	[[ -n "$target" ]] || return 1
	if [[ "$target" =~ ^[Pp][Rr]/([0-9]+)$ ]]; then
		number="${BASH_REMATCH[1]}"
	elif [[ "$target" =~ ^[Pp][Uu][Ll][Ll]/([0-9]+)$ ]]; then
		number="${BASH_REMATCH[1]}"
	elif [[ "$target" =~ ^#([0-9]+)$ ]]; then
		number="${BASH_REMATCH[1]}"
	elif [[ "$target" =~ ^https?://github\.com/[^/]+/[^/]+/pull/([0-9]+)([/?#].*)?$ ]]; then
		number="${BASH_REMATCH[1]}"
	else
		return 1
	fi
	printf '%s\n' "$number"
}

# One-shot map of GitHub pull/<n>/head into origin/pr/<n> (does not widen remote.origin.fetch).
git_fetch_pull_request() {
	local pr="$1"
	[[ "$pr" =~ ^[0-9]+$ ]] || return 1
	git_fetch_with_fallback "+refs/pull/${pr}/head:refs/remotes/origin/pr/${pr}"
}

# Repair a missing/corrupt $FOUNT_DIR repo: init, wire origin, then fetch master
# with CN/KP/RU mirror fallback and a low-speed timeout (mirrors runner's installer).
# Leaves origin pointed at whichever URL actually fetched.
git_supplement_repo() {
	local urls=("https://github.com/steve02081504/fount.git") origin_added=0 url
	if [[ "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" =~ _(CN|KP|RU)(\.|@|$) ]]; then
		urls+=("https://gh-proxy.org/github.com/steve02081504/fount.git" "https://gitclone.com/github.com/steve02081504/fount.git")
	fi
	local had_git=0
	if [ -n "${FOUNT_DIR:-}" ] && [ -e "$FOUNT_DIR/.git" ]; then had_git=1; fi
	invoke_repo_git init -b master || return 1
	invoke_repo_git config core.autocrlf false || return 1
	for url in "${urls[@]}"; do
		if [ "$origin_added" -eq 0 ]; then
			invoke_repo_git remote add origin "$url" || return 1
			origin_added=1
		else
			invoke_repo_git remote set-url origin "$url" || continue
		fi
		if invoke_repo_git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=30 fetch origin master --depth 1; then
			return 0
		fi
	done
	# All configured fetches failed: undo the .git this invocation created so the
	# caller can retry the full source sequence on the next run. Never touch a
	# pre-existing repo.
	if [ "$had_git" -eq 0 ] && [ -n "${FOUNT_DIR:-}" ]; then
		rm -rf "$FOUNT_DIR/.git"
	fi
	return 1
}

# Fetch the given refspec(s) against origin, reusing git_supplement_repo's regional
# mirror fallback and low-speed timeout for existing repos. When origin is one of the
# known fount URLs, try each mirror in turn with -c http.lowSpeed* settings and restore
# the original URL afterward; a custom origin (fork/self-hosted) is fetched as-is with
# the same low-speed timeout, never rewritten. Refs are content-addressed, so fetching
# from a mirror is indistinguishable to later readers.
git_fetch_with_fallback() {
	local origin_url url
	origin_url=$(invoke_repo_git config --get remote.origin.url 2>/dev/null) || origin_url=
	case "$origin_url" in
	https://github.com/steve02081504/fount.git|https://gh-proxy.org/github.com/steve02081504/fount.git|https://gitclone.com/github.com/steve02081504/fount.git)
		local candidates=("$origin_url" "https://github.com/steve02081504/fount.git")
		if [[ "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" =~ _(CN|KP|RU)(\.|@|$) ]]; then
			candidates+=("https://gh-proxy.org/github.com/steve02081504/fount.git" "https://gitclone.com/github.com/steve02081504/fount.git")
		fi
		for url in "${candidates[@]}"; do
			if [ "$url" != "$origin_url" ]; then
				invoke_repo_git remote set-url origin "$url" || continue
			fi
			if invoke_repo_git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=30 fetch origin --prune "$@"; then
				if [ "$url" != "$origin_url" ]; then
					invoke_repo_git remote set-url origin "$origin_url"
				fi
				return 0
			fi
		done
		invoke_repo_git remote set-url origin "$origin_url"
		return 1
		;;
	esac
	invoke_repo_git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=30 fetch origin --prune "$@"
}

git_backup_uncommitted() {
	command -v git &>/dev/null || return 0
	[ -e "$FOUNT_DIR/.git" ] || return 0
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

# Ensure remote.origin.fetch maps refs/heads/<branch> → origin/<branch>.
# Adds a single-branch refspec only — never expands to refs/heads/*.
git_ensure_origin_fetch_branch() {
	local remote_branch="$1" specs
	git_valid_branch_name "$remote_branch" || return 1
	specs=$(invoke_repo_git config --get-all remote.origin.fetch 2>/dev/null) || specs=
	if printf '%s\n' "$specs" | grep -qE '^(\+)?refs/heads/\*:refs/remotes/origin/\*$'; then
		return 0
	fi
	if printf '%s\n' "$specs" | grep -qxF "+refs/heads/${remote_branch}:refs/remotes/origin/${remote_branch}"; then
		return 0
	fi
	if printf '%s\n' "$specs" | grep -qxF "refs/heads/${remote_branch}:refs/remotes/origin/${remote_branch}"; then
		return 0
	fi
	invoke_repo_git config --add remote.origin.fetch "+refs/heads/${remote_branch}:refs/remotes/origin/${remote_branch}"
}

# Point local branch at origin/<name> without requiring a prior wildcard fetch refspec.
# `git branch --set-upstream-to` rejects one-shot remote-tracking refs under single-branch clones;
# add the one head to remote.origin.fetch (not *) then set branch.*.remote / merge.
git_track_origin_branch() {
	local branch="$1"
	local origin_ref="${2:-origin/$branch}"
	local remote_branch
	case "$origin_ref" in
	origin/*) remote_branch="${origin_ref#origin/}" ;;
	*)
		print_i18n_yellow 'git.remoteRefUnavailable' 'ref' "$origin_ref" >&2
		return 1
		;;
	esac
	git_ensure_origin_fetch_branch "$remote_branch" || return 1
	invoke_repo_git config "branch.${branch}.remote" origin || return 1
	invoke_repo_git config "branch.${branch}.merge" "refs/heads/${remote_branch}"
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
	origin/*) git_track_origin_branch "$branch" "$start_point" || return 1 ;;
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

# $1 = version.status.* suffix; $2 = green|yellow| (default plain stdout).
fount_print_version_status() {
	local text color="${2:-}"
	text=$(get_i18n "version.status.$1")
	case "$color" in
	green) print_i18n_green 'version.status.title' 'status' "$text" ;;
	yellow) print_i18n_yellow 'version.status.title' 'status' "$text" >&2 ;;
	*) get_i18n 'version.status.title' 'status' "$text" ;;
	esac
}

# $1 = branch name, or HEAD for detached.
fount_print_version_branch() {
	local text="$1"
	if [ "$text" = "HEAD" ]; then
		text=$(get_i18n 'version.branch.detached')
	fi
	get_i18n 'version.branch.title' 'branch' "$text"
}

# Print branch, HEAD commit, and whether the current branch tip matches origin.
fount_show_version() {
	local branch commit_hash remote_commit_hash merge_base
	if ! command -v git &>/dev/null; then
		print_i18n_yellow 'version.noGit' >&2
		return 1
	fi
	if [ ! -e "$FOUNT_DIR/.git" ]; then
		print_i18n_yellow 'version.noRepo' >&2
		return 1
	fi

	branch=$(invoke_repo_git rev-parse --abbrev-ref HEAD 2>/dev/null) || branch=HEAD
	commit_hash=$(invoke_repo_git rev-parse HEAD 2>/dev/null) || {
		print_i18n_yellow 'version.noRepo' >&2
		return 1
	}

	fount_print_version_branch "$branch"
	get_i18n 'version.commit' 'ref' "$commit_hash"

	if [ -f "$FOUNT_DIR/.noupdate" ]; then
		get_i18n 'version.autoUpdatePaused'
	fi

	if [ "$branch" = "HEAD" ]; then
		fount_print_version_status detachedNoCompare
		return 0
	fi

	if ! git_fetch_remote_branch "$branch"; then
		fount_print_version_status fetchFailed yellow
		return 1
	fi
	remote_commit_hash=$(invoke_repo_git rev-parse "origin/$branch" 2>/dev/null) || {
		fount_print_version_status fetchFailed yellow
		return 1
	}
	get_i18n 'version.remote' 'ref' "$remote_commit_hash"

	if [ "$commit_hash" = "$remote_commit_hash" ]; then
		fount_print_version_status upToDate green
		return 0
	fi
	merge_base=$(invoke_repo_git merge-base HEAD "origin/$branch" 2>/dev/null) || {
		fount_print_version_status diverged yellow
		return 0
	}
	if [ "$merge_base" = "$commit_hash" ]; then
		fount_print_version_status behind yellow
	elif [ "$merge_base" = "$remote_commit_hash" ]; then
		fount_print_version_status ahead
	else
		fount_print_version_status diverged yellow
	fi
}

