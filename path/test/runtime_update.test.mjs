/**
 * 包管理器处理统一：归属检测、按管理器文件锁、数据库刷新节流，以及 deno 更新的
 * 「被管理则管理器升级 / 未管理则 deno 自升级」。软件包管理、运行时升级和文件
 * 修改由内存中的 Shell 函数替身接管，锁与刷新时间戳落在临时目录。
 */
/* global Deno */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

const packagesSh = readFileSync(join(REPO_ROOT, 'path/src/packages.sh'), 'utf8')
const runnerSh = readFileSync(join(REPO_ROOT, 'src/runner/main.sh'), 'utf8')
const denoSh = readFileSync(join(REPO_ROOT, 'path/src/deno.sh'), 'utf8')
const keepaliveSh = readFileSync(join(REPO_ROOT, 'path/src/cmd/keepalive.sh'), 'utf8')
const runSh = readFileSync(join(REPO_ROOT, 'path/src/run.sh'), 'utf8')
const pathEntry = readFileSync(join(REPO_ROOT, 'path/fount'), 'utf8')
const npmRunner = readFileSync(join(REPO_ROOT, 'src/runner/npm/main.mjs'), 'utf8')
const updateDenoSh = readFileSync(join(REPO_ROOT, 'path/src/update-deno.sh'), 'utf8')

/**
 * 不加载 Shell 配置，只执行函数定义和内存替身。
 * @param {string} script 要执行的 Bash 代码。
 * @param {Record<string, string>} [extraEnv] 额外的环境覆盖。
 * @returns {import('node:child_process').SpawnSyncReturns<string>} 子进程退出状态与输出。
 */
