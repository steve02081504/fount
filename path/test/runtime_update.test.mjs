/**
 * 运行时更新尊重 Arch 软件包归属，并保留崩溃修复和明确请求的更新重启。
 * 软件包管理、运行时升级和文件修改全部由内存中的 Shell 函数替身完成。
 */
/* global Deno */
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

const packagesSh = await readFile(join(REPO_ROOT, 'path/src/packages.sh'), 'utf8')
const runnerSh = await readFile(join(REPO_ROOT, 'src/runner/main.sh'), 'utf8')
const denoSh = await readFile(join(REPO_ROOT, 'path/src/deno.sh'), 'utf8')
const keepaliveSh = await readFile(join(REPO_ROOT, 'path/src/cmd/keepalive.sh'), 'utf8')
const runSh = await readFile(join(REPO_ROOT, 'path/src/run.sh'), 'utf8')
const pathEntry = await readFile(join(REPO_ROOT, 'path/fount'), 'utf8')
const npmRunner = await readFile(join(REPO_ROOT, 'src/runner/npm/main.mjs'), 'utf8')

/**
 * 不加载 Shell 配置，只执行函数定义和内存替身。
 * @param {string} script 要执行的 Bash 代码。
 * @returns {import('node:child_process').SpawnSyncReturns<string>} 子进程退出状态与输出。
 */
function runBash(script) {
	return spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
		encoding: 'utf8',
		env: { ...process.env, BASH_ENV: '' }
	})
}

/**
 * Bash 行为用例只在 Unix 执行，PowerShell 对齐另行检查。
 * @param {string} name 用例名称。
 * @param {() => void | Promise<void>} test 用例逻辑。
 * @returns {void} 注册测试。
 */
function bashTest(name, test) {
	Deno.test({ name, fn: test, ignore: Deno.build.os === 'windows' })
}

const bashPlatforms = [['Linux', 'linux-gnu', 0], ['macOS', 'darwin', 0], ['MSYS', 'msys', 0], ['Termux', 'linux-android', 1]]

for (const [name, source] of [['path', packagesSh], ['runner', runnerSh]])
	for (const [platform, ostype, termux] of bashPlatforms)
		for (const status of [0, 42])
			bashTest(`${name} pacman dependency installation on ${platform} (status ${status})`, () => {
				const result = runBash(`
${source.match(/install_with_manager\(\) \{[\s\S]*?\n\}/)[0]}
OSTYPE='${ostype}'
IN_TERMUX=${termux}
FOUNT_PRESERVE_INSTALL=${platform === 'Linux' ? 1 : 0}
id() { printf '1000\\n'; }
sudo() { printf 'sudo:%s\\n' "$*"; "$@"; }
pacman() { printf 'pacman:%s\\n' "$*"; return ${status}; }
install_with_manager pacman deno
`)
				strictEqual(result.status, status, result.stderr)
				strictEqual(result.stdout, [
					...platform === 'Linux' ? [] : ['-Syy --noconfirm'],
					'-S --needed --noconfirm deno'
				].map(args => `sudo:pacman ${args}\npacman:${args}\n`).join(''))
			})

