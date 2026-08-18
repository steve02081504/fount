#!/usr/bin/env bash
# fount 自更新的 Git 辅助函数

invoke_repo_git() {
	GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 git -C "$FOUNT_DIR" "$@"
}

git_ref_exists() {
	invoke_repo_git rev-parse --verify "$1" &>/dev/null
}

# 按配置的 refspec 拉取 origin 并清理过期的远端跟踪引用。
# 不扩展到其他分支 —— 具名目标使用 git_fetch_remote_branch。
git_fetch_origin() {
	invoke_repo_git fetch origin --prune
}

# 拒绝 glob 元字符等单分支拉取不安全的片段。
# 与 git check-ref-format 对 refs/heads/<name> 的规则一致（外加撇号）。
git_valid_branch_name() {
	local branch="$1" part
	[[ -n "$branch" && "$branch" != @ ]] || return 1
	case "$branch" in
	*\?*|*\**|*\[*|*\\*|*:*|*~*|*^*|*..*|*[[:cntrl:]]*|*[[:space:]]*|*"'"*) return 1 ;;
	esac
	[[ "$branch" != *'@{'* ]] || return 1
	[[ "$branch" != /* && "$branch" != */ && "$branch" != *//* ]] || return 1
	local IFS='/'
	# shellcheck disable=SC2086 # 有意按 / 做 IFS 拆分
	for part in $branch; do
		[[ -n "$part" && "$part" != .* && "$part" != *.lock ]] || return 1
		[[ "$part" != *. ]] || return 1
	done
	return 0
}

# 0 = 分支在 origin 存在，1 = 确认不存在，2 = 网络/其他错误。
# 仅当本地未知该具名引用时调用 —— 普通更新的顺利路径不要走这里。
git_remote_branch_status() {
	local branch="$1" remote_heads
	git_valid_branch_name "$branch" || return 2
	remote_heads=$(invoke_repo_git ls-remote --heads origin "refs/heads/$branch" 2>/dev/null) || return 2
	[ -n "$remote_heads" ] && return 0
	return 1
}

# 一次性将单个 head 映射到 origin/<branch>（不修改 remote.origin.fetch）。
git_fetch_remote_branch() {
	local branch="$1"
	git_valid_branch_name "$branch" || return 1
	git_fetch_with_fallback "+refs/heads/${branch}:refs/remotes/origin/${branch}"
}

# 若 target 指向 GitHub pull request（pr/N、pull/N、#N 或 github.com/…/pull/N 链接），输出 PR 号；否则返回 1。
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

# 一次性将 GitHub 的 pull/<n>/head 映射到 origin/pr/<n>（不扩展 remote.origin.fetch）。
git_fetch_pull_request() {
	local pr="$1"
	[[ "$pr" =~ ^[0-9]+$ ]] || return 1
	git_fetch_with_fallback "+refs/pull/${pr}/head:refs/remotes/origin/pr/${pr}"
}

# 修复缺失/损坏的 $FOUNT_DIR 仓库：初始化、配置 origin，然后用 CN/KP/RU 镜像回退
# 和低速超时拉取 master（与 runner 安装器一致）。
# 拉取成功后 origin 保留指向实际拉取到的那个 URL。
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
	# 所有配置的拉取都失败了：撤销本次调用创建的 .git，以便下次运行时调用方
	# 可重试完整的源码序列。绝不触碰已存在的仓库。
	if [ "$had_git" -eq 0 ] && [ -n "${FOUNT_DIR:-}" ]; then
		rm -rf "$FOUNT_DIR/.git"
	fi
	return 1
}

# 对 origin 拉取给定的 refspec，为已存在仓库复用 git_supplement_repo 的区域镜像回退
# 和低速超时。当 origin 是已知的 fount URL 时，用 -c http.lowSpeed* 设置依次尝试每个
# 镜像并在结束后恢复原 URL；自定义 origin（fork/自托管）则原样拉取，同样带低速超时，
# 绝不重写。refs 是内容寻址的，因此从镜像拉取对后续读者而言与主源无异。
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

# 确保 remote.origin.fetch 将 refs/heads/<branch> 映射到 origin/<branch>。
# 只添加单分支 refspec —— 绝不扩展为 refs/heads/*。
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

# 将本地分支指向 origin/<name>，无需事先配置通配符拉取 refspec。
# 单分支克隆下 `git branch --set-upstream-to` 会拒绝一次性远端跟踪引用；
# 把该 head 加进 remote.origin.fetch（而非 *），再设置 branch.*.remote / merge。
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

# 在 start_point（默认 origin/<branch>）处切换/创建本地分支。不动其他分支。
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

# 在 ref 处分离 HEAD，不动此前分支的尖端。
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

# $1 = version.status.* 的后缀；$2 = green|yellow|（默认普通 stdout）。
fount_print_version_status() {
	local text color="${2:-}"
	text=$(get_i18n "version.status.$1")
	case "$color" in
	green) print_i18n_green 'version.status.title' 'status' "$text" ;;
	yellow) print_i18n_yellow 'version.status.title' 'status' "$text" >&2 ;;
	*) get_i18n 'version.status.title' 'status' "$text" ;;
	esac
}

# $1 = 分支名，分离状态为 HEAD。
fount_print_version_branch() {
	local text="$1"
	if [ "$text" = "HEAD" ]; then
		text=$(get_i18n 'version.branch.detached')
	fi
	get_i18n 'version.branch.title' 'branch' "$text"
}

# 打印分支、HEAD 提交，以及当前分支尖端是否与 origin 一致。
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

