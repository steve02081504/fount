/** 安装器目标保护 + 暂存安装在所有 bash 平台统一生效；EULA 拒绝仍移除安装。 */
/* global Deno */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const shellSource = readFileSync(new URL('../../src/runner/main.sh', import.meta.url), 'utf8')
const shellTargetCheck = shellSource.match(/FOUNT_EXISTING_INSTALL=0[\s\S]*?existing files were left untouched\." >&2\n\texit 1\nfi\n/)?.[0]
if (!shellTargetCheck) throw new Error('target-check block not found in src/runner/main.sh')
const shellInstall = shellSource.match(/install_fount_tree\(\) \{[\s\S]*?\n\}/)?.[0]
if (!shellInstall) throw new Error('install_fount_tree function not found in src/runner/main.sh')

/**
 * 只执行选定函数与目标检查，禁用环境启动脚本。
 * @param {string} script 要执行的 Bash 代码。
 * @param {import('node:child_process').SpawnSyncOptions} options 工作目录与环境覆盖。
 * @returns {import('node:child_process').SpawnSyncReturns<string>} 子进程退出状态与输出。
 */
function runBash(script, options = {}) {
	return spawnSync('bash', ['--noprofile', '--norc', '-c', `OSTYPE=linux-gnu\n${script}`], {
		encoding: 'utf8',
		...options,
		env: { ...process.env, BASH_ENV: '', ...options.env },
	})
}

/**
 * Bash 行为用例仅在 Unix 运行。
 * @param {string} name 用例名称。
 * @param {() => void | Promise<void>} test 用例逻辑。
 * @returns {void} 注册测试。
 */
function bashTest(name, test) {
	Deno.test({ name, fn: test, ignore: Deno.build.os === 'windows' })
}

bashTest('an existing installation is reused when its launcher is missing from PATH', () => {
	const workingDirectory = join(repositoryRoot, 'path/src')
	const before = statSync(workingDirectory).ino
	const result = runBash(`
PATH=/nonexistent
${shellTargetCheck}
printf 'existing:%s\\n' "$FOUNT_EXISTING_INSTALL"
pwd -P
`, { cwd: workingDirectory, env: { FOUNT_DIR: repositoryRoot } })
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.stdout, `existing:1\n${workingDirectory}\n`)
	assert.equal(statSync(workingDirectory).ino, before)
	assert.match(shellSource, /if \[ "\$FOUNT_EXISTING_INSTALL" -eq 1 \]; then[\s\S]*import_fount_locale/)
})

for (const descendant of ['', 'src'])
	bashTest(`an occupied unknown target preserves files and caller cwd (${descendant || 'root'})`, () => {
		const target = join(repositoryRoot, 'path')
		const workingDirectory = join(target, descendant)
		const sentinel = join(target, 'fount.sh')
		const contents = readFileSync(sentinel, 'utf8')
		const before = statSync(workingDirectory).ino
		const result = runBash(shellTargetCheck, { cwd: workingDirectory, env: { FOUNT_DIR: target } })
		assert.equal(result.status, 1)
		assert.match(result.stderr, /existing files were left untouched/)
		assert.equal(readFileSync(sentinel, 'utf8'), contents)
		assert.equal(statSync(workingDirectory).ino, before)
	})

bashTest('an absent target is classified as a fresh install without creating it', () => {
	const target = join(repositoryRoot, `.missing-install-${process.pid}`, 'fount')
	assert.equal(existsSync(dirname(target)), false)
	const result = runBash(`${shellTargetCheck}\nprintf 'existing:%s\\n' "$FOUNT_EXISTING_INSTALL"`, { env: { FOUNT_DIR: target } })
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.stdout, 'existing:0\n')
	assert.equal(existsSync(dirname(target)), false)
})

bashTest('a target below a regular file is rejected before installation', () => {
	const target = join(repositoryRoot, 'run.sh', 'fount')
	const result = runBash(shellTargetCheck, { env: { FOUNT_DIR: target } })
	assert.equal(result.status, 1)
	assert.match(result.stderr, /existing files were left untouched/)
	assert.equal(statSync(dirname(target)).isFile(), true)
})

const installStubs = `
FOUNT_DIR=/fount-target
FOUNT_BRANCH=master
FOUNT_INSTALL_TMP=
C_CYAN= C_RESET= C_GREEN= C_YELLOW= C_RED=
OSTYPE=linux-gnu
mktemp() { printf '/fount-staging'; }
write_taskbar_progress() { :; }
write_taskbar_progress_error() { :; }
install_package() { printf 'package:%s\\n' "$*"; }
curl() { printf 'unexpected download\\n' >&2; exit 97; }
wget() { printf 'unexpected download\\n' >&2; exit 97; }
unzip() { printf 'unexpected extraction\\n' >&2; exit 97; }
git() { printf 'unexpected clone\\n' >&2; exit 97; }
test_fount_tree() { [ "$1" = /fount-staging/tree ] || [ "$1" = /fount-staging/fount-master ]; }
test_fount_target_empty() { [ "$1" = /fount-target ]; }
[() {
	if [[ "$1" == '!' ]]; then shift; ! [ "$@"; return; fi
	case "$*" in
		'-f /fount-staging/tree/path/fount.sh ]') builtin [ "$clone_complete" = 1 ] ;;
		'-f /fount-target/path/fount.sh ]') builtin [ "$installed" = 1 ] ;;
		'-d /fount-staging/fount-master ]') return 0 ;;
		*) builtin [ "$@" ;;
	esac
}
mkdir() { printf 'mkdir:%s\\n' "$*"; }
cp() { printf 'copy:%s\\n' "$*"; installed=1; }
find() {
	if [ "$1" = /fount-staging ]; then printf '/fount-staging/fount-master\\n'; fi
}
chmod() { printf 'unexpected chmod\\n' >&2; exit 97; }
rm() {
	case "$*" in
		'-rf /fount-staging' | '-rf /fount-staging/tree') ;;
		'-rf /fount-target') printf 'unexpected target removal\\n' >&2; exit 97 ;;
		*) printf 'unexpected removal\\n' >&2; exit 97 ;;
	esac
	printf 'cleanup:%s\\n' "$*"
}
mv() {
	printf 'unexpected directory move\\n' >&2
	exit 97
}
`

