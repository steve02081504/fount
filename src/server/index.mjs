/**
 * 这是应用程序服务器的主入口点。它初始化 Sentry 进行错误报告，
 * 解析命令行参数，配置服务器，并启动初始化过程。
 * 它还通过 IPC 处理向正在运行的服务器实例发送命令。
 */
import { existsSync } from 'node:fs'
import process from 'node:process'

import * as Sentry from 'npm:@sentry/deno'

import { console } from '../scripts/i18n.mjs'

import { __dirname, set_start } from './base.mjs'
import { init } from './server.mjs'

// 初始化 Sentry 进行错误报告。
let skipBreadcrumb = false
/**
 * 是否启用 Sentry 进行错误报告
 */
export const sentry_enabled = !existsSync(__dirname + '/.noerrorreport')
if (sentry_enabled) Sentry.init({
	dsn: 'https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704',
	/**
	 * @param {object} breadcrumb - Sentry捕获到的面包屑事件对象。
	 * @param {object} hint - 包含原始事件等信息的辅助对象。
	 * @returns {object | null} 返回修改后的面包屑对象，或 null 以忽略此面包屑。
	 */
	beforeBreadcrumb: (breadcrumb, hint) => {
		if (skipBreadcrumb) return null
		return breadcrumb
	}
})
console.noBreadcrumb = {
	/**
	 * 写入日志并跳过面包屑记录
	 * @param {...any} args - 要记录的日志
	 */
	log: (...args) => {
		skipBreadcrumb = true
		console.log(...args)
		skipBreadcrumb = false
	}
}

set_start()

console.logI18n('fountConsole.server.standingBy')

let args = process.argv.slice(2)

/**
 * 应用程序的主配置对象。
 * @type {object}
 */
const fount_config = {
	/**
	 * 重新启动应用程序的函数。
	 * @returns {never} 不会返回，因为进程会退出。
	 */
	restartor: () => process.exit(131),
	data_path: __dirname + '/data',
	needs_output: process.stdout.writable && process.stdout.isTTY,
	starts: {
		Base: {
			Jobs: !existsSync(__dirname + '/.nojobs'),
			Timers: !existsSync(__dirname + '/.notimers'),
			Idle: !existsSync(__dirname + '/.noidle'),
			AutoUpdate: !existsSync(__dirname + '/.noupdate'),
		}
	}
}

let command_obj

// 解析命令行参数。
if (args.length) {
	const command = args[0]
	args = args.slice(1)

	if (command == 'run') {
		const username = args[0]
		const parttype = args[1]
		const partname = args[2]
		args = args.slice(3)

		command_obj = {
			type: 'runpart',
			data: { username, parttype, partname, args },
		}
	}
	else if (command == 'shutdown' || command == 'reboot') {
		command_obj = {
			type: command,
		}
		fount_config.starts = {
			Base: false,
			Web: false,
			Tray: false,
			DiscordIPC: false,
		}
	}
	else {
		console.errorI18n('fountConsole.ipc.invalidCommand')
		process.exit(1)
	}
}
// 初始化应用程序。
const okey = await init(fount_config)

// 如果提供了命令，则通过 IPC 发送。
if (command_obj) try {
	if (!fount_config.starts.IPC) throw new Error('cannot send command when IPC not enabled')
	const { IPCManager } = await import('./ipc_server/index.mjs')
	const result = await IPCManager.sendCommand(command_obj.type, command_obj.data)
	switch (command_obj.type) {
		case 'runpart': {
			const { outputs } = result
			console.log(outputs)
		}
	}
} catch (err) {
	if (['shutdown', 'reboot'].includes(command_obj.type) && String(err.message).endsWith('read ECONNRESET')) process.exit(0)
	console.errorI18n('fountConsole.ipc.sendCommandFailed', { error: err })
	throw err
}
// 如果初始化失败则退出。
if (!okey) process.exit(0)
