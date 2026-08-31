/** 安装器复用现有目录；下载、发布与清理由内存替身检查，不修改文件系统。 */
/* global Deno */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const shellSource = readFileSync(new URL('../../src/runner/main.sh', import.meta.url), 'utf8')
const shellTargetCheck = shellSource.slice(shellSource.indexOf('FOUNT_PRESERVE_INSTALL=0')).split('\nif echo ')[0]
const shellInstall = shellSource.match(/install_fount_tree\(\) \{[\s\S]*?\n\}/)[0]

/**
 * 只执行选定函数与目标检查，禁用环境启动脚本。
 * @param {string} script 要执行的 Bash 代码。
 * @param {import('node:child_process').SpawnSyncOptions} options 工作目录与环境覆盖。
 * @returns {import('node:child_process').SpawnSyncReturns<string>} 子进程退出状态与输出。
 */
function runBash(script, options = {}) {
	return spawnSync('bash', ['--noprofile', '--norc', '-c', `pacman() { :; }\nOSTYPE=linux-gnu\n${script}`], {
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
	assert.match(shellSource, /if \[ "\$FOUNT_EXISTING_INSTALL" -eq 1 \] \|\| \{ \[ "\$FOUNT_PRESERVE_INSTALL" -eq 0 \]/)
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
FOUNT_PRESERVE_INSTALL=1
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
		'-rf /fount-target') [ "$FOUNT_PRESERVE_INSTALL" = 0 ] || exit 97 ;;
		*) printf 'unexpected removal\\n' >&2; exit 97 ;;
	esac
	printf 'cleanup:%s\\n' "$*"
}
mv() {
	[ "$FOUNT_PRESERVE_INSTALL" = 0 ] || { printf 'unexpected directory replacement\\n' >&2; exit 97; }
	printf 'move:%s\\n' "$*"
	installed=1
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

for (const platform of ['darwin', 'freebsd', 'linux-without-pacman'])
	bashTest(`${platform} retains installation discovery without the Arch target guard`, () => {
		const result = runBash(`
OSTYPE=${platform === 'linux-without-pacman' ? 'linux-gnu' : platform}
command() { return 1; }
${shellTargetCheck}
printf 'preserve:%s existing:%s target:%s\\n' "$FOUNT_PRESERVE_INSTALL" "$FOUNT_EXISTING_INSTALL" "$FOUNT_DIR"
`, { env: { FOUNT_DIR: join(repositoryRoot, 'path') } })
		assert.equal(result.status, 0, result.stderr)
		assert.equal(result.stdout, `preserve:0 existing:0 target:${join(repositoryRoot, 'path')}\n`)
	})

bashTest('other platforms retain direct clone installation without staging', () => {
	const result = runBash(`
${shellInstall}
${installStubs}
FOUNT_PRESERVE_INSTALL=0
OSTYPE=freebsd
LANG=C LC_ALL=C
git() { printf 'clone:%s\\n' "$9"; installed=1; }
install_fount_tree
`)
	assert.equal(result.status, 0, result.stderr)
	assert.match(result.stdout, /cleanup:-rf \/fount-target/)
	assert.match(result.stdout, /clone:\/fount-target/)
	assert.doesNotMatch(result.stdout, /fount-staging|copy:|move:/)
})

bashTest('other platforms retain ZIP move and temporary cleanup', () => {
	const result = runBash(`
${shellInstall}
${installStubs}
FOUNT_PRESERVE_INSTALL=0
OSTYPE=freebsd
LANG=C LC_ALL=C
command() {
	if [ "$*" = '-v git' ]; then return 1; fi
	builtin command "$@"
}
curl() { :; }
unzip() { :; }
install_fount_tree
`)
	assert.equal(result.status, 0, result.stderr)
	assert.match(result.stdout, /move:\/fount-staging\/fount-master\/\* \/fount-target/)
	assert.match(result.stdout, /cleanup:-rf \/fount-staging/)
	assert.doesNotMatch(result.stdout, /copy:/)
})

bashTest('the Arch EULA cleanup never invokes an uninstaller or removes its target', () => {
	const result = runBash(`
${shellSource.match(/remove_fount_after_eula_decline\(\) \{[\s\S]*?\n\}/)[0]}
${shellSource.match(/cleanup\(\) \{[\s\S]*?\n\}/)[0]}
FOUNT_PRESERVE_INSTALL=1
EULA_DECLINED=1
FOUNT_DIR=/fount-target
FOUNT_INSTALL_TMP= STATUS_SERVER_PID=
uninstall_auto_packages() { printf 'unexpected uninstall\\n'; exit 97; }
rm() { printf 'unexpected removal\\n'; exit 97; }
write_taskbar_progress_clear() { :; }
remove_fount_after_eula_decline
cleanup
`)
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.stdout, '')
	assert(shellSource.indexOf('elif ! test_fount_target_empty') < shellSource.indexOf('curl -X PATCH'))
})