bashTest('clone retries clean only staging and publish contents into the destination', () => {
	const result = runBash(`
${shellInstall}
${installStubs}
LANG=zh_CN.UTF-8 LC_ALL= LC_MESSAGES=
clone_attempt=0
git() {
	printf 'clone:%s\\n' "$9"
	clone_attempt=$((clone_attempt + 1))
	[ "$clone_attempt" -gt 1 ] || return 1
	clone_complete=1
}
install_fount_tree || exit $?
printf 'staging:%s\\n' "$FOUNT_INSTALL_TMP"
`)
	assert.equal(result.status, 0, result.stderr)
	assert.match(result.stdout, /clone:\/fount-staging\/tree\ncleanup:-rf \/fount-staging\/tree\nclone:\/fount-staging\/tree/)
	assert.match(result.stdout, /copy:-R \/fount-staging\/tree\/\. \/fount-target\//)
	assert.match(result.stdout, /cleanup:-rf \/fount-staging\n[\s\S]*staging:\n$/)
	assert(result.stdout.indexOf('copy:') < result.stdout.indexOf('cleanup:-rf /fount-staging\n'))
	assert.doesNotMatch(result.stdout, /package:/)
})

bashTest('zip installs publish dotfiles into the target without replacing it', () => {
	const result = runBash(`
${shellInstall}
${installStubs}
LANG=C LC_ALL=C
command() {
	if [ "$*" = '-v git' ]; then return 1; fi
	builtin command "$@"
}
curl() { printf 'download:%s\\n' "$*"; }
unzip() { printf 'unzip:%s\\n' "$*"; }
install_fount_tree || exit $?
printf 'staging:%s\\n' "$FOUNT_INSTALL_TMP"
`)
	assert.equal(result.status, 0, result.stderr)
	assert.match(result.stdout, /unzip:-q -o \/fount-staging\/fount.zip -d \/fount-staging/)
	assert.match(result.stdout, /copy:-R \/fount-staging\/fount-master\/\. \/fount-target\//)
	assert.match(result.stdout, /cleanup:-rf \/fount-staging\n[\s\S]*staging:\n$/)
	assert(result.stdout.indexOf('copy:') < result.stdout.indexOf('cleanup:'))
})

bashTest('every bash platform stages the install instead of replacing the target', () => {
	assert.match(shellSource, /FOUNT_INSTALL_TMP=\$\(mktemp -d\)\s*\|\| return 1/)
	assert.doesNotMatch(shellInstall, /rm -rf "\$FOUNT_DIR"/)
	assert.doesNotMatch(shellInstall, /mv "\$extracted_dir"/)
	assert.doesNotMatch(shellSource, /FOUNT_PRESERVE_INSTALL/)
})

bashTest('a failed publish keeps the staging cleanup and aborts the install', () => {
	const result = runBash(`
${shellInstall}
${installStubs}
LANG=C LC_ALL=C
command() {
	if [ "$*" = '-v git' ]; then return 1; fi
	builtin command "$@"
}
curl() { :; }
unzip() { :; }
test_fount_target_empty() { return 1; }
install_fount_tree
`)
	assert.equal(result.status, 1)
	assert.match(result.stdout, /cleanup:-rf \/fount-staging/)
	assert.doesNotMatch(result.stdout, /copy:/)
})

bashTest('EULA refusal removes the installation and uninstalls auto-installed packages', () => {
	const result = runBash(`
${shellSource.match(/remove_fount_after_eula_decline\(\) \{[\s\S]*?\n\}/)[0]}
${shellSource.match(/cleanup\(\) \{[\s\S]*?\n\}/)[0]}
EULA_DECLINED=1
FOUNT_DIR=/fount-target
FOUNT_INSTALL_TMP= STATUS_SERVER_PID=
rm() { printf 'rm:%s\\n' "$*"; }
uninstall_auto_packages() { printf 'uninstall:%s\\n' "$*"; }
write_taskbar_progress_clear() { :; }
stop_fount_status_server() { :; }
remove_fount_after_eula_decline
cleanup
`)
	assert.equal(result.status, 0, result.stderr)
	assert.match(result.stdout, /rm:-rf \/fount-target/)
	assert.match(result.stdout, /uninstall:/)
})
