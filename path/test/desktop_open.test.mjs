/** 实际 npm:open 依赖必须在 KDE 4/5/6 调用对应的桌面启动器。 */
/* global Deno */
import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert'
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'

import isInsideContainer from 'npm:is-inside-container'
import open from 'npm:open'
import { isWsl } from 'npm:wsl-utils'

const targetUrl = 'https://example.invalid/fount-desktop-open?source=tray&mode=test'

/**
 * 拦截实际依赖的 spawn，仅返回其选中的 bundled xdg-open 路径。
 * @returns {Promise<string>} 依赖内桌面启动脚本的绝对路径。
 */
async function captureDesktopOpener() {
	let launcher
	const originalSpawn = childProcess.spawn
	/**
	 * 记录真实依赖选择的命令，返回不启动程序的事件替身。
	 * @param {string} command 依赖选择的命令。
	 * @param {string[]} args 传给启动器的参数。
	 * @returns {EventEmitter & { unref: () => void }} 子进程事件替身。
	 */
	childProcess.spawn = (command, args) => {
		launcher = command
		deepStrictEqual(args, [targetUrl])
		const subprocess = Object.assign(new EventEmitter(), {
			/**
			 * 替身无需维持进程事件循环。
			 * @returns {void} 不创建任何资源。
			 */
			unref: () => {}
		})
		queueMicrotask(() => subprocess.emit('spawn'))
		return subprocess
	}
	try {
		await open(targetUrl)
	}
	finally {
		childProcess.spawn = originalSpawn
	}
	strictEqual(isAbsolute(launcher), true)
	strictEqual(basename(launcher), 'xdg-open')
	notStrictEqual(launcher, '/usr/bin/xdg-open')
	strictEqual(JSON.parse(readFileSync(join(dirname(launcher), 'package.json'), 'utf8')).name, 'open')
	return launcher
}

for (const version of ['4', '5', '6'])
	Deno.test({
		name: `npm:open dispatches KDE ${version} URLs to the desktop opener`,
		ignore: Deno.build.os !== 'linux' || isWsl && !isInsideContainer(),
		/**
		 * 执行完整 bundled 脚本，桌面动作由 Bash 导出函数拦截。
		 * @returns {Promise<void>} 所选 KDE 版本的启动器断言完成。
		 */
		fn: async () => {
			const result = childProcess.spawnSync('/bin/bash', ['--noprofile', '--norc', await captureDesktopOpener(), targetUrl], {
				encoding: 'utf8',
				env: {
					PATH: '',
					BASH_ENV: '',
					BROWSER: '',
					XDG_CURRENT_DESKTOP: 'KDE',
					KDE_SESSION_VERSION: version,
					XDG_RUNTIME_DIR: '/nonexistent-fount-desktop-open-test',
					'BASH_FUNC_kde-open%%': '() { printf "kde-open:%s\\n" "$*"; }',
					'BASH_FUNC_kde-open5%%': '() { printf "kde-open5:%s\\n" "$*"; }',
				},
			})
			strictEqual(result.status, 0, result.stderr)
			strictEqual(result.stderr, '')
			strictEqual(result.stdout, `${version === '5' ? 'kde-open5' : 'kde-open'}:${targetUrl}\n`)
		},
	})
