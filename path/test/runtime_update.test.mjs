/**
 * 包管理器处理统一：归属检测、按管理器文件锁、数据库刷新节流，以及 deno 更新的
 * 「被管理则管理器升级 / 未管理则 deno 自升级」。软件包管理、运行时升级和文件
 * 修改由内存中的 Shell 函数替身接管，锁与刷新时间戳落在临时目录。
 */
/* global Deno */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { available, bash_exec, pwsh_exec } from 'npm:@steve02081504/exec'

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
 * @returns {Promise<import('npm:@steve02081504/exec').ExecResult>} 子进程退出状态与输出。
 */
function runBash(script, extraEnv = {}) {
	return bash_exec(script, {
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
 * 主机是否提供 pwsh（或回退的 powershell），供 PowerShell 行为用例门控。
 * @type {boolean}
 */
const pwshAvailable = (await available).pwsh || (await available).powershell

/**
 * 执行 PowerShell 脚本；仅在 pwsh 可用时注册用例。
 * @param {string} name 用例名称。
 * @param {(stateDir: string, run: (script: string) => Promise<import('npm:@steve02081504/exec').ExecResult>) => Promise<void>} test 用例逻辑。
 * @returns {void} 注册测试。
 */
function pwshTest(name, test) {
	Deno.test({
		name,
		/** 测试主体：构造临时状态目录并在 pwsh 中执行用例。 */
		fn: async () => {
			const root = mkdtempSync(join(tmpdir(), 'fount-pkg-pwsh-'))
			const stateDir = join(root, 'state')
			mkdirSync(stateDir, { recursive: true })
			/**
			 * 在 pwsh 中执行脚本，注入临时状态目录环境。
			 * 脚本以 `exit 0` 收尾，避免被 stub 污染的最后退出码；用例失败通过 throw 终止。
			 * @param {string} script 要执行的 PowerShell 代码。
			 * @returns {Promise<import('npm:@steve02081504/exec').ExecResult>} 子进程退出状态与输出。
			 */
			const run = (script) => pwsh_exec(`${script}\nexit 0`, {
				env: { ...process.env, FOUNT_PKG_STATE_DIR: stateDir },
			})
			try { await test(stateDir, run) }
			finally { rmSync(root, { recursive: true, force: true }) }
		},
		ignore: !pwshAvailable,
	})
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
	['rpm+dnf', 'rpm() { printf \'mypkg\\n\'; }; dnf() { :; }', 'dnf mypkg'],
	['rpm+yum', 'rpm() { printf \'mypkg\\n\'; }; yum() { :; }', 'yum mypkg'],
	['rpm+zypper', 'rpm() { printf \'mypkg\\n\'; }; zypper() { :; }', 'zypper mypkg'],
	['apk', 'apk() { printf \'/usr/bin/demo is owned by mypkg\\n\'; }', 'apk mypkg'],
	['brew', 'brew() { printf \'/usr/local\\n\'; }', 'brew deno'],
	['pkg', 'pkg() { printf \'mypkg\\n\'; }', 'pkg mypkg'],
	['none', '', ''],
])
	bashTest(`pkg_owner_of reports ${name} ownership`, async () => {
		const result = await runBash(`
${packagesSh}
${setup}
owner=$(pkg_owner_of /usr/local/Cellar/deno/2.9.6/bin/deno)
printf 'owner:%s\\n' "$owner"
`)
		assert.equal(result.code, 0, result.stderr)
		assert.equal(result.stdout, `owner:${expected}\n`)
	})

bashTest('resolve_realpath follows symlink chains portably', async () => {
	const root = mkdtempSync(join(tmpdir(), 'fount-realpath-'))
	try {
		const target = join(root, 'target')
		const link = join(root, 'link')
		writeFileSync(target, 'x')
		Deno.symlinkSync(target, link)
		const result = await runBash(`
${packagesSh}
printf '%s\\n' "$(resolve_realpath ${JSON.stringify(link)})"
`)
		assert.equal(result.code, 0, result.stderr)
		assert.equal(result.stdout.trim(), target)
	}
	finally { rmSync(root, { recursive: true, force: true }) }
})

// --- 锁与刷新节流 ---

bashTest('a stale lock with a dead pid is stolen', async () => {
	const { env, stateDir, cleanup } = tempEnv()
	try {
		mkdirSync(join(stateDir, 'pacman.lock'))
		writeFileSync(join(stateDir, 'pacman.lock', 'pid'), '999999999')
		const result = await runBash(`
${packagesSh}
pkg_lock_acquire pacman
rc=$?
printf 'rc:%s\\n' "$rc"
pkg_lock_release
printf 'held:%s\\n' "\${FOUNT_PKG_LOCK_DIR:-}"
`, env)
		assert.equal(result.code, 0, result.stderr)
		assert.equal(result.stdout, 'rc:0\nheld:\n')
		assert.equal(existsSync(join(stateDir, 'pacman.lock')), false)
	}
	finally { cleanup() }
})

bashTest('a live lock times out instead of stealing', async () => {
	const { env, stateDir, cleanup } = tempEnv()
	try {
		mkdirSync(join(stateDir, 'pacman.lock'))
		writeFileSync(join(stateDir, 'pacman.lock', 'pid'), String(process.pid))
		const result = await runBash(`
FOUNT_PKG_LOCK_TIMEOUT=1
${packagesSh}
pkg_lock_acquire pacman
printf 'rc:%s\\n' "$?"
`, env)
		assert.equal(result.code, 0, result.stderr)
		assert.equal(result.stdout, 'rc:1\n')
	}
	finally { cleanup() }
})

bashTest('install_with_manager throttles the database refresh to once per interval', async () => {
	const { env, stateDir, cleanup } = tempEnv()
	try {
		const script = `
exec 3>&2
${packagesSh}
id() { printf '1000\\n'; }
sudo() { printf 'sudo:%s\\n' "$*" >&3; "$@"; }
apt-get() {
	printf 'apt-get:%s\\n' "$*" >&3
	return 0
}
install_with_manager apt-get curl
install_with_manager apt-get curl
`
		const result = await runBash(script, env)
		assert.equal(result.code, 0, result.stderr)
		const refreshLines = (result.stderr.match(/apt-get:update -y/g) || []).length
		const installLines = (result.stderr.match(/apt-get:install -y curl/g) || []).length
		assert.equal(refreshLines, 1, 'refresh must run exactly once within the interval')
		assert.equal(installLines, 2)
	}
	finally { cleanup() }
})

bashTest('install_with_manager refreshes again after the interval elapses', async () => {
	const { env, stateDir, cleanup } = tempEnv()
	try {
		writeFileSync(join(stateDir, 'apt-get.refresh'), '0')
		const script = `
exec 3>&2
${packagesSh}
id() { printf '1000\\n'; }
sudo() { printf 'sudo:%s\\n' "$*" >&3; "$@"; }
apt-get() {
	printf 'apt-get:%s\\n' "$*" >&3
	return 0
}
install_with_manager apt-get curl
`
		const result = await runBash(script, env)
		assert.equal(result.code, 0, result.stderr)
		assert.equal((result.stderr.match(/apt-get:update -y/g) || []).length, 1)
	}
	finally { cleanup() }
})

bashTest('install_with_manager runs a single atomic pacman -Syu without a separate refresh', async () => {
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
`
		const result = await runBash(script, env)
		assert.equal(result.code, 0, result.stderr)
		assert.match(result.stderr, /pacman:-Syu --needed --noconfirm curl/)
		assert.doesNotMatch(result.stderr, /pacman:-Syy/)
		assert.doesNotMatch(result.stderr, /pacman:-Sy\\b/)
		assert.equal(existsSync(join(stateDir, 'pacman.refresh')), false)
	}
	finally { cleanup() }
})

bashTest('root without sudo can snap install directly without the sudo prefix', async () => {
	const { env, cleanup } = tempEnv()
	try {
		const script = `
exec 3>&2
${packagesSh}
id() { printf '0\\n'; }
sudo() { printf 'sudo:%s\\n' "$*" >&3; "$@"; }
snap() {
	printf 'snap:%s\\n' "$*" >&3
	return 0
}
install_with_manager snap deno
`
		const result = await runBash(script, env)
		assert.equal(result.code, 0, result.stderr)
		assert.match(result.stderr, /snap:install deno/)
		assert.doesNotMatch(result.stderr, /sudo:snap/)
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
	if [[ "$1" == '-Syu' || "$1" == '-S' || "$1" == '-Sy' ]]; then return "$upgrade_status"; fi
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

bashTest('managed Deno is upgraded through its package manager and marks the flag', async () => {
	const { env, stateDir, fountDir, cleanup } = tempEnv()
	try {
		const result = await runBash(`
${packagesSh}
${denoSh}
${denoStubs.replace('__STATE__', stateDir)}
deno_upgrade
`, env)
		assert.equal(result.code, 0, result.stderr)
		assert.match(result.stderr, /pacman:-Qqo -- \/launcher\/deno/)
		assert.match(result.stderr, /pacman:-Syu --noconfirm deno/)
		assert.equal(existsSync(join(fountDir, 'data/installer/deno_upgraded')), true)
		assert.doesNotMatch(result.stderr, /deno:upgrade/)
	}
	finally { cleanup() }
})

bashTest('a package-managed Deno cannot honor a version pin and warns', async () => {
	const { env, stateDir, fountDir, cleanup } = tempEnv()
	try {
		const result = await runBash(`
${packagesSh}
${denoSh}
${denoStubs.replace('__STATE__', stateDir)}
test_pin='2.9.4'
deno_upgrade
`, env)
		assert.equal(result.code, 0, result.stderr)
		assert.match(result.stderr, /warning:deno.pinNotHonored spec 2.9.4 manager pacman/)
		assert.equal(existsSync(join(fountDir, 'data/installer/deno_upgraded')), true)
	}
	finally { cleanup() }
})

bashTest('a failed managed upgrade warns and keeps the installation as-is', async () => {
	const { env, stateDir, fountDir, cleanup } = tempEnv()
	try {
		const result = await runBash(`
${packagesSh}
${denoSh}
${denoStubs.replace('__STATE__', stateDir)}
upgrade_status=42
deno_upgrade
`, env)
		assert.equal(result.code, 0, result.stderr)
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
	bashTest(`user-managed Deno preserves requested upgrade ${expected} (${channel || 'default'} channel)`, async () => {
		const { env, stateDir, fountDir, cleanup } = tempEnv()
		try {
			const result = await runBash(`
${packagesSh}
${denoSh}
${denoStubs.replace('__STATE__', stateDir)}
package_status=1
version='${version}'
test_pin='${pinned}'
base_deno_upgrade '${channel}'
`, env)
			assert.equal(result.code, 0, result.stderr)
			assert.deepEqual(result.stderr.trim().split('\n').filter(l => l.startsWith('deno:upgrade')), [`deno:upgrade -q ${expected}`])
			assert.equal(existsSync(join(fountDir, 'data/installer/deno_upgraded')), false)
		}
		finally { cleanup() }
	})

bashTest('non-pacman hosts keep self-upgrade even when a package manager is present', async () => {
	const { env, stateDir, fountDir, cleanup } = tempEnv()
	try {
		const result = await runBash(`
${packagesSh}
${denoSh}
${denoStubs.replace('__STATE__', stateDir)}
package_status=1
version='deno 2.9.5'
base_deno_upgrade ''
`, env)
		assert.equal(result.code, 0, result.stderr)
		assert.match(result.stderr, /pacman:-Qqo -- \/launcher\/deno/)
		assert.match(result.stderr, /deno:upgrade -q stable/)
		assert.equal(existsSync(join(fountDir, 'data/installer/deno_upgraded')), false)
	}
	finally { cleanup() }
})

// --- 独立 update-deno 脚本 ---

bashTest('the standalone update-deno script upgrades an unmanaged Deno end-to-end', async () => {
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
	writeFileSync(join(stubBin, 'deno'), `#!/bin/sh\nif [ "$1" = "-V" ]; then echo "deno 2.9.5"; elif [ "$1" = "upgrade" ]; then echo "deno:$*" >>"${'$'}FOUNT_DENO_TRACE"; fi\n`)
	writeFileSync(join(stubBin, 'jq'), '#!/bin/sh\necho {}\n')
	Deno.chmodSync(join(stubBin, 'deno'), 0o755)
	Deno.chmodSync(join(stubBin, 'jq'), 0o755)
	try {
		const result = await runBash(`bash "${fountDir}/path/src/update-deno.sh"`, {
			FOUNT_DIR: fountDir,
			FOUNT_PKG_STATE_DIR: stateDir,
			FOUNT_DENO_TRACE: trace,
			PATH: `${stubBin}:${process.env.PATH}`,
		})
		assert.equal(result.code, 0, result.stderr)
		assert.equal(existsSync(join(fountDir, 'data/installer/deno_upgraded')), true)
		assert.match(readFileSync(trace, 'utf8'), /deno:upgrade -q stable/)
	}
	finally { rmSync(root, { recursive: true, force: true }) }
})

// --- 崩溃修复与重启语义保持 ---

bashTest('keepalive crash still repairs the app without disrupting managed Deno handling', async () => {
	const { env, stateDir, cleanup } = tempEnv()
	try {
		const result = await runBash(`
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
		assert.equal(result.code, 0, result.stderr)
		assert.equal(result.stdout, 'run:initial-argument\napp-update\nrun:\n')
		assert.match(result.stderr, /pacman:-Syu --noconfirm deno/)
	}
	finally { cleanup() }
})

bashTest('explicit exit-131 update still updates and restarts without replaying command arguments', async () => {
	const result = await runBash(`
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
	assert.equal(result.code, 0, result.stderr)
	assert.equal(result.stdout, 'run:initial-argument\nupdate\nrun:\n')
	assert.equal(result.stderr, '')
})

// --- 入口副本结构对齐 ---

Deno.test('path/fount keeps a uniform POSIX install_package with lock and throttle helpers', () => {
	assert.doesNotMatch(pathEntry, /uname -s.*termux/)
	assert.match(pathEntry, /pkg_lock_acquire\(\) \{/)
	assert.match(pathEntry, /pkg_db_refresh_needed\(\) \{/)
	assert.match(pathEntry, /pkg_with_lock pacman \$_has_sudo pacman -Syu --needed --noconfirm/)
	assert.doesNotMatch(pathEntry, /pkg_refresh pacman/)
})

Deno.test('npm bootstrap keeps a uniform install_package without a pacman special case', () => {
	assert.doesNotMatch(npmRunner, /uname -s.*termux/)
	assert.match(npmRunner, /pkg_lock_acquire\(\) \{/)
	assert.match(npmRunner, /pkg_db_refresh_needed\(\) \{/)
	assert.match(npmRunner, /pkg_with_lock pacman \$_has_sudo pacman -Syu --needed --noconfirm/)
	assert.doesNotMatch(npmRunner, /pkg_refresh pacman/)
})

Deno.test('main.sh keeps its own bash-flavored package management outside the POSIX sync', () => {
	assert.doesNotMatch(runnerSh, /install_with_manager\(\)/)
	assert.doesNotMatch(runnerSh, /FOUNT_PKG_MGR/)
	assert.match(runnerSh, /pkg_lock_acquire\(\) \{/)
	assert.match(runnerSh, /local -a package_list/)
	assert.match(runnerSh, /pkg_with_lock pacman \$has_sudo pacman -Syu --needed --noconfirm/)
	assert.doesNotMatch(runnerSh, /pkg_refresh pacman/)
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
	assert.ok(!minify(canonicalSource()).includes('\n'), 'minify must produce a single line without bare newlines')
	assert.match(minify(canonicalSource()), /install_package\(\) \{/, 'minified output preserves the install_package() function')
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
	const frontendBlock = readFileSync(join(REPO_ROOT, 'src/public/parts/shells/subfounts/public/src/pkg_mgr_block.mjs'), 'utf8')
	const frontendMatch = frontendBlock.match(new RegExp(`${SH_BEGIN}\\n([\\s\\S]*?)\\n?${SH_END}`))
	assert.ok(frontendMatch, 'markers missing in subfounts frontend pkg_mgr_block.mjs')
	assert.equal(frontendMatch[1], jsEscape(canonical).trim(), 'subfounts frontend pkg_mgr_block.mjs out of sync — run: node .esh/commands/sync-pkg-mgr.mjs')
})

Deno.test('deno.sh and deno.ps1 both route managed Deno through the manager upgrade', () => {
	assert.match(denoSh, /pkg_owner_of/)
	assert.match(denoSh, /upgrade_with_manager "\$manager" "\$package_name"/)
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

pwshTest('Get-FountPkgOwner reports ownership from stubbed package managers', async (stateDir, run) => {
	const pkgCommon = join(REPO_ROOT, 'path/src/pkg_common.ps1').replaceAll('\\', '/')
	const blockers = {
		dpkg: 'function dpkg() { $global:LASTEXITCODE = 1 }',
		pacman: 'function pacman() { $global:LASTEXITCODE = 1 }',
		rpm: 'function rpm() { $global:LASTEXITCODE = 1 }',
		apk: 'function apk() { $global:LASTEXITCODE = 1 }',
		brew: 'function brew() { return }',
		pkg: 'function pkg() { $global:LASTEXITCODE = 1 }',
		snap: 'function snap() { return }',
	}
	const scenarios = [
		{ name: 'dpkg/apt', path: '/usr/bin/demo', expect: 'apt-get mypkg', exclude: ['dpkg'], stubs: 'function dpkg() { $global:LASTEXITCODE = 0; \'mypkg: /usr/bin/demo\' }' },
		{ name: 'pacman', path: '/usr/bin/demo', expect: 'pacman mypkg', exclude: ['pacman'], stubs: 'function pacman() { $global:LASTEXITCODE = 0; \'mypkg\' }' },
		{ name: 'rpm+dnf', path: '/usr/bin/demo', expect: 'dnf mypkg', exclude: ['rpm', 'dnf'], stubs: 'function rpm() { $global:LASTEXITCODE = 0; \'mypkg\' }; function dnf() { $global:LASTEXITCODE = 0 }' },
		{ name: 'apk', path: '/usr/bin/demo', expect: 'apk mypkg', exclude: ['apk'], stubs: 'function apk() { $global:LASTEXITCODE = 0; \'/usr/bin/demo is owned by mypkg\' }' },
		{ name: 'brew', path: '/usr/local/Cellar/deno/2.9.6/bin/deno', expect: 'brew deno', exclude: ['brew'], stubs: 'function brew() { \'/usr/local\' }' },
		{ name: 'pkg', path: '/usr/bin/demo', expect: 'pkg mypkg', exclude: ['pkg'], stubs: 'function pkg() { $global:LASTEXITCODE = 0; \'mypkg\' }' },
	]
	for (const { name, path, expect, exclude, stubs } of scenarios) {
		const [manager, pkg] = expect.split(' ')
		const others = Object.entries(blockers).filter(([m]) => !exclude.includes(m)).map(([, s]) => s).join('; ')
		const result = await run(`
. '${pkgCommon}'
${stubs};
${others}
$o = Get-FountPkgOwner '${path}'
if ($null -eq $o) { throw 'no owner found' }
if ($o.Manager -ne '${manager}' -or $o.Package -ne '${pkg}') { throw "mismatch: $($o.Manager) $($o.Package)" }
`)
		assert.equal(result.code, 0, `${name}: ${result.stderr}`)
	}
	const none = await run(`
. '${pkgCommon}'
${Object.values(blockers).join('; ')}
$o = Get-FountPkgOwner '/usr/bin/demo'
if ($null -ne $o) { throw "expected no owner, got $($o.Manager) $($o.Package)" }
`)
	assert.equal(none.code, 0, none.stderr)
})

pwshTest('Enter-FountPkgLock acquires and releases a per-manager lock and steals stale locks', async (stateDir, run) => {
	const pkgCommon = join(REPO_ROOT, 'path/src/pkg_common.ps1').replaceAll('\\', '/')
	const acquire = await run(`
. '${pkgCommon}'
if (-not (Enter-FountPkgLock 'apt-get')) { throw 'lock acquire failed' }
if (-not (Test-Path -LiteralPath '${stateDir}/apt-get.lock/pid')) { throw 'lock dir missing' }
$lockPid = (Get-Content -LiteralPath '${stateDir}/apt-get.lock/pid' -Raw).Trim()
if (-not $lockPid) { throw 'pid file empty' }
Exit-FountPkgLock
if (Test-Path -LiteralPath '${stateDir}/apt-get.lock') { throw 'lock not released' }
`)
	assert.equal(acquire.code, 0, acquire.stderr)
	const stale = await run(`
. '${pkgCommon}'
New-Item -ItemType Directory -Path '${stateDir}/apt-get.lock' -Force | Out-Null
Set-Content -LiteralPath '${stateDir}/apt-get.lock/pid' -Value '999999999' -Encoding ascii
if (-not (Enter-FountPkgLock 'apt-get')) { throw 'stale lock not stolen' }
Exit-FountPkgLock
`)
	assert.equal(stale.code, 0, stale.stderr)
})

pwshTest('Invoke-FountManagerInstall runs refresh and install under lock with a stubbed manager', async (stateDir, run) => {
	const pkgCommon = join(REPO_ROOT, 'path/src/pkg_common.ps1').replaceAll('\\', '/')
	const trace = join(stateDir, 'trace.txt')
	const result = await run(`
. '${pkgCommon}'
function id { '1000' }
function sudo { $global:LASTEXITCODE = 0; $all = @(); foreach ($a in $args) { $all += $a }; "sudo $($all -join ' ')" | Add-Content -LiteralPath '${trace}' }
function apt-get { $global:LASTEXITCODE = 0; $all = @(); foreach ($a in $args) { $all += $a }; "apt-get $($all -join ' ')" | Add-Content -LiteralPath '${trace}' }
$rc = Invoke-FountManagerInstall 'apt-get' 'curl'
if ($rc -ne 0) { throw "install rc=$rc" }
$trace = Get-Content -LiteralPath '${trace}' -Raw
if ($trace -notmatch 'apt-get update -y') { throw "missing refresh: $trace" }
if ($trace -notmatch 'apt-get install -y curl') { throw "missing install: $trace" }
if (-not (Test-Path -LiteralPath '${stateDir}/apt-get.refresh')) { throw 'refresh not marked' }
`)
	assert.equal(result.code, 0, result.stderr)
})

pwshTest('root users without sudo can still run snap install and refresh', async (stateDir, run) => {
	const pkgCommon = join(REPO_ROOT, 'path/src/pkg_common.ps1').replaceAll('\\', '/')
	const trace = join(stateDir, 'trace.txt')
	const result = await run(`
. '${pkgCommon}'
function Get-Command {
	param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Rest)
	$name = $null
	for ($i = 0; $i -lt $Rest.Count; $i++) {
		if ($Rest[$i] -eq '-Name') { $name = $Rest[$i + 1]; break }
	}
	if ($null -eq $name -and $Rest.Count -gt 0 -and -not $Rest[0].StartsWith('-')) { $name = $Rest[0] }
	if ($name -eq 'sudo') { return $null }
	return Microsoft.PowerShell.Core\\Get-Command -Name $name -ErrorAction SilentlyContinue
}
function id { '0' }
function sudo { throw 'sudo must not run for root' }
function snap { $global:LASTEXITCODE = 0; $all = @(); foreach ($a in $args) { $all += $a }; "snap $($all -join ' ')" | Add-Content -LiteralPath '${trace}' }
$rc = Invoke-FountManagerInstall 'snap' 'deno'
if ($rc -ne 0) { throw "snap install rc=$rc" }
$rc2 = Invoke-FountManagerUpgrade 'snap' 'deno'
if ($rc2 -ne 0) { throw "snap refresh rc=$rc2" }
$trace = Get-Content -LiteralPath '${trace}' -Raw
if ($trace -notmatch 'snap install deno') { throw "missing install: $trace" }
if ($trace -notmatch 'snap refresh deno') { throw "missing refresh: $trace" }
`)
	assert.equal(result.code, 0, result.stderr)
})

pwshTest('pacman install and upgrade are single atomic -Syu operations without a separate refresh', async (stateDir, run) => {
	const pkgCommon = join(REPO_ROOT, 'path/src/pkg_common.ps1').replaceAll('\\', '/')
	const trace = join(stateDir, 'trace.txt')
	const result = await run(`
. '${pkgCommon}'
function id { '0' }
function pacman { $global:LASTEXITCODE = 0; $all = @(); foreach ($a in $args) { $all += $a }; "pacman $($all -join ' ')" | Add-Content -LiteralPath '${trace}' }
$rc = Invoke-FountManagerInstall 'pacman' 'curl'
if ($rc -ne 0) { throw "install rc=$rc" }
$rc2 = Invoke-FountManagerUpgrade 'pacman' 'deno'
if ($rc2 -ne 0) { throw "upgrade rc=$rc2" }
$trace = Get-Content -LiteralPath '${trace}' -Raw
if ($trace -notmatch 'pacman -Syu --needed --noconfirm curl') { throw "missing atomic install: $trace" }
if ($trace -notmatch 'pacman -Syu --noconfirm deno') { throw "missing atomic upgrade: $trace" }
if ($trace -match 'pacman -Sy\\b') { throw "standalone -Sy refresh must not run: $trace" }
if ($trace -match 'pacman -Syy\\b') { throw "standalone -Syy refresh must not run: $trace" }
if (Test-Path -LiteralPath '${stateDir}/pacman.refresh') { throw 'pacman must not mark a separate DB refresh' }
`)
	assert.equal(result.code, 0, result.stderr)
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