function runBash(script, extraEnv = {}) {
	return spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
		encoding: 'utf8',
		env: { ...process.env, BASH_ENV: '', ...extraEnv },
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

/**
 * 创建临时状态目录，返回可供 bash 子进程使用的环境。
 * @returns {{ env: Record<string, string>, stateDir: string, fountDir: string }} 环境与目录。
 */
function tempEnv() {
	const root = mkdtempSync(join(tmpdir(), 'fount-pkg-test-'))
	const stateDir = join(root, 'state')
	const fountDir = join(root, 'fount')
	mkdirSync(stateDir, { recursive: true })
	return {
		env: { FOUNT_PKG_STATE_DIR: stateDir, FOUNT_DIR: fountDir },
		stateDir,
		fountDir,
		/** 递归删除本次创建的临时目录。
		 * @returns {void} 删除完成。
		 */
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	}
}

// --- 归属检测 ---

for (const [name, setup, expected] of [
	['dpkg/apt', 'dpkg() { printf \'mypkg: %s\\n\' "$2"; }', 'apt-get mypkg'],
	['pacman', 'pacman() { printf \'mypkg\\n\'; }', 'pacman mypkg'],
	['rpm+dnf', 'rpm() { printf \'mypkg\\n\'; } dnf() { :; }', 'dnf mypkg'],
	['rpm+yum', 'rpm() { printf \'mypkg\\n\'; } yum() { :; }', 'yum mypkg'],
	['rpm+zypper', 'rpm() { printf \'mypkg\\n\'; } zypper() { :; }', 'zypper mypkg'],
	['apk', 'apk() { printf \'is owned by mypkg\\n\'; }', 'apk mypkg'],
	['brew', 'brew() { printf \'/usr/local\\n\'; }', 'brew deno'],
	['pkg', 'pkg() { printf \'mypkg\\n\'; }', 'pkg mypkg'],
	['none', '', ''],
])
	bashTest(`pkg_owner_of reports ${name} ownership`, () => {
		const result = runBash(`
${packagesSh}
${setup}
owner=$(pkg_owner_of /usr/local/Cellar/deno/2.9.6/bin/deno)
printf 'owner:%s\\n' "$owner"
`)
		assert.equal(result.status, 0, result.stderr)
		assert.equal(result.stdout, `owner:${expected}\n`)
	})

bashTest('resolve_realpath follows symlink chains portably', () => {
	const root = mkdtempSync(join(tmpdir(), 'fount-realpath-'))
	try {
		const target = join(root, 'target')
		const link = join(root, 'link')
		writeFileSync(target, 'x')
		Deno.symlinkSync(target, link)
		const result = runBash(`
${packagesSh}
printf '%s\\n' "$(resolve_realpath ${JSON.stringify(link)})"
`)
		assert.equal(result.status, 0, result.stderr)
		assert.equal(result.stdout.trim(), target)
	}
	finally { rmSync(root, { recursive: true, force: true }) }
})

// --- 锁与刷新节流 ---

bashTest('a stale lock with a dead pid is stolen', () => {
	const { env, stateDir, cleanup } = tempEnv()
	try {
		mkdirSync(join(stateDir, 'pacman.lock'))
		writeFileSync(join(stateDir, 'pacman.lock', 'pid'), '999999999')
		const result = runBash(`
${packagesSh}
pkg_lock_acquire pacman
rc=$?
printf 'rc:%s\\n' "$rc"
pkg_lock_release
printf 'held:%s\\n' "\${FOUNT_PKG_LOCK_DIR:-}"
`, env)
		assert.equal(result.status, 0, result.stderr)
		assert.equal(result.stdout, 'rc:0\nheld:\n')
		assert.equal(existsSync(join(stateDir, 'pacman.lock')), false)
	}
	finally { cleanup() }
})

bashTest('a live lock times out instead of stealing', () => {
	const { env, stateDir, cleanup } = tempEnv()
	try {
		mkdirSync(join(stateDir, 'pacman.lock'))
		writeFileSync(join(stateDir, 'pacman.lock', 'pid'), String(process.pid))
		const result = runBash(`
FOUNT_PKG_LOCK_TIMEOUT=1
${packagesSh}
pkg_lock_acquire pacman
printf 'rc:%s\\n' "$?"
`, env)
		assert.equal(result.status, 0, result.stderr)
		assert.equal(result.stdout, 'rc:1\n')
	}
	finally { cleanup() }
})

bashTest('install_with_manager throttles the database refresh to once per interval', () => {
	const { env, stateDir, cleanup } = tempEnv()
	try {
		const script = `
exec 3>&2
${packagesSh}
id() { printf '1000\\n'; }
sudo() { printf 'sudo:%s\\n' "$*" >&3; "$@"; }
pacman() {
	printf 'pacman:%s\\n' "$*" >&3
	return 0
}
install_with_manager pacman curl
install_with_manager pacman curl
`
		const result = runBash(script, env)
		assert.equal(result.status, 0, result.stderr)
		const refreshLines = (result.stderr.match(/pacman:-Syy --noconfirm/g) || []).length
		const installLines = (result.stderr.match(/pacman:-S --needed --noconfirm curl/g) || []).length
		assert.equal(refreshLines, 1, 'refresh must run exactly once within the interval')
		assert.equal(installLines, 2)
	}
	finally { cleanup() }
})

bashTest('install_with_manager refreshes again after the interval elapses', () => {
	const { env, stateDir, cleanup } = tempEnv()
	try {
		writeFileSync(join(stateDir, 'pacman.refresh'), '0')
		const script = `
exec 3>&2
${packagesSh}
id() { printf '1000\\n'; }
sudo() { printf 'sudo:%s\\n' "$*" >&3; "$@"; }
pacman() {
	printf 'pacman:%s\\n' "$*" >&3
	return 0
}
install_with_manager pacman curl
`
		const result = runBash(script, env)
		assert.equal(result.status, 0, result.stderr)
		assert.equal((result.stderr.match(/pacman:-Syy --noconfirm/g) || []).length, 1)
	}
	finally { cleanup() }
})

// --- deno 更新：被管理则管理器升级 / 未管理则自升级 ---

const denoStubs = `
exec 3>&2
FOUNT_PKG_STATE_DIR=${'__STATE__'}
command() {
	if [[ "$*" == '-v pacman' || "$*" == '-v sudo' ]]; then return 0
	elif [[ "$*" == '-v deno' ]]; then printf '/launcher/deno\\n'
	else builtin command "$@"; fi
}
id() { printf '1000\\n'; }
sudo() { printf 'sudo:%s\\n' "$*" >&3; "$@"; }
pacman() {
	printf 'pacman:%s\\n' "$*" >&3
	if [[ "$1" == '-Qqo' ]]; then printf 'deno\\n'; return "$package_status"; fi
	if [[ "$1" == '-S' || "$1" == '-Sy' ]]; then return "$upgrade_status"; fi
	return 1
}
deno() {
	if [[ "$*" == '-V' ]]; then printf '%s\\n' "$version"
	elif [[ "$1" == 'upgrade' ]]; then printf 'deno:%s\\n' "$*" >&3
	fi
}
run_deno() { deno "$@"; }
print_i18n_yellow() { printf 'warning:%s\\n' "$*" >&2; }
print_i18n_red() { printf 'error:%s\\n' "$*" >&2; }
deno_pinned_spec() { printf '%s' "$test_pin"; }
version='deno 2.9.5'
package_status=0
upgrade_status=0
test_pin=''
`

bashTest('managed Deno is upgraded through its package manager and marks the flag', () => {
	const { env, stateDir, fountDir, cleanup } = tempEnv()
	try {
		const result = runBash(`
${packagesSh}
${denoSh}
${denoStubs.replace('__STATE__', stateDir)}
deno_upgrade
`, env)
		assert.equal(result.status, 0, result.stderr)
		assert.match(result.stderr, /pacman:-Qqo -- \/launcher\/deno/)
		assert.match(result.stderr, /pacman:-Sy --noconfirm/)
		assert.match(result.stderr, /pacman:-S --noconfirm deno/)
		assert.equal(existsSync(join(fountDir, 'data/installer/deno_upgraded')), true)
		assert.doesNotMatch(result.stderr, /deno:upgrade/)
	}
	finally { cleanup() }
})

bashTest('a package-managed Deno cannot honor a version pin and warns', () => {
	const { env, stateDir, fountDir, cleanup } = tempEnv()
	try {
		const result = runBash(`
${packagesSh}
${denoSh}
${denoStubs.replace('__STATE__', stateDir)}
test_pin='2.9.4'
deno_upgrade
`, env)
		assert.equal(result.status, 0, result.stderr)
		assert.match(result.stderr, /warning:deno.pinNotHonored spec 2.9.4 manager pacman/)
		assert.equal(existsSync(join(fountDir, 'data/installer/deno_upgraded')), true)
	}
	finally { cleanup() }
})

bashTest('a failed managed upgrade warns and keeps the installation as-is', () => {
	const { env, stateDir, fountDir, cleanup } = tempEnv()
	try {
		const result = runBash(`
${packagesSh}
${denoSh}
${denoStubs.replace('__STATE__', stateDir)}
upgrade_status=42
deno_upgrade
`, env)
		assert.equal(result.status, 0, result.stderr)
		assert.match(result.stderr, /warning:deno.managedUpgradeFailed manager pacman package deno/)
		assert.equal(existsSync(join(fountDir, 'data/installer/deno_upgraded')), false)
	}
	finally { cleanup() }
})

for (const [version, channel, pinned, expected] of [
	['deno 2.9.5', '', '', 'stable'],
	['deno 2.10.0+canary', '', '', 'canary'],
	['deno 2.10.0-rc.1', '', '', 'rc'],
	['deno 2.9.5', 'canary', '', 'canary'],
	['deno 2.9.5', 'canary', 'pr 36606', 'pr 36606'],
	['deno 2.9.5', '', '2.9.4', '2.9.4'],
])
	bashTest(`user-managed Deno preserves requested upgrade ${expected} (${channel || 'default'} channel)`, () => {
		const { env, stateDir, fountDir, cleanup } = tempEnv()
		try {
			const result = runBash(`
${packagesSh}
${denoSh}
${denoStubs.replace('__STATE__', stateDir)}
package_status=1
version='${version}'
test_pin='${pinned}'
base_deno_upgrade '${channel}'
`, env)
			assert.equal(result.status, 0, result.stderr)
			assert.deepEqual(result.stderr.trim().split('\n').filter(l => l.startsWith('deno:upgrade')), [`deno:upgrade -q ${expected}`])
			assert.equal(existsSync(join(fountDir, 'data/installer/deno_upgraded')), false)
		}
		finally { cleanup() }
	})

bashTest('non-pacman hosts keep self-upgrade even when a package manager is present', () => {
	const { env, stateDir, fountDir, cleanup } = tempEnv()
	try {
		const result = runBash(`
${packagesSh}
${denoSh}
${denoStubs.replace('__STATE__', stateDir)}
package_status=1
version='deno 2.9.5'
base_deno_upgrade ''
`, env)
		assert.equal(result.status, 0, result.stderr)
		assert.match(result.stderr, /pacman:-Qqo -- \/launcher\/deno/)
		assert.match(result.stderr, /deno:upgrade -q stable/)
		assert.equal(existsSync(join(fountDir, 'data/installer/deno_upgraded')), false)
	}
	finally { cleanup() }
})

// --- 独立 update-deno 脚本 ---

bashTest('the standalone update-deno script upgrades an unmanaged Deno end-to-end', () => {
	const root = mkdtempSync(join(tmpdir(), 'fount-update-deno-'))
	const fountDir = join(root, 'fount')
	const stateDir = join(root, 'state')
	const stubBin = join(root, 'stubbin')
	const trace = join(root, 'deno.trace')
	mkdirSync(join(fountDir, 'src/public'), { recursive: true })
	mkdirSync(stateDir, { recursive: true })
	mkdirSync(stubBin, { recursive: true })
	Deno.symlinkSync(join(REPO_ROOT, 'path'), join(fountDir, 'path'), 'dir')
	Deno.symlinkSync(join(REPO_ROOT, 'src/public/locales'), join(fountDir, 'src/public/locales'), 'dir')
	writeFileSync(join(stubBin, 'deno'), `#!/bin/sh\nif [ "$1" = "-V" ]; then echo "deno 2.9.5"; elif [ "$1" = "upgrade" ]; then echo "deno:upgrade $*" >>"${'$'}FOUNT_DENO_TRACE"; fi\n`)
	writeFileSync(join(stubBin, 'jq'), '#!/bin/sh\necho {}\n')
	Deno.chmodSync(join(stubBin, 'deno'), 0o755)
	Deno.chmodSync(join(stubBin, 'jq'), 0o755)
	try {
		const result = runBash(`bash "${fountDir}/path/src/update-deno.sh"`, {
			FOUNT_DIR: fountDir,
			FOUNT_PKG_STATE_DIR: stateDir,
			FOUNT_DENO_TRACE: trace,
			PATH: `${stubBin}:${process.env.PATH}`,
		})
		assert.equal(result.status, 0, result.stderr)
		assert.equal(existsSync(join(fountDir, 'data/installer/deno_upgraded')), true)
		assert.match(readFileSync(trace, 'utf8'), /deno:upgrade -q stable/)
	}
	finally { rmSync(root, { recursive: true, force: true }) }
})

// --- 崩溃修复与重启语义保持 ---

bashTest('keepalive crash still repairs the app without disrupting managed Deno handling', () => {
	const { env, stateDir, cleanup } = tempEnv()
	try {
		const result = runBash(`
${packagesSh}
${denoSh}
${denoStubs.replace('__STATE__', stateDir)}
${keepaliveSh}
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
`, env)
		assert.equal(result.status, 0, result.stderr)
		assert.equal(result.stdout, 'run:initial-argument\napp-update\nrun:\n')
		assert.match(result.stderr, /pacman:-S --noconfirm deno/)
	}
	finally { cleanup() }
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
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.stdout, 'run:initial-argument\nupdate\nrun:\n')
	assert.equal(result.stderr, '')
})

