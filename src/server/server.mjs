import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import process from 'node:process'

import { on_shutdown } from 'npm:on-shutdown'
import supportsAnsi from 'npm:supports-ansi'

import { StartRPC } from '../scripts/discordrpc.mjs'
import { getMemoryUsage } from '../scripts/gc.mjs'
import { git } from '../scripts/git.mjs'
import { console } from '../scripts/i18n.mjs'
import { loadJsonFile, saveJsonFile } from '../scripts/json_loader.mjs'
import { get_hosturl_in_local_ip } from '../scripts/ratelimit.mjs'
import { createTray } from '../scripts/tray.mjs'
import { runSimpleWorker } from '../workers/index.mjs'

import { initAuth } from './auth.mjs'
import { __dirname, startTime } from './base.mjs'
import idleManager from './idle.mjs'
import { ReStartJobs } from './jobs.mjs'
import { startTimerHeartbeat } from './timers.mjs'
import { sendEventToAll } from './web_server/event_dispatcher.mjs'

export let data_path

function get_config() {
	if (!fs.existsSync(data_path + '/config.json')) {
		try { fs.mkdirSync(data_path) } catch { }
		fs.copyFileSync(__dirname + '/default/config.json', data_path + '/config.json')
	}

	return loadJsonFile(data_path + '/config.json')
}
export function save_config() {
	saveJsonFile(data_path + '/config.json', config)
}

//读取confing文件
export let config

/**
 * Set the title of the terminal window
 * @param {string} title Desired title for the window
 */
function setWindowTitle(title) {
	if (supportsAnsi && process.stdout.writable) process.stdout.write(`\x1b]2;${title}\x1b\x5c`)
}

export function setDefaultStuff() {
	setWindowTitle('fount')
}
export function skip_report(err) {
	err.skip_report = true
	return err
}

export let hosturl
export let tray
export let restartor

export let currentGitCommit = await git('rev-parse', 'HEAD').catch(() => null)

async function checkUpstreamAndRestart() {
	if (fs.existsSync(__dirname + '/.git')) try {
		await git('fetch')

		if (!await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').catch(() => null)) return

		const remoteCommit = await git('rev-parse', '@{u}')

		if (currentGitCommit == remoteCommit) return
		const mergeBase = await git('merge-base', 'HEAD', '@{u}')
		if (mergeBase !== currentGitCommit) return // Not a fast-forward merge

		const changedFiles = await git('diff', '--name-only', 'HEAD', '@{u}').then(out => out.replace(/\\/g, '/').split('\n').filter(Boolean))
		const needsRestart = changedFiles.some(file =>
			file.endsWith('.mjs') && file.startsWith('src/') &&
			!file.startsWith('src/pages/') &&
			!/^src\/public\/[^/]+\/[^/]+\/public\//.test(file)
		)

		if (needsRestart) {
			console.logI18n('fountConsole.server.update.restarting')
			if (restartor) await restartor()
		}
		else {
			await git('reset', '--hard', '@{u}')
			currentGitCommit = await git('rev-parse', 'HEAD')
			sendEventToAll('server-updated', { commitId: currentGitCommit })
		}
	} catch (e) {
		console.errorI18n('fountConsole.partManager.git.updateFailed', { error: e })
	}
}

export async function init(start_config) {
	restartor = start_config.restartor
	data_path = start_config.data_path
	const starts = start_config.starts ??= {}
	for (const start of ['Base', 'IPC', 'Web', 'Tray', 'DiscordIPC']) starts[start] ??= true
	let logoPromise
	if (starts.Base) {
		if (start_config.needs_output) logoPromise = runSimpleWorker('logogener')
		starts.Base = Object(starts.Base)
		for (const base of ['Jobs', 'Timers', 'Idle', 'AutoUpdate']) starts.Base[base] ??= true
		console.freshLineI18n('server start', 'fountConsole.server.start')
		process.on('error', console.log)
		process.on('unhandledRejection', console.log)
	}

	config = get_config()
	if (starts.Base) initAuth()

	if (starts.IPC) {
		const { IPCManager } = await import('./ipc_server/index.mjs')
		if (!await new IPCManager().startServer()) return false
	}
	let iconPromise
	if (starts.Tray || starts.Web || !fs.existsSync(__dirname + '/src/pages/favicon.ico'))
		iconPromise = runSimpleWorker('icongener').catch(console.error)

	if (starts.Web) {
		const { port, https: httpsConfig, trust_proxy } = config // 获取 HTTPS 配置
		hosturl = (httpsConfig?.enabled ? 'https' : 'http') + '://localhost:' + port
		let server

		console.freshLineI18n('server start', 'fountConsole.server.starting')
		await new Promise((resolve, reject) => {
			let appPromise
			const getApp = () => appPromise ??= import('./web_server/index.mjs').then(({ app }) => {
				app.set('trust proxy', trust_proxy ?? 'loopback')
				server.removeListener('request', requestListener)
				server.on('request', app)
				server.removeListener('upgrade', upgradeListener)
				server.on('upgrade', app.ws_on_upgrade)
				return app
			})
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

			const ansi_hosturl = supportsAnsi ? `\x1b]8;;${hosturl}\x1b\\${hosturl}\x1b]8;;\x1b\\` : hosturl

			const listen = [port, config.listen].filter(Boolean)
			if (httpsConfig?.enabled)
				server = https.createServer({
					key: fs.readFileSync(path.resolve(httpsConfig.keyFile, __dirname)),
					cert: fs.readFileSync(path.resolve(httpsConfig.certFile, __dirname)),
				}, requestListener).listen(...listen, async () => {
					console.logI18n('fountConsole.server.showUrl.https', { url: ansi_hosturl })
					resolve()
				})
			else
				server = http.createServer(requestListener).listen(...listen, async () => {
					console.logI18n('fountConsole.server.showUrl.http', { url: ansi_hosturl })
					resolve()
				})

			server.on('upgrade', upgradeListener)
			server.on('error', reject)
		})

		if (start_config.needs_output) try {
			const local_url = get_hosturl_in_local_ip()
			console.logI18n('fountConsole.server.localUrl', { url: local_url })
			const qrcode = await import('npm:qrcode-terminal')
			qrcode.generate(local_url, { small: true })
		} catch (e) { /* ignore */ }
	}

	if (starts.Tray) iconPromise.then(() => createTray()).then(t => tray = t)
	if (starts.Base) {
		console.freshLineI18n('server start', 'fountConsole.server.ready')
		const titleBackup = process.title
		on_shutdown(() => setWindowTitle(titleBackup))
		setDefaultStuff()
		if (start_config.needs_output) console.freshLine('server start', await logoPromise)
	}
	const endtime = new Date()
	console.log({
		startTime,
		totalTimeInMs: endtime - startTime,
		totalMemoryChangeInMB: getMemoryUsage() / 1024 / 1024
	})
	if (starts.Base) {
		if (starts.Base.Jobs) ReStartJobs()
		if (starts.Base.Timers) startTimerHeartbeat()
		if (starts.Base.Idle) idleManager.start()
		if (starts.Base.AutoUpdate) idleManager.onIdle(checkUpstreamAndRestart)
	}
	if (starts.DiscordRPC) StartRPC()
	if (!fs.existsSync(__dirname + '/src/pages/favicon.ico')) await iconPromise

	return true
}
