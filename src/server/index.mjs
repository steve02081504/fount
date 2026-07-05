/**
 * 这是应用程序服务器的主入口点。它初始化 Sentry 进行错误报告，
 * 解析命令行参数，配置服务器，并启动初始化过程。
 * 它还通过 IPC 处理向正在运行的服务器实例发送命令。
 */
import fs from 'node:fs'
import os from 'node:os'
import process from 'node:process'

import { console } from '../scripts/i18n.mjs'
import { SetTaskbarProgress } from '../scripts/taskbar_progress.mjs'
import { setWindowTitle } from '../scripts/title.mjs'

/**
 * 生产 CLI 入口禁止继承测试 env，避免 P2P 信令静默切到测试 relay。
 * @returns {void}
 */
function rejectTestEnvInProductionEntry() {
	if (process.env.FOUNT_TEST === '1') {
		console.error('FOUNT_TEST must not be set when starting production server (src/server/index.mjs)')
		process.exit(1)
	}
}
rejectTestEnvInProductionEntry()

import { enableAutoUpdate, disableAutoUpdate } from './autoupdate.mjs'
import { __dirname, set_start } from './base.mjs'
import { startIdleCheck, stopIdleCheck } from './idle.mjs'
import { PauseAllJobs, ReStartJobs } from './jobs.mjs'
import { set_sentry_enabled } from './sentry_state.mjs'
import { init } from './server.mjs'
import { startTimerHeartbeat, stopTimerHeartbeat } from './timers.mjs'

// 设置 `@steve02081504/virtual-console` 虚拟控制台选项用于日志查看器 WebSocket 服务
console.options.maxLogEntries = 4096
console.options.recordOutput = true

console.profile('server start')
setWindowTitle('𝓯𝓸')
SetTaskbarProgress(50)

// 初始化 Sentry 进行错误报告。
set_sentry_enabled(!fs.existsSync(__dirname + '/.noerrorreport'))
console.noBreadcrumb = {
	/**
	 * 写入日志并跳过面包屑和调试器记录
	 * @param {...any} args - 要记录的日志
	 */
	log: (...args) => {
		console.writeAs('log', ...args)
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
			P2P: false,
		}
	}
	else {
		console.errorI18n('fountConsole.ipc.invalidCommand')
		process.exit(1)
	}
}
// 初始化应用程序。
const result = await init(fount_config)

if (process.env.FOUNT_STARTUP_PRIORITY_BOOST) {
	try { os.setPriority(0, 0) } catch { /* ignore */ }
	delete process.env.FOUNT_STARTUP_PRIORITY_BOOST
}

// 如果提供了命令，则通过 IPC 发送到已运行的实例。
if (command_obj) await (async () => {
	try {
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
	}
})()

console.profileEnd('server start')

if (!result) process.exit(1)
else if (result === 'already_running' || command_obj?.exit) process.exit(0)
