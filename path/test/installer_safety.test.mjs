/** 安装器复用现有目录；下载、发布与清理由内存替身检查，不修改文件系统。 */
/* global Deno */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const shellSource = readFileSync(new URL('../../src/runner/main.sh', import.meta.url), 'utf8')
const powershellSource = readFileSync(new URL('../../src/runner/main.ps1', import.meta.url), 'utf8')
const shellTargetCheck = shellSource.slice(shellSource.indexOf('if [ -z "${FOUNT_DIR:-}" ]; then')).split('\nif echo ')[0]
const shellInstall = shellSource.match(/install_fount_tree\(\) \{[\s\S]*?\n\}/)[0]

/**
 * 只执行选定函数与目标检查，禁用环境启动脚本。
 * @param {string} script 要执行的 Bash 代码。
 * @param {import('node:child_process').SpawnSyncOptions} options 工作目录与环境覆盖。
 * @returns {import('node:child_process').SpawnSyncReturns<string>} 子进程退出状态与输出。
 */
function runBash(script, options = {}) {
	return spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
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
	assert.match(shellSource, /if \[ "\$FOUNT_EXISTING_INSTALL" -eq 1 \]; then\n\timport_fount_locale\nelse/)
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
	const target = join(repositoryRoot, 'run.sh', 'fount')
	const result = runBash(`${shellTargetCheck}\nprintf 'existing:%s\\n' "$FOUNT_EXISTING_INSTALL"`, { env: { FOUNT_DIR: target } })
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.stdout, 'existing:0\n')
	assert.equal(statSync(dirname(target)).isFile(), true)
})

const installStubs = `
FOUNT_DIR=/fount-target
FOUNT_BRANCH=master
C_CYAN= C_RESET= C_GREEN= C_YELLOW= C_RED=
OSTYPE=linux-gnu
mktemp() { printf '/fount-staging'; }
write_taskbar_progress() { :; }
write_taskbar_progress_error() { :; }
install_package() { printf 'package:%s\\n' "$*"; }
test_fount_tree() { [ "$1" = "$expected_source" ]; }
test_fount_target_empty() { [ "$1" = /fount-target ]; }
mkdir() { printf 'mkdir:%s\\n' "$*"; }
cp() { printf 'copy:%s\\n' "$*"; }
find() {
	if [ "$1" = /fount-staging/archive ]; then printf '%s\\n' "$expected_source"; fi
}
chmod() { printf 'unexpected chmod\\n' >&2; exit 97; }
rm() {
	if [ "$*" != '-rf /fount-staging' ]; then printf 'unexpected removal\\n' >&2; exit 97; fi
	printf 'cleanup:%s\\n' "$*"
}
mv() { printf 'unexpected directory replacement\\n' >&2; exit 97; }
`

bashTest('clone retries use separate staging directories and publish contents into the destination', () => {
	const result = runBash(`
${shellInstall}
${installStubs}
LANG=zh_CN.UTF-8 LC_ALL= LC_MESSAGES=
expected_source=/fount-staging/clone-2
git() {
	printf 'clone:%s\\n' "$9"
	[ "$9" != /fount-staging/clone-1 ]
}
install_fount_tree
printf 'staging:%s\\n' "$FOUNT_INSTALL_TMP"
`)
	assert.equal(result.status, 0, result.stderr)
	assert.match(result.stdout, /clone:\/fount-staging\/clone-1\nclone:\/fount-staging\/clone-2/)
	assert.match(result.stdout, /copy:-R \/fount-staging\/clone-2\/\. \/fount-target\//)
	assert.match(result.stdout, /cleanup:-rf \/fount-staging\n[\s\S]*staging:\n$/)
	assert(result.stdout.indexOf('copy:') < result.stdout.indexOf('cleanup:'))
	assert.doesNotMatch(result.stdout, /package:/)
})

bashTest('zip installs publish dotfiles into the target without replacing it', () => {
	const result = runBash(`
${shellInstall}
${installStubs}
LANG=C LC_ALL=C
expected_source=$FOUNT_TEST_SOURCE
command() {
	if [ "$*" = '-v git' ]; then return 1; fi
	builtin command "$@"
}
curl() { printf 'download:%s\\n' "$*"; }
unzip() { printf 'unzip:%s\\n' "$*"; }
install_fount_tree
printf 'staging:%s\\n' "$FOUNT_INSTALL_TMP"
`, { env: { FOUNT_TEST_SOURCE: repositoryRoot } })
	assert.equal(result.status, 0, result.stderr)
	assert.match(result.stdout, /unzip:-q -o \/fount-staging\/fount.zip -d \/fount-staging\/archive/)
	assert(result.stdout.includes(`copy:-R ${repositoryRoot}/. /fount-target/`))
	assert.match(result.stdout, /cleanup:-rf \/fount-staging\n[\s\S]*staging:\n$/)
	assert(result.stdout.indexOf('copy:') < result.stdout.indexOf('cleanup:'))
})

Deno.test('both runners reject unknown targets before network and preserve existing installations on refusal', () => {
	assert(shellSource.indexOf('elif ! test_fount_target_empty') < shellSource.indexOf('curl -X PATCH'))
	assert(powershellSource.indexOf('$existingInstall = Test-FountInstallTarget') < powershellSource.indexOf('Start-Job {'))
	assert.match(powershellSource, /if \(-not \$existingInstall\)/)
	assert.match(powershellSource, /Get-ChildItem -LiteralPath \$sourceDirectory -Force \| Move-Item -Destination \$Dir/)
	assert.doesNotMatch(shellSource, /rm -rf "\$FOUNT_DIR"|remove_fount_after_eula_decline|uninstall_auto_packages/)
	assert.doesNotMatch(powershellSource, /Remove-Item (?:\$Dir|\$env:FOUNT_DIR)|Remove-FountAfterEulaDecline/)
	assert.match(shellSource, /FOUNT_INSTALL_TMP=""/)
})

Deno.test('compiled runner retains shared target checks and the Windows installation default', () => {
	const compiledSource = powershellSource.replace(/#_if PSScript[\s\S]*?#_endif/g, '')
	assert.match(compiledSource, /function Test-FountTree\(/)
	assert.match(compiledSource, /function Test-FountInstallTarget\(/)
	assert.match(compiledSource, /\$existingInstall = Test-FountInstallTarget \$env:FOUNT_DIR/)
	assert.match(compiledSource, /elseif \(\$env:OS -eq 'Windows_NT'\) \{\n\t\t\$env:FOUNT_DIR = "\$env:LOCALAPPDATA\/fount"/)
	assert(compiledSource.indexOf('function Test-FountInstallTarget') < compiledSource.indexOf('$existingInstall ='))
})
