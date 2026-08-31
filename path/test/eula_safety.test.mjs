/** 仅 Linux pacman 首启拒绝许可时保留安装，其他平台保留原有卸载流程。 */
/* global Deno */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const shellSource = readFileSync(new URL('../src/eula.sh', import.meta.url), 'utf8')

/**
 * 执行完整首启逻辑；文件检测、卸载入口与服务操作均由函数替身接管。
 * @param {{ osType: string, pacman: boolean, termux: boolean }} platform 被测平台能力。
 * @param {boolean} consoleReadable 是否模拟可读控制台。
 * @returns {import('node:child_process').SpawnSyncReturns<string>} 退出状态与记录输出。
 */
function runEulaGate(platform, consoleReadable) {
	return spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', `${shellSource}
OSTYPE=${platform.osType}
${platform.pacman ? 'pacman() { printf "unexpected package operation\\n" >&2; exit 97; }' : ''}
[() {
	case "$*" in
		'! -d /data/data/com.termux ]') return ${platform.termux ? 1 : 0} ;;
		'! -r /dev/tty ]') return ${consoleReadable ? 1 : 0} ;;
	esac
	builtin [ "$@"
}
fount_entry() { printf 'uninstall:%s\\n' "$*"; }
rm() { printf 'unexpected deletion\\n' >&2; exit 97; }
require() { :; }
fount_eula_env_accepted() { return 1; }
in_docker() { return 1; }
install_ipc_tools() { :; }
trap_terminal_teardown() { :; }
start_fount_status_server() { STATUS_SERVER_PID=stub; }
stop_fount_status_server() { printf '%s\\n' stopped; }
open_url_in_browser() { :; }
confirm_fount_eula() { return 1; }
get_i18n() { printf '%s\\n' "$1"; }
print_i18n_red() { printf '%s\\n' "$1"; }
copy_fount_default_config() { printf '%s\\n' copied; }
ensure_fount_config
printf '%s\\n' started
`, 'fount_entry'], {
		encoding: 'utf8',
		env: { PATH: '', BASH_ENV: '', FOUNT_DIR: '/dev/null/fount' },
	})
}

for (const platform of [
	{ name: 'Linux pacman', osType: 'linux-gnu', pacman: true, termux: false, preserve: true },
	{ name: 'Linux without pacman', osType: 'linux-gnu', pacman: false, termux: false, preserve: false },
	{ name: 'macOS with pacman', osType: 'darwin23', pacman: true, termux: false, preserve: false },
	{ name: 'Termux with pacman', osType: 'linux-android', pacman: true, termux: true, preserve: false },
])
	for (const consoleReadable of [true, false])
		Deno.test({
			name: `${platform.name} ${consoleReadable ? 'declined' : 'console-unavailable'} EULA preserves the platform removal policy`,
			ignore: Deno.build.os === 'windows',
			/**
			 * 逐平台检查退出状态、许可文案及精确卸载参数。
			 * @returns {void} 断言首启行为与平台策略一致。
			 */
			fn: () => {
				const result = runEulaGate(platform, consoleReadable)
				assert.equal(result.status, 1, result.stderr)
				if (consoleReadable) {
					assert.equal(result.stderr, '')
					assert.equal(result.stdout, platform.preserve
						? 'eula.declinedPreserved\nstopped\n'
						: 'eula.declined\nstopped\nuninstall:remove --force\n')
				}
				else {
					assert.equal(result.stderr, 'eula.required\nhttps://steve02081504.github.io/fount/EULA/\n')
					assert.equal(result.stdout, platform.preserve ? '' : 'uninstall:remove\n')
				}
			},
		})