for (const [name, installPackage] of [
	['POSIX entry', pathEntry.match(/install_package\(\) \{[\s\S]*?\n\}/)[0]],
	['npm bootstrap', npmRunner.match(/install_package\(\) \{[^\n]+/)[0].replaceAll('\\$', '$')],
])
	for (const [platform, system, termux] of [['Linux', 'Linux', false], ['macOS', 'Darwin', false], ['MSYS', 'MINGW_NT-10.0', false], ['Termux', 'Linux', true]])
		for (const [installStatus, refreshStatus] of [[0, 0], [42, 0], [0, 42]])
			bashTest(`${name} preserves ${platform} dependency behavior (install ${installStatus}, refresh ${refreshStatus})`, () => {
				const result = runBash(`
${installPackage}
uname() { printf '%s\\n' '${system}'; }
[() {
	if [[ "$*" == '-d /data/data/com.termux ]' ]]; then return ${termux ? 0 : 1}
	elif [[ "$*" == '! -d /data/data/com.termux ]' ]]; then return ${termux ? 1 : 0}
	else builtin [ "$@"; fi
}
command() {
	case "$*" in
		'-v curl') [ "$installed" = 1 ] ;;
		'-v pacman' | '-v sudo') return 0 ;;
		*) return 1 ;;
	esac
}
id() { printf '1000\\n'; }
sudo() { printf 'sudo:%s\\n' "$*"; "$@"; }
pacman() {
	printf 'pacman:%s\\n' "$*"
	if [ "$1" = '-Syy' ]; then return ${refreshStatus}; fi
	if [ ${installStatus} -eq 0 ]; then installed=1; fi
	return ${installStatus}
}
install_package curl
`)
				const installAttempted = platform === 'Linux' || name === 'npm bootstrap' || refreshStatus === 0
				strictEqual(result.status, installAttempted && installStatus === 0 ? 0 : 1, result.stderr)
				strictEqual(result.stdout, [
					...platform === 'Linux' ? [] : ['-Syy --noconfirm'],
					...installAttempted ? ['-S --needed --noconfirm curl'] : [],
				].map(args => `sudo:pacman ${args}\npacman:${args}\n`).join(''))
			})

for (const [platform, ostype, termux] of bashPlatforms)
	bashTest(`pacman package upgrades are disabled only on non-Termux Linux (${platform})`, () => {
		const result = runBash(`
${packagesSh}
exec 3>&1
OSTYPE='${ostype}'
IN_TERMUX=${termux}
id() { printf '1000\\n'; }
sudo() { printf 'sudo:%s\\n' "$*" >&3; "$@"; }
pacman() { printf 'pacman:%s\\n' "$*" >&3; }
upgrade_with_manager pacman deno
`)
		strictEqual(result.status, platform === 'Linux' ? 1 : 0, result.stderr)
		strictEqual(result.stdout, platform === 'Linux' ? '' : ['-Sy --noconfirm', '-S --noconfirm deno'].map(args => `sudo:pacman ${args}\npacman:${args}\n`).join(''))
		strictEqual(result.stderr, '')
	})

const denoStubs = `
exec 3>&2
OSTYPE=linux-gnu
IN_TERMUX=0
FOUNT_DIR=/fount
command() {
	if [[ "$*" == '-v pacman' && "$pacman_available" == 0 ]]; then return 1
	elif [[ "$*" == '-v deno' ]]; then printf '/launcher/deno\\n'
	else builtin command "$@"; fi
}
readlink() {
	[[ "$*" == '-f /launcher/deno' ]] || exit 97
	printf '/usr/bin/deno\\n'
}
pacman() {
	printf 'pacman:%s\\n' "$*" >&3
	[[ "$*" == '-Qqo -- /usr/bin/deno' ]] || exit 97
	return "$package_status"
}
sudo() { printf 'unexpected sudo\\n' >&2; exit 97; }
upgrade_package() { printf 'unexpected system upgrade\\n' >&2; exit 97; }
rm() { printf 'unexpected removal\\n' >&2; exit 97; }
install_deno() { printf 'unexpected installation\\n' >&2; exit 97; }
deno_pinned_spec() { printf '%s' "$test_pin"; }
deno() {
	if [[ "$*" == '-V' ]]; then printf '%s\\n' "$version"
	else printf 'deno:%s\\n' "$*" >&3; fi
}
run_deno() { deno "$@"; }
print_i18n_yellow() { printf 'warning:%s\\n' "$*" >&2; }
print_i18n_red() { printf 'error:%s\\n' "$*" >&2; }
mkdir() { printf 'mkdir:%s\\n' "$*" >&2; }
touch() { printf 'touch:%s\\n' "$*" >&2; }
`

for (const [channel, pinned] of [['', ''], ['canary', ''], ['canary', 'pr 36606']])
	bashTest(`pacman-owned Deno is never self-upgraded (channel ${channel || 'default'}, pin ${pinned || 'none'})`, () => {
		const result = runBash(`
${denoSh}
${denoStubs}
package_status=0
test_pin='${pinned}'
deno_upgrade '${channel}'
`)
		strictEqual(result.status, 0, result.stderr)
		strictEqual(result.stdout, '')
		deepStrictEqual(result.stderr.trim().split('\n'), [
			'pacman:-Qqo -- /usr/bin/deno',
			'warning:deno.managedByPacman path /usr/bin/deno',
			'mkdir:-p /fount/data/installer',
			'touch:/fount/data/installer/deno_upgraded'
		])
	})


for (const [version, channel, pinned, expected] of [
	['deno 2.9.5', '', '', 'stable'],
	['deno 2.10.0+canary', '', '', 'canary'],
	['deno 2.10.0-rc.1', '', '', 'rc'],
	['deno 2.9.5', 'canary', '', 'canary'],
	['deno 2.9.5', 'canary', 'pr 36606', 'pr 36606'],
	['deno 2.9.5', '', '2.9.4', '2.9.4']
])
	bashTest(`user-managed Deno preserves requested upgrade ${expected} (${channel || 'default'} channel)`, () => {
		const result = runBash(`
${denoSh}
${denoStubs}
package_status=1
version='${version}'
test_pin='${pinned}'
base_deno_upgrade '${channel}'
`)
		strictEqual(result.status, 0, result.stderr)
		strictEqual(result.stdout, '')
		deepStrictEqual(result.stderr.trim().split('\n'), ['pacman:-Qqo -- /usr/bin/deno', `deno:upgrade -q ${expected}`])
	})


for (const [channel, expected] of [['', 'package-upgrade:deno deno'], ['canary', 'deno:upgrade -q canary']])
	bashTest(`non-pacman hosts preserve ${channel ? 'forced-channel self-upgrade' : 'default package-manager upgrade'}`, () => {
		const result = runBash(`
${denoSh}
${denoStubs}
pacman_available=0
version='deno 2.9.5'
upgrade_package() { printf 'package-upgrade:%s\\n' "$*" >&3; }
base_deno_upgrade '${channel}'
`)
		strictEqual(result.status, 0, result.stderr)
		strictEqual(result.stdout, '')
		strictEqual(result.stderr.trim(), expected)
	})


for (const [platform, ostype, termux] of bashPlatforms.filter(([name]) => name !== 'Linux'))
	for (const [channel, pinned, expected] of [['', '', 'package-upgrade:deno deno'], ['canary', '', 'deno:upgrade -q canary'], ['canary', 'pr 36606', 'deno:upgrade -q pr 36606']])
		bashTest(`${platform} retains baseline Deno updates (${pinned || channel || 'default'}) even with pacman available`, () => {
			const result = runBash(`
${denoSh}
${denoStubs}
OSTYPE='${ostype}'
IN_TERMUX=${termux}
package_status=0
version='deno 2.9.5'
test_pin='${pinned}'
upgrade_package() { printf 'package-upgrade:%s\\n' "$*" >&3; }
base_deno_upgrade '${channel}'
`)
			strictEqual(result.status, 0, result.stderr)
			strictEqual(result.stdout, '')
			strictEqual(result.stderr.trim(), expected)
		})

bashTest('package upgrades preserve the baseline manager discovery order', () => {
	const result = runBash(`
${packagesSh}
upgrade_with_manager() { printf 'manager:%s\\n' "$*"; [[ "$1" == brew ]]; }
deno() { :; }
upgrade_package deno deno
`)
	strictEqual(result.status, 0, result.stderr)
	deepStrictEqual(result.stdout.trim().split('\n'), ['pkg', 'apt-get', 'pacman', 'dnf', 'yum', 'zypper', 'apk', 'brew'].map(manager => `manager:${manager} deno`))
	strictEqual(result.stderr, '')
})

bashTest('keepalive crash still repairs the app without upgrading pacman-owned Deno', () => {
	const result = runBash(`
${denoSh}
${denoStubs}
${keepaliveSh}
package_status=0
bootstrap_server() { :; }
write_taskbar_progress_clear() { :; }
date() { printf '1000\\n'; }
run_count=0
run_server() {
	run_count=$((run_count + 1))
	printf 'run:%s\\n' "$*"
	[[ "$run_count" -gt 1 ]]
}
update_fount_and_deno() { printf 'app-update\\n'; deno_upgrade; }
cmd_keepalive keepalive initial-argument
`)
	strictEqual(result.status, 0, result.stderr)
	strictEqual(result.stdout, 'run:initial-argument\napp-update\nrun:\n')
	deepStrictEqual(result.stderr.trim().split('\n'), [
		'pacman:-Qqo -- /usr/bin/deno',
		'warning:deno.managedByPacman path /usr/bin/deno',
		'mkdir:-p /fount/data/installer',
		'touch:/fount/data/installer/deno_upgraded'
	])
})

bashTest('explicit exit-131 update still updates and restarts without replaying command arguments', () => {
	const result = runBash(`
${runSh}
run_count=0
run() {
	run_count=$((run_count + 1))
	printf 'run:%s\\n' "$*"
	if [[ "$run_count" -eq 1 ]]; then return 131; fi
}
update_fount_and_deno() { printf 'update\\n'; }
run_with_updates initial-argument
`)
	strictEqual(result.status, 0, result.stderr)
	strictEqual(result.stdout, 'run:initial-argument\nupdate\nrun:\n')
	strictEqual(result.stderr, '')
})

Deno.test('PowerShell preserves package ownership and explicit-update restart semantics', async () => {
	const denoPs1 = await readFile(join(REPO_ROOT, 'path/src/deno.ps1'), 'utf8')
	const keepalivePs1 = await readFile(join(REPO_ROOT, 'path/src/cmd/keepalive.ps1'), 'utf8')
	const runPs1 = await readFile(join(REPO_ROOT, 'path/src/run.ps1'), 'utf8')
	match(denoPs1, /readlink -f \(Get-Command deno -ErrorAction Stop\)\.Source/)
	match(denoPs1, /pacman -Qqo -- \$denoBinary/)
	ok(denoPs1.indexOf('deno.managedByPacman') < denoPs1.indexOf('deno upgrade'), 'package ownership guard precedes every self-upgrade')
	match(keepalivePs1, /\n\s*update_fount_and_deno\s*run_server\s*\r?\n/)
	match(runPs1, /while \(\$LastExitCode -eq 131\) \{\s*update_fount_and_deno\s*run\s*\}/)
})
