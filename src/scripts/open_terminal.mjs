import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

import open from 'npm:open'

import { __dirname } from '../server/base.mjs'
import { hosturl } from '../server/server.mjs'

/**
 * 打开内置 log_viewer 浏览器窗口。
 * @returns {Promise<void>}
 */
export async function openLogViewerWindow() {
	await open(hosturl + '/log_viewer/')
}

/**
 * 在可见终端中启动 `fount log` CLI。
 * @returns {void}
 */
export function spawnFountLog() {
	const fountDir = __dirname
	const fountScript = path.join(fountDir, 'path', process.platform === 'win32' ? 'fount.bat' : 'fount')

	if (process.platform === 'win32') {
		spawn('cmd.exe', ['/c', 'start', '', 'cmd', '/k', fountScript, 'log'], {
			detached: true,
			stdio: 'ignore',
			cwd: fountDir,
			env: {
				FOUNT_CLICK: '1',
			},
		}).unref()
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
	for (const [cmd, args] of terminals) {
		const child = spawn(cmd, args, {
			detached: true,
			stdio: 'ignore',
			cwd: fountDir,
			env: {
				FOUNT_CLICK: '1',
			},
		})
		child.on('error', () => { /* try next */ })
		child.unref()
		return
	}

	spawn(fountScript, ['log'], { detached: true, stdio: 'ignore', cwd: fountDir }).unref()
}

/**
 * 优先 WebUI 打开 log_viewer，失败时回退 CLI `fount log`。
 * @returns {Promise<void>}
 */
export async function openTerminal() {
	try {
		await openLogViewerWindow()
	}
	catch(err) {
		console.error(err)
		spawnFountLog()
	}
}
