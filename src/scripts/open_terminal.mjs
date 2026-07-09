import path from 'node:path'
import process from 'node:process'

import { where_command } from 'npm:@steve02081504/exec'
import open from 'npm:open'

import { __dirname } from '../server/base.mjs'
import { hosturl } from '../server/server.mjs'

import { launchDetachedProgram } from './launch_external.mjs'

/**
 * 打开内置 log_viewer 浏览器窗口。
 * @returns {Promise<void>}
 */
export async function openLogViewerWindow() {
	await open(hosturl + '/log_viewer/')
}

/**
 * 在可见终端中启动 `fount log` CLI。
 * @returns {Promise<void>}
 */
export async function spawnFountLog() {
	const fountDir = __dirname
	const fountScript = path.join(fountDir, 'path', process.platform === 'win32' ? 'fount.bat' : 'fount')
	const spawnEnv = { FOUNT_CLICK: '1' }

	if (process.platform === 'win32') {
		await launchDetachedProgram({
			command: 'cmd.exe',
			args: ['/c', 'start', '', 'cmd', '/k', fountScript, 'log'],
			cwd: fountDir,
			env: spawnEnv,
		})
		return
	}

	/** @type {[string, string[]][]} */
	const terminals = [
		['gnome-terminal', ['--', fountScript, 'log']],
		['konsole', ['-e', fountScript, 'log']],
		['xfce4-terminal', ['-e', `${fountScript} log`]],
		['x-terminal-emulator', ['-e', fountScript, 'log']],
		['kitty', [fountScript, 'log']],
		['alacritty', ['-e', fountScript, 'log']],
	]
	for (const [command, args] of terminals) {
		if (!await where_command(command)) continue
		await launchDetachedProgram({ command, args, cwd: fountDir, env: spawnEnv })
		return
	}

	await launchDetachedProgram({ command: fountScript, args: ['log'], cwd: fountDir, env: spawnEnv })
}

/**
 * 优先 WebUI 打开 log_viewer，失败时回退 CLI `fount log`。
 * @returns {Promise<void>}
 */
export async function openTerminal() {
	try {
		await openLogViewerWindow()
	}
	catch (err) {
		console.error(err)
		await spawnFountLog()
	}
}
