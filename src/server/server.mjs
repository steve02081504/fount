import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import process from 'node:process'

import { on_shutdown, unset_shutdown_listener } from 'npm:on-shutdown'
import supportsAnsi from 'npm:supports-ansi'

import { getMemoryUsage } from '../scripts/gc.mjs'
import { console, geti18n } from '../scripts/i18n.mjs'
import { loadJsonFile, saveJsonFile } from '../scripts/json_loader.mjs'
import { notify } from '../scripts/notify.mjs'
import { get_hosturl_in_local_ip } from '../scripts/ratelimit.mjs'
import { runSimpleWorker } from '../workers/index.mjs'

import { initAuth } from './auth.mjs'
import { __dirname, startTime } from './base.mjs'
import { info } from './info.mjs'
import { shallowLoadAllDefaultParts } from './parts_loader.mjs'

/**
 * 应用程序数据目录的路径。
 * @type {string}
 */
export let data_path

/**
 * 确保配置文件存在，如果不存在则从默认配置创建，然后加载它。
 * @returns {object} 加载的配置对象。
 */
function get_config() {
	if (!fs.existsSync(data_path + '/config.json')) {
		try { fs.mkdirSync(data_path) } catch { }
		fs.copyFileSync(__dirname + '/default/config.json', data_path + '/config.json')
	}

	return loadJsonFile(data_path + '/config.json')
}
/**
 * 将当前配置对象保存到其文件。
 * @returns {void}
 */
export function save_config() {
	saveJsonFile(data_path + '/config.json', config)
}

/**
 * 应用程序的配置，从 `config.json` 加载。
 * @type {object}
 */
export let config

/**
 * 设置终端窗口的标题。
 * @param {string} title - 窗口的期望标题。
 */
function setWindowTitle(title) {
	if (supportsAnsi && process.stdout.writable) process.stdout.write(`\x1b]2;${title}\x1b\x5c`)
}

/**
 * 设置应用程序的默认窗口标题。
 * @returns {void}
 */
export function setDefaultStuff() {
	setWindowTitle(info.title)
}
/**
 * 标记一个错误对象以便跳过报告。
 * @param {Error} err - 错误对象。
 * @returns {Error} 修改后的错误对象。
 */
export function skip_report(err) {
	err.skip_report = true
	return err
}

/**
 * @property {string} hosturl - 正在运行的服务器的基本URL。
 * @property {object} tray - 系统托盘对象。
 * @property {Function} restartor - 重启应用程序的函数。
 */
export let hosturl
/**
 * 系统托盘对象。
 * @type {object}
 */
export let tray
/**
 * 重启应用程序的函数。
 * @type {Function}
 */
export let restartor

/**
 * 上次 Web 请求的时间戳。
 * @type {number}
 */
export let lastWebRequestTime = 0
/**
 * 标记上次 Web 请求的时间戳。
 * @returns {void}
 */
export function webRequestHappened() {
	lastWebRequestTime = Date.now()
}

/**
 * 处理错误。
 * @param {Error} err - 错误对象。
 * @returns {void}
 */
function handleError(err) {
	notify('Error', err.message)
	console.error(err)
}

/**
 * 设置重启应用程序的函数。
 * @param {() => never} base_restartor - 基础重启应用程序的函数。
 * @returns {void}
 */
function set_restartor(base_restartor) {
	/**
	 * 默认的关闭应用程序时的清理函数，负责删除reboot对象并保存至config。
	 * @returns {void}
	 */
	let shutdown_do = () => {
		if (!config.reboot) return
		delete config.reboot
		save_config()
	}
	/**
	 * 重启应用程序时的调用函数。
	 * @returns {never} 不会返回，因为进程会退出。
	 */
	restartor = () => {
		/**
		 * 新设置的应用程序重启时清理函数，负责记录reboot对象并保存至config。
		 * @returns {void}
		 */
		shutdown_do = () => {
			config.reboot ??= {}
			config.reboot.sessionStartTime = Date.now()
			save_config()
		}
		base_restartor?.()
	}
	on_shutdown(() => {
		shutdown_do()
	})
}

