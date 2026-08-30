/** 首次启动拒绝许可时保留安装目录，不调用卸载入口。 */
/* global Deno */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const shellSource = readFileSync(new URL('../src/eula.sh', import.meta.url), 'utf8')
const powershellSource = readFileSync(new URL('../src/eula.ps1', import.meta.url), 'utf8')

Deno.test({ name: 'declining first-run EULA stops startup without uninstalling', ignore: Deno.build.os === 'windows',
	/** 拒绝许可只退出，不启动应用或执行卸载。 */
	fn: () => {
		const result = spawnSync('bash', ['-c', `${shellSource}
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
`, 'printf'], {
			encoding: 'utf8',
			env: { PATH: '/usr/bin:/bin', FOUNT_DIR: '/dev/null/fount' },
		})
		assert.equal(result.status, 1, result.stderr)
		assert.equal(result.stderr, '')
		assert.equal(result.stdout, 'eula.declined\nstopped\n')
	} })

Deno.test('both first-run gates leave removal to an explicit user command', () => {
	const shellGate = shellSource.split('ensure_fount_config() {')[1].split('\nconfirm_fount_eula() {')[0]
	const powershellGate = powershellSource.split('function script:Ensure-FountConfig {')[1].split('\nfunction script:Confirm-FountEula {')[0]
	assert.doesNotMatch(shellGate, /\bremove\b|\brm\b/)
	assert.doesNotMatch(powershellGate, /fount\.ps1.*\bremove\b/i)
	assert.match(shellGate, /eula\.required/)
	assert.match(powershellGate, /eula\.required/)
})
