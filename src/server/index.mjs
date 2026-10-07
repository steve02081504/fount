/**
 * 这是应用程序服务器的主入口点。它初始化 Sentry 进行错误报告，
 * 解析命令行参数，配置服务器，并启动初始化过程。
 * 它还通过 IPC 处理向正在运行的服务器实例发送命令。
 */
import fs from 'node:fs'
import os from 'node:os'
import process from 'node:process'

import { on_shutdown } from 'npm:on-shutdown'

import * as icon from '../../imgs/icon_anime/session.mjs'
import { console } from '../scripts/i18n/index.mjs'
import { set_sentry_enabled } from '../scripts/sentry_state.mjs'
import { SetTaskbarProgress } from '../scripts/taskbar_progress.mjs'
import { setWindowTitle } from '../scripts/title.mjs'

/**
 * 生产 CLI 入口禁止继承测试 env，避免 P2P 信令静默切到测试 relay。
 * @returns {void}
 */
function rejectTestEnvInProductionEntry() {
	if (process.env.FOUNT_TEST) {
		console.error('FOUNT_TEST must not be set when starting production server')
		process.exit(1)
	}
}
rejectTestEnvInProductionEntry()

import { enableAutoUpdate, disableAutoUpdate } from './autoupdate.mjs'
import { __dirname, set_start } from './base.mjs'
import { startIdleCheck, stopIdleCheck } from './idle.mjs'
import { PauseAllJobs, ReStartJobs } from './jobs.mjs'
import { init } from './server.mjs'
import { startTimerHeartbeat, stopTimerHeartbeat } from './timers.mjs'

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

const args = process.argv.slice(2)

let command_obj

// 解析命令行参数。
if (args.length) {
	const command = args.shift()

	if (command == 'run' || command == 'runas') {
		// `run` 以最后活跃用户执行（用户名留 null，待 init 载入 config 后再解析）；`runas` 显式指定。
		let username = null
		if (command == 'runas') username = args.shift()
		let partPath = args.shift()
		if (!partPath) {
			console.errorI18n('fountConsole.ipc.partPathRequired')
			process.exit(1)
		}
		// fount run code -> shells/code
		if (!partPath.includes('/')) partPath = `shells/${partPath}`
		// fount run /shells -> shells
		if (partPath.startsWith('/')) partPath = partPath.slice(1)

		command_obj = {
			type: 'runpart',
			data: { username, partpath: partPath, args, cwd: process.cwd() },
		}
	}
	else if (command == 'shutdown' || command == 'reboot')
		command_obj = {
			type: command,
			exit: true,
		}

	else {
		console.errorI18n('fountConsole.ipc.invalidCommand')
		process.exit(1)
	}
}

/**
 * 通过 IPC 把命令行请求交给已运行的实例，并分派 runpart 的返回结果。
 * @returns {Promise<number>} 进程退出码。
 */
async function forwardCommand() {
	const { IPCManager } = await import('./ipc_server/index.mjs')
	const response = await IPCManager.sendCommand(command_obj.type, command_obj.data)
	// shutdown / reboot 只要求送达：服务端自行退出。
	if (command_obj.type !== 'runpart') return 0
	const { dispatchArgumentsResult } = await import('../scripts/part_invoke_result.mjs')
	// runpart 的结果按 output / run-js 分派；void 型 handler 保留既有的虚拟控制台展示。
	return dispatchArgumentsResult(response, {
		/**
		 * 打印 handler 在虚拟控制台里的输出。
		 * @param {unknown} outputs - 捕获到的输出。
		 * @returns {void} 无返回值。
		 */
		logOutputs: outputs => console.log(outputs),
	})
}

if (command_obj)
	try {
		process.exitCode = await forwardCommand()
	} catch (error) {
		if (command_obj.exit && String(error.message).endsWith('read ECONNRESET')) process.exitCode = 0
		else if (['ECONNREFUSED', 'ETIMEDOUT', 'AggregateError'].includes(error.code)) {
			console.errorI18n('fountConsole.ipc.noInstanceRunning')
			process.exitCode = 1
		}
		else {
			console.errorI18n('fountConsole.ipc.sendCommandFailed', { error })
			process.exitCode = 1
		}
	}
else {
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

	const showIcon = Boolean(fount_config.needs_output && fount_config.starts.Base)
	let icon_intro
	if (showIcon) {
		on_shutdown(async () => { await icon.farewell() })
		icon.signal.addEventListener('abort', () => process.exit(0), { once: true })
		icon_intro = icon.intro()
	}

	// 初始化应用程序。
	const result = await init(fount_config)

	if (showIcon && result === 'started') {
		await icon_intro
		await icon.dismiss()
		if (icon.signal.aborted) process.exit(0)
	}

	if (process.env.FOUNT_STARTUP_PRIORITY_BOOST) {
		try { os.setPriority(0, 0) } catch { /* ignore */ }
		delete process.env.FOUNT_STARTUP_PRIORITY_BOOST
	}

	console.profileEnd('server start')

	if (!result) process.exit(1)
	else if (result === 'already_running') process.exit(0)
}