/**
 * 初始化并启动应用程序服务器及其组件。
 * @param {object} start_config - 用于启动应用程序的配置对象。
 * @returns {Promise<boolean>} 如果初始化成功，则解析为 true，否则为 false。
 */
export async function init(start_config) {
	set_restartor(start_config.restartor)
	data_path = start_config.data_path
	const starts = start_config.starts ??= {}
	for (const start of ['Base', 'IPC', 'Web', 'Tray', 'DiscordRPC']) starts[start] ??= true
	if (starts.Web) starts.Web = Object.assign({ mDNS: true }, starts.Web)
	let logoPromise
	if (starts.Base) {
		for (const event of ['error', 'unhandledRejection', 'uncaughtException']) {
			unset_shutdown_listener(event)
			process.on(event, handleError)
		}
		if (start_config.needs_output) logoPromise = runSimpleWorker('logogener')
		starts.Base = Object(starts.Base)
		for (const base of ['Jobs', 'Timers', 'Idle', 'AutoUpdate', 'Tips']) starts.Base[base] ??= true
		console.freshLineI18n('server start', 'fountConsole.server.start')
	}

	config = get_config()
	if (starts.Base) initAuth()

	if (starts.IPC) {
		const { IPCManager } = await import('./ipc_server/index.mjs')
		if (!await new IPCManager().startServer()) return false
	}
	let iconPromise
	if (starts.Tray || starts.Web || !fs.existsSync(__dirname + '/src/public/pages/favicon.ico'))
		iconPromise = runSimpleWorker('icongener').catch(console.error)

	if (starts.Web) try {
		const { port, https: httpsConfig, trust_proxy, mdns: mdnsConfig } = config // 获取 HTTPS 配置
		hosturl = (httpsConfig?.enabled ? 'https' : 'http') + '://localhost:' + port
		let server

		console.freshLineI18n('server start', 'fountConsole.server.starting')
		const { initMdns } = starts.Web?.mDNS ? await import('./web_server/mdns.mjs') : {}
		let appPromise
		/**
		 * 懒加载地获取 Express 应用程序实例。
		 * @returns {Promise<import('npm:express').Application>} Express 应用程序实例。
		 */
		const getApp = () => appPromise ??= import('./web_server/index.mjs').then(({ app }) => {
			app.set('trust proxy', trust_proxy ?? 'loopback')
			server.removeListener('request', requestListener)
			server.on('request', app)
			server.removeListener('upgrade', upgradeListener)
			server.on('upgrade', app.ws_on_upgrade)
			return app
		})
		/**
		 * 处理 HTTP 请求。
		 * @param {import('http').IncomingMessage} req - HTTP 请求对象。
		 * @param {import('http').ServerResponse} res - HTTP 响应对象。
		 * @returns {Promise<void>}
		 */
		const requestListener = async (req, res) => {
			try {
				const app = await getApp()
				return app(req, res)
			}
			catch (e) {
				console.error(e)
				res.statusCode = 500
				res.end('Internal Server Error: Could not load web server.')
			}
		}
		/**
		 * 处理 WebSocket 升级请求。
		 * @param {import('http').IncomingMessage} req - HTTP 请求对象。
		 * @param {import('net').Socket} socket - 客户端和服务器之间的网络套接字。
		 * @param {Buffer} head - 已升级流的第一个数据包。
		 * @returns {Promise<void>}
		 */
		const upgradeListener = async (req, socket, head) => {
			try {
				const app = await getApp()
				return app.ws_on_upgrade(req, socket, head)
			}
			catch (e) {
				console.error(e)
				socket.end()
			}
		}

		/**
		 * 监听特定地址
		 * @param {String} listenAddress 要监听的地址
		 * @returns {Promise<Boolean>} 是否本地
		 */
		const listen = async (listenAddress) => await new Promise((resolve, reject) => {
			const ansi_hosturl = supportsAnsi ? `\x1b]8;;${hosturl}\x1b\\${hosturl}\x1b]8;;\x1b\\` : hosturl

			const listen = [port, listenAddress].filter(Boolean)
			if (httpsConfig?.enabled)
				server = https.createServer({
					key: fs.readFileSync(path.resolve(httpsConfig.keyFile, __dirname)),
					cert: fs.readFileSync(path.resolve(httpsConfig.certFile, __dirname)),
				}, requestListener).listen(...listen, async () => {
					console.logI18n('fountConsole.server.showUrl.https', { url: ansi_hosturl })
					if (starts.Web?.mDNS) initMdns(port, 'https', mdnsConfig)
					resolve(listenAddress == 'localhost')
				})
			else
				server = http.createServer(requestListener).listen(...listen, async () => {
					console.logI18n('fountConsole.server.showUrl.http', { url: ansi_hosturl })
					if (starts.Web?.mDNS) initMdns(port, 'http', mdnsConfig)
					resolve(listenAddress == 'localhost')
				})

			server.on('upgrade', upgradeListener)
			server.on('error', (err) => {
				console.error(err)
				server.close(() => {
					server = null
					reject(err)
				})
			})
		})
		let is_localhost
		try {
			is_localhost = await listen(config.listen)
		}
		catch (error) {
			if (error.code === 'EACCES')
				is_localhost = await listen('localhost')
			else throw error
		}

		if (start_config.needs_output && !is_localhost) try {
			const local_url = get_hosturl_in_local_ip()
			console.logI18n('fountConsole.server.localUrl', { url: local_url })
			const qrcode = await import('npm:qrcode-terminal')
			qrcode.generate(local_url, { small: true }, console.noBreadcrumb.log)
		} catch (e) { /* ignore */ }
	} catch (e) { console.error(e) }

	if (starts.Tray) iconPromise.then(async () => {
		const { createTray } = await import('../scripts/tray.mjs')
		tray = createTray()
	})
	if (starts.Base) {
		console.freshLineI18n('server start', 'fountConsole.server.ready')
		const titleBackup = process.title
		on_shutdown(() => setWindowTitle(titleBackup))
		setDefaultStuff()
		if (start_config.needs_output) console.freshLine('server start', await logoPromise)
		if (starts.Base.Tips) {
			console.logI18n('tips.title')
			console.logI18n('tips.data')
		}
	}
	const endtime = new Date()
	console.log({
		startTime,
		sessionStartTime: new Date(config.reboot?.sessionStartTime ?? startTime.getTime()),
		totalTimeInMs: endtime - startTime,
		totalMemoryChangeInMB: getMemoryUsage() / 1024 / 1024
	})
	if (starts.Base) {
		setTimeout(() => {
			const Interval = setInterval(async () => {
				if (new Date() - startTime < 13000 && new Date() - lastWebRequestTime < 1000) return
				clearInterval(Interval)
				if (starts.Base.Jobs) {
					const { ReStartJobs } = await import('./jobs.mjs')
					await ReStartJobs()
				}
				await shallowLoadAllDefaultParts()
			}, 1000)
		}, 2000)
		if (starts.Base.Timers) {
			const { startTimerHeartbeat } = await import('./timers.mjs')
			startTimerHeartbeat()
		}
		const { startIdleCheck, onIdle } = await import('./idle.mjs')
		if (starts.Base.Idle) startIdleCheck()
		if (starts.Base.AutoUpdate) {
			const { enableAutoUpdate } = await import('./autoupdate.mjs')
			enableAutoUpdate()
		}
		onIdle(setDefaultStuff)
		onIdle(() => {
			config.prelaunch ??= {}
			const currentHeap = getMemoryUsage()
			const oldHeap = config.prelaunch.heapSize / 1.5 || currentHeap
			config.prelaunch.heapSize = Math.round((oldHeap * 12 + currentHeap) / 13 * 1.5)
			save_config()
		})
	}
	if (starts.DiscordRPC) {
		const { StartRPC } = await import('../scripts/discordrpc.mjs')
		StartRPC()
	}
	if (!fs.existsSync(__dirname + '/src/public/pages/favicon.ico')) await iconPromise

	return true
}
