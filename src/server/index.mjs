/**
 * 这是应用程序服务器的主入口点。它初始化 Sentry 进行错误报告，
 * 解析命令行参数，配置服务器，并启动初始化过程。
 * 它还通过 IPC 处理向正在运行的服务器实例发送命令。
 */
import fs from 'node:fs'
import process from 'node:process'

import * as Sentry from 'npm:@sentry/deno'

import { console } from '../scripts/i18n.mjs'
import { SetTaskbarProgress } from '../scripts/taskbar_progress.mjs'
import { setWindowTitle } from '../scripts/title.mjs'

import { enableAutoUpdate, disableAutoUpdate } from './autoupdate.mjs'
import { __dirname, set_start } from './base.mjs'
import { startIdleCheck, stopIdleCheck } from './idle.mjs'
import { PauseAllJobs, ReStartJobs } from './jobs.mjs'
import { init } from './server.mjs'
import { startTimerHeartbeat, stopTimerHeartbeat } from './timers.mjs'

console.profile('server start')
setWindowTitle('𝓯𝓸')
SetTaskbarProgress(50)

// 初始化 Sentry 进行错误报告。
let skipBreadcrumb = false
/**
 * 是否启用 Sentry 进行错误报告
 * @type {boolean}
 */
export let sentry_enabled
/**
 * 设置 Sentry 是否启用
 * @param {boolean} new_sentry_enabled - 是否启用 Sentry
 * @returns {void}
 */
function set_sentry_enabled(new_sentry_enabled) {
	// deno-lint-ignore no-cond-assign
	if (sentry_enabled = new_sentry_enabled) Sentry.init({
		dsn: 'https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704',
		/**
		 * 在 Sentry 捕获面包屑事件之前进行处理
		 * @param {object} breadcrumb - Sentry捕获到的面包屑事件对象。
		 * @param {object} hint - 包含原始事件等信息的辅助对象。
		 * @returns {object | null} 返回修改后的面包屑对象，或 null 以忽略此面包屑。
		 */
		beforeBreadcrumb: (breadcrumb, hint) => {
			if (skipBreadcrumb) return null
			return breadcrumb
		}
	})
}
set_sentry_enabled(!fs.existsSync(__dirname + '/.noerrorreport'))
console.noBreadcrumb = {
	/**
	 * 写入日志并跳过面包屑和调试器记录
	 * @param {...any} args - 要记录的日志
	 */
	log: (...args) => {
		skipBreadcrumb = true
		console.options.realConsoleOutput = false
		console.options.recordOutput = true
		console.outputs = console.outputsHtml = ''
		console.log(...args)
		process.stdout.write(console.outputs)
		console.options.recordOutput = false
		console.options.realConsoleOutput = true
		skipBreadcrumb = false
	}
}

set_start()

setWindowTitle('𝓯𝓸𝓾')
SetTaskbarProgress(55)

console.logI18n('fountConsole.server.standingBy')

let args = process.argv.slice(2)

/**
 * 应用程序的主配置对象。
 * @type {object}
 */
const fount_config = {
	/**
	 * 重新启动应用程序的函数。
	 * @returns {undefined} 开始重启应用程序。
	 */
	restartor: () => process.exit(131),
	data_path: __dirname + '/data',
	needs_output: process.stdout.writable && process.stdout.isTTY,
	starts: {
		Base: {
			Jobs: !fs.existsSync(__dirname + '/.nojobs'),
			Timers: !fs.existsSync(__dirname + '/.notimers'),
			Idle: !fs.existsSync(__dirname + '/.noidle'),
			AutoUpdate: !fs.existsSync(__dirname + '/.noupdate'),
		}
	}
}

fs.watch(__dirname, (event, filename) => {
	if (filename == '.noerrorreport') set_sentry_enabled(!fs.existsSync(__dirname + '/.noerrorreport'))
	if (filename == '.nojobs')
		if (fs.existsSync(__dirname + '/.nojobs')) PauseAllJobs().catch(console.error)
		else ReStartJobs().catch(console.error)
	if (filename == '.notimers')
		if (fs.existsSync(__dirname + '/.notimers')) stopTimerHeartbeat()
		else startTimerHeartbeat()
	if (filename == '.noidle')
		if (fs.existsSync(__dirname + '/.noidle')) stopIdleCheck()
		else startIdleCheck()
	if (filename == '.noupdate')
		if (fs.existsSync(__dirname + '/.noupdate')) disableAutoUpdate()
		else enableAutoUpdate()
})

let command_obj

// 解析命令行参数。
if (args.length) {
	const command = args[0]
	args = args.slice(1)

	if (command == 'run') {
		const username = args[0]
		const partpath = args[1]
		args = args.slice(2)

		command_obj = {
			type: 'runpart',
			data: { username, partpath, args, cwd: process.cwd() },
		}
	}
	else if (command == 'shutdown' || command == 'reboot') {
		command_obj = {
			type: command,
			exit: true,
		}
		fount_config.starts = {
			Base: false,
			IPC: false,
			Web: false,
			Tray: false,
			DiscordRPC: false,
		}
	}
	else {
		console.errorI18n('fountConsole.ipc.invalidCommand')
		process.exit(1)
	}
}
// 初始化应用程序。
const result = await init(fount_config)

// 如果提供了命令，则通过 IPC 发送到已运行的实例。
if (command_obj) await (async () => { try {
	const { IPCManager } = await import('./ipc_server/index.mjs')
	const result = await IPCManager.sendCommand(command_obj.type, command_obj.data)
	switch (command_obj.type) {
		case 'runpart': {
			const { outputs } = result
			console.log(outputs)
		}
	}
} catch (err) {
	if (command_obj.exit)
		if (String(err.message).endsWith('read ECONNRESET')) return process.exit(0)
		else if (['ECONNREFUSED', 'ETIMEDOUT', 'AggregateError'].includes(err.code)) {
			console.errorI18n('fountConsole.ipc.noInstanceRunning')
			return process.exit(1)
		}
	console.errorI18n('fountConsole.ipc.sendCommandFailed', { error: err })
	throw err
}})()

console.profileEnd('server start')

if (!result) process.exit(1)
else if (result === 'already_running' || command_obj?.exit) process.exit(0)
