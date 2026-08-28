/**
 * 首次安装无 config.json 时，具名命令（如 `fount server`）不得被吃掉变成默认的 background+log。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'
import { pwsh_exec } from 'npm:@steve02081504/exec'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

const indexPs1Path = join(REPO_ROOT, 'path', 'src', 'index.ps1')
const indexShPath = join(REPO_ROOT, 'path', 'src', 'index.sh')

/**
 * 复现 Windows path smoke：`fount server` 只打出 FOUNT_CI_HOOK:log。
 * `cmd_open @(@('open') + @($args))` 的 `@()` 是数组子表达式不是 splat，
 * Skip 1 后剩余为空，落到默认 `background`+`log`。
 */
Deno.test('powershell @(@()) does not splat; Skip-1 drops server', async () => {
	const result = await pwsh_exec(`
function Invoke-LikeIndex {
	function cmd_open {
		(@($args | Select-Object -Skip 1) -join ',')
	}
	cmd_open @(@('open') + @($args))
}
Invoke-LikeIndex server
`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), '', result.stdout)
})

Deno.test('cmd_open open @args keeps the original command after Skip-1', async () => {
	const result = await pwsh_exec(`
function Invoke-LikeIndex {
	function cmd_open {
		(@($args | Select-Object -Skip 1) -join ',')
	}
	cmd_open open @args
}
Invoke-LikeIndex server
`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'server', result.stdout)
})

Deno.test('first-run eula gate does not route named cmds through cmd_open', async () => {
	const indexPs1 = await readFile(indexPs1Path, 'utf8')
	const indexSh = await readFile(indexShPath, 'utf8')
	const psGate = indexPs1.split('$cmd = $args[0]')[1].split('if ($cmd -and')[0]
	assert(!psGate.includes('cmd_open'), 'pwsh first-run must not call cmd_open')
	assert(psGate.includes('Ensure-FountConfig'), 'pwsh first-run copies config then falls through')
	assert(!indexPs1.includes('cmd_open @(@('), 'pwsh must not fake-splat with @(@())')
	const shGate = indexSh.split('unset FOUNT_CLICK')[1].split('cmd="${1:-}"')[0]
	assert(!shGate.includes('cmd_open'), 'bash first-run must not call cmd_open')
	assert(shGate.includes('ensure_fount_config'), 'bash first-run copies config then falls through')
})

Deno.test('cmd_open skips cold-boot page while install wait is active', async () => {
	const openPs1 = await readFile(join(REPO_ROOT, 'path', 'src', 'cmd', 'open.ps1'), 'utf8')
	const openSh = await readFile(join(REPO_ROOT, 'path', 'src', 'cmd', 'open.sh'), 'utf8')
	const eulaPs1 = await readFile(join(REPO_ROOT, 'path', 'src', 'eula.ps1'), 'utf8')
	const eulaSh = await readFile(join(REPO_ROOT, 'path', 'src', 'eula.sh'), 'utf8')
	assert(openPs1.includes('FOUNT_INSTALL_WAIT'), 'pwsh cmd_open must honor install-wait')
	assert(openSh.includes('FOUNT_INSTALL_WAIT'), 'bash cmd_open must honor install-wait')
	const psOpen = openPs1.split('handle_docker_passthrough')[1]
	assert(psOpen.indexOf('FOUNT_INSTALL_WAIT') < psOpen.indexOf('cold_bootting'), 'pwsh: skip check before cold-boot URL')
	const shOpen = openSh.split('handle_docker_passthrough')[1]
	assert(shOpen.indexOf('FOUNT_INSTALL_WAIT') < shOpen.indexOf('cold_bootting'), 'bash: skip check before cold-boot URL')
	assert(eulaSh.includes('begin_fount_install_wait'), 'bash sets install-wait when opening wait/install')
	assert(eulaPs1.includes('Begin-FountInstallWait'), 'pwsh sets install-wait when opening wait/install')
	assert(eulaPs1.includes('Open-BrowserUrl $script:FountInstallWaitUrl'), 'wait/install opens via Open-BrowserUrl')
	const shEnsure = eulaSh.split('ensure_fount_config()')[1].split('confirm_fount_eula()')[0]
	assert(shEnsure.indexOf('start_fount_status_server') < shEnsure.indexOf('begin_fount_install_wait'), '8930 is up before wait/install')
	assert(shEnsure.indexOf('begin_fount_install_wait') < shEnsure.indexOf('FOUNT_INSTALL_WAIT_URL'), 'flag before opening wait/install')
	assert(!shEnsure.includes('stop_fount_status_server\n\tcopy_fount'), 'do not stop 8930 after EULA accept')
	const psEnsure = eulaPs1.split('function script:Ensure-FountConfig')[1].split('function script:Confirm-FountEula')[0]
	assert(psEnsure.includes('Start-FountStatusServer'), 'pwsh starts 8930 for wait/install')
	assert(psEnsure.indexOf('Start-FountStatusServer') < psEnsure.indexOf('Begin-FountInstallWait'))
	assert(psEnsure.indexOf('Begin-FountInstallWait') < psEnsure.indexOf('Open-FountInstallWaitPage'), 'flag before opening wait/install')
	assert(!/Stop-FountStatusServer\s*\r?\n\s*Copy-FountDefaultConfig/.test(psEnsure), 'do not stop 8930 after EULA accept')
})