// --- 入口副本结构对齐 ---

Deno.test('path/fount keeps a uniform POSIX install_package with lock and throttle helpers', () => {
	assert.doesNotMatch(pathEntry, /uname -s.*termux/)
	assert.match(pathEntry, /pkg_lock_acquire\(\) \{/)
	assert.match(pathEntry, /pkg_db_refresh_needed\(\) \{/)
	assert.match(pathEntry, /pkg_refresh pacman/)
	assert.match(pathEntry, /pkg_with_lock pacman/)
})

Deno.test('npm bootstrap keeps a uniform install_package without a pacman special case', () => {
	assert.doesNotMatch(npmRunner, /uname -s.*termux/)
	assert.match(npmRunner, /pkg_lock_acquire\(\) \{/)
	assert.match(npmRunner, /pkg_db_refresh_needed\(\) \{/)
	assert.match(npmRunner, /pkg_refresh pacman/)
	assert.match(npmRunner, /pkg_with_lock pacman/)
})

Deno.test('main.sh keeps its own bash-flavored package management outside the POSIX sync', () => {
	assert.doesNotMatch(runnerSh, /install_with_manager\(\)/)
	assert.doesNotMatch(runnerSh, /FOUNT_PKG_MGR/)
	assert.match(runnerSh, /pkg_lock_acquire\(\) \{/)
	assert.match(runnerSh, /local -a package_list/)
	assert.match(runnerSh, /pkg_with_lock pacman/)
	assert.match(runnerSh, /pkg_refresh pacman/)
})

Deno.test('the standalone update-deno scripts source path modules and run deno_upgrade', () => {
	assert.match(updateDenoSh, /load\.sh/)
	assert.match(updateDenoSh, /require env i18n packages deno/)
	assert.match(updateDenoSh, /install_deno/)
	assert.match(updateDenoSh, /deno_upgrade/)
	const ps1 = readFileSync(join(REPO_ROOT, 'path/src/update-deno.ps1'), 'utf8')
	assert.match(ps1, /load\.ps1/)
	assert.match(ps1, /install_deno/)
	assert.match(ps1, /deno_upgrade/)
})

Deno.test('POSIX package-manager family stays in sync across every readme and consumer', async () => {
	const { canonicalCode, canonicalSource, minify, jsEscape, SH_BEGIN, SH_END } = await import('../../.esh/commands/sync-pkg-mgr.mjs')
	const canonical = canonicalCode()
	assert.ok(canonical.endsWith('\n') && !canonical.trim().includes('\n'), 'canonical must be a single compressed line')
	assert.equal(minify(canonicalSource()).trimEnd(), canonical.trim(), 'path/fount must minify to the canonical single line')
	/**
	 * 匹配标记块的全局正则（每次新建，避免 lastIndex 污染）。
	 * @returns {RegExp} 标记块匹配器。
	 */
	const blockRe = () => new RegExp(`${SH_BEGIN}\\n([\\s\\S]*?)\\n?${SH_END}\\n?`, 'g')
	const fount = readFileSync(join(REPO_ROOT, 'path/fount'), 'utf8')
	const fountBlock = blockRe().exec(fount)?.[1]
	assert.equal(fountBlock, canonicalSource().trimEnd(), 'path/fount is the readable fact source')
	const files = [
		'README.md',
		...readdirSync(join(REPO_ROOT, 'docs/readme')).filter(name => /^Readme\..*\.md$/.test(name)).map(name => `docs/readme/${name}`),
	]
	for (const file of files) {
		const src = readFileSync(join(REPO_ROOT, file), 'utf8')
		const matches = [...src.matchAll(blockRe())]
		assert.ok(matches.length >= 1, `markers missing in ${file}`)
		for (const m of matches)
			assert.equal(m[1], canonical.trim(), `${file} out of sync — run: node .esh/commands/sync-pkg-mgr.mjs`)
	}
	const mjs = readFileSync(join(REPO_ROOT, 'src/runner/npm/main.mjs'), 'utf8')
	const m = mjs.match(new RegExp(`${SH_BEGIN}\\n([\\s\\S]*?)\\n?${SH_END}\\n?`))
	assert.ok(m, 'markers missing in src/runner/npm/main.mjs')
	assert.equal(m[1], jsEscape(canonical).trim(), 'src/runner/npm/main.mjs out of sync — run: node .esh/commands/sync-pkg-mgr.mjs')
})

Deno.test('deno.sh and deno.ps1 both route managed Deno through the manager upgrade', () => {
	assert.match(denoSh, /pkg_owner_of/)
	assert.match(denoSh, /upgrade_with_manager "\$manager" "\$pkg"/)
	assert.doesNotMatch(denoSh, /managedByPacman/)
	const denoPs1 = readFileSync(join(REPO_ROOT, 'path/src/deno.ps1'), 'utf8')
	assert.match(denoPs1, /Get-FountPkgOwner/)
	assert.match(denoPs1, /Invoke-FountManagerUpgrade/)
	assert.doesNotMatch(denoPs1, /managedByPacman/)
})

Deno.test('PowerShell shared helpers cover ownership, lock, refresh throttle and manager commands', () => {
	const pkgCommon = readFileSync(join(REPO_ROOT, 'path/src/pkg_common.ps1'), 'utf8')
	for (const fn of ['Get-FountPkgOwner', 'Enter-FountPkgLock', 'Exit-FountPkgLock', 'Test-FountPkgRefreshNeeded', 'Set-FountPkgRefresh', 'Invoke-FountManagerUpgrade', 'Invoke-FountManagerInstall'])
		assert.match(pkgCommon, new RegExp(`function script:${fn}`))
	const passthrough = readFileSync(join(REPO_ROOT, 'path/src/passthrough.ps1'), 'utf8')
	assert.match(passthrough, /require pkg_common/)
	assert.doesNotMatch(passthrough, /Test-Path \/data\/data\/com.termux/)
	const mainPs1 = readFileSync(join(REPO_ROOT, 'src/runner/main.ps1'), 'utf8')
	assert.doesNotMatch(mainPs1, /Test-Path \/data\/data\/com.termux/)
	assert.match(mainPs1, /Enter-FountPkgLock "pacman"/)
})

Deno.test('server autoupdate delegates to the standalone path update-deno scripts', () => {
	const autoupdate = readFileSync(join(REPO_ROOT, 'src/server/autoupdate.mjs'), 'utf8')
	assert.doesNotMatch(autoupdate, /pacman/)
	assert.doesNotMatch(autoupdate, /deno upgrade/)
	assert.match(autoupdate, /update-deno/)
	assert.match(autoupdate, /realpathSync/)
})

Deno.test('EULA flow is reverted to the original removal behavior', () => {
	const eulaSh = readFileSync(join(REPO_ROOT, 'path/src/eula.sh'), 'utf8')
	assert.doesNotMatch(eulaSh, /declinedPreserved/)
	assert.doesNotMatch(eulaSh, /preserve_install/)
	assert.match(eulaSh, /"\$0" remove --force/)
	const runner = readFileSync(join(REPO_ROOT, 'src/runner/main.sh'), 'utf8')
	assert.doesNotMatch(runner, /declinedPreserved/)
	const locale = readFileSync(join(REPO_ROOT, 'src/public/locales/zh-CN.json'), 'utf8')
	assert.doesNotMatch(locale, /declinedPreserved/)
})
