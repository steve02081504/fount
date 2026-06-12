import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

import { __dirname } from '../server/base.mjs'
import { config } from '../server/server.mjs'

/**
 * 读取 fount 监听端口。
 * @returns {number} 端口号。
 */
function getServerPort() {
	if (Number.isFinite(config?.port)) return config.port
	return 8931
}

/**
 * 使用 WebUI 打开内置 log_viewer 页面。
 * @returns {Promise<void>}
 */
export async function openLogViewerWindow() {
	const url = `http://127.0.0.1:${getServerPort()}/log_viewer/`
	const { WebUI } = await import('jsr:@webui/deno-webui')
	const win = new WebUI()
	win.setSize(960, 720)
	win.setFrameless(false)
	win.setTransparent(false)
	win.setResizable(true)
	void win.show(url)
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
