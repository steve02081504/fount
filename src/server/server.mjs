import * as Sentry from 'npm:@sentry/deno'
import express from 'npm:express@^5.1.0'
import cookieParser from 'npm:cookie-parser@^1.4.0'
import fileUpload from 'npm:express-fileupload@^1.5.0'
import fs from 'node:fs'
import process from 'node:process'
import https from 'node:https'
import http from 'node:http'
import { __dirname, startTime } from './base.mjs'
import { console } from 'npm:@steve02081504/virtual-console'
import { on_shutdown } from 'npm:on-shutdown'
import { auth_request, getUserByReq, initAuth } from './auth.mjs'
import { createTray } from '../scripts/tray.mjs'
import { StartRPC } from '../scripts/discordrpc.mjs'
import { geti18n } from '../scripts/i18n.mjs'
import { sentrytunnel } from '../scripts/sentrytunnel.mjs'
import { partsList } from './managers/index.mjs'
import { Router as WsAbleRouter } from 'npm:websocket-express@^3.1.3'
import { ReStartJobs } from './jobs.mjs'
import { startTimerHeartbeat } from './timers.mjs'
import supportsAnsi from 'npm:supports-ansi'
import { loadJsonFile, saveJsonFile } from '../scripts/json_loader.mjs'

export { __dirname }
const app = express()
app.set('trust proxy', 'loopback')
const mainRouter = express.Router()
export const PartsRouter = express.Router()
const FinalRouter = express.Router()

app.use(mainRouter)
app.use(PartsRouter)
app.use(FinalRouter)

mainRouter.use(async (req, res, next) => {
	if (!(req.path.endsWith('/heartbeat') || req.path.endsWith('/api/sentrytunnel')))
		console.log(await geti18n('fountConsole.web.requestReceived', {
			method: req.method + ' '.repeat(Math.max(0, 8 - req.method.length)),
			url: req.url
		}))
	return next()
})
function diff_if_auth(if_auth, if_not_auth) {
	return async (req, res, next) => {
		if(await auth_request(req)) return if_auth(req, res, next)
		return if_not_auth(req, res, next)
	}
}
mainRouter.post('/api/sentrytunnel', diff_if_auth(
	express.raw({ type: '*/*', limit: Infinity }),
	express.raw({ type: '*/*', limit: 5 * 1024 * 1024 })
), sentrytunnel)
mainRouter.use(diff_if_auth(
	express.json({ limit: Infinity }),
	express.json({ limit: 5 * 1024 * 1024 })
))
mainRouter.use(diff_if_auth(
	express.urlencoded({ limit: Infinity, extended: true }),
	express.urlencoded({ limit: 5 * 1024 * 1024, extended: true })
))
mainRouter.use(fileUpload())
mainRouter.use(cookieParser())
mainRouter.use((req, res, next) => {
	if (req.accepts('html')) res.set('Document-Policy', 'js-profiling')
	return next()
})

const PartsRouters = {}
const partsAPIregex = new RegExp(`^/(api|ws)/(${partsList.join('|')})/`)
PartsRouter.use(async (req, res, next) => {
	if (!partsAPIregex.test(req.path)) return next()
	const { username } = await getUserByReq(req).catch(_ => ({}))
	if (!username) return next()
	const parttype = req.path.split('/')[2]
	const partname = req.path.split('/')[3]
	if (PartsRouters[username][parttype][partname])
		return PartsRouters[username][parttype][partname](req, res, next)
	return next()
})
export function getPartRouter(username, parttype, partname) {
	PartsRouters[username] ??= {}
	PartsRouters[username][parttype] ??= {}
	return PartsRouters[username][parttype][partname] ??= new WsAbleRouter()
}

export function deletePartRouter(username, parttype, partname) {
	delete PartsRouters[username][parttype][partname]
	if (!Object.keys(PartsRouters[username][parttype]).length) delete PartsRouters[username][parttype]
	if (!Object.keys(PartsRouters[username]).length) delete PartsRouters[username]
}
FinalRouter.use((req, res) => {
	if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) return res.status(404).json({ message: 'API Not found' })
	if (req.accepts('html')) return res.status(404).sendFile(__dirname + '/src/pages/404/index.html')
	res.status(404).type('txt').send('Not found')
})
export function skip_report(err) {
	err.skip_report = true
	return err
}
const errorHandler = (err, req, res, next) => {
	if (!err.skip_report) Sentry.captureException(err)
	console.error(err)
	res.status(500).json({ message: 'Internal Server Error', errors: err.errors, error: err.message })
}
PartsRouter.use(errorHandler)
FinalRouter.use(errorHandler)
app.use(errorHandler)

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

export let hosturl
export let tray

export async function init(start_config) {
	data_path = start_config.data_path
	const { starts } = start_config
	console.freshLine('server start', await geti18n('fountConsole.server.start'))
	process.on('error', (e) => {
		console.log(e.error)
	})
	process.on('unhandledRejection', (e) => {
		console.log(e.error)
	})

	config = get_config()
	hosturl = 'http://localhost:' + config.port
	initAuth()

	if (starts?.IPC ?? true) {
		const { IPCManager } = await import('./ipc_server.mjs')
		if (!await new IPCManager().startServer()) return false
	}

	if (starts?.Web ?? true) {
		console.freshLine('server start', await geti18n('fountConsole.server.starting'))
		const { registerEndpoints } = await import('./endpoints.mjs')
		registerEndpoints(mainRouter)
		mainRouter.use(express.static(__dirname + '/src/pages'))
		mainRouter.use((req, res, next) => {
			if (req.method != 'GET') return next()
			if (req.path == '/apple-touch-icon.png' || req.path == '/apple-touch-icon-precomposed.png')
				return res.sendFile(__dirname + '/src/pages/favicon.png')
			return next()
		})
		const { port, https: httpsConfig } = config // 获取 HTTPS 配置

		await new Promise((resolve, reject) => {
			let server
			if (httpsConfig && httpsConfig.enabled) {
				// 启用 HTTPS
				const options = {
					key: fs.readFileSync(httpsConfig.keyFile),
					cert: fs.readFileSync(httpsConfig.certFile),
				}
				server = https.createServer(options, app).listen(port, async () => {
					hosturl = 'https://localhost:' + port
					console.log(await geti18n('fountConsole.server.showUrl.https', {
						url: 'https://localhost:' + port
					}))
					resolve()
				})
			}
			else
				server = http.createServer(app).listen(port, async () => {
					console.log(await geti18n('fountConsole.server.showUrl.http', {
						url: 'http://localhost:' + port
					}))
					resolve()
				})
			server.on('error', reject)
		})
	}

	console.freshLine('server start', await geti18n('fountConsole.server.ready'))
	const endtime = new Date()
	const titleBackup = process.title
	on_shutdown(() => setWindowTitle(titleBackup))
	if (starts?.Tray ?? true) createTray().then(t => tray = t)
	setDefaultStuff()
	console.freshLine('server start', Array(Math.floor(Math.random() * 7)).fill('fo-').join('') + 'fount!')
	console.log(await geti18n('fountConsole.server.usesdTime', {
		time: (endtime - startTime) / 1000
	}))
	ReStartJobs()
	startTimerHeartbeat()
	if (starts?.DiscordRPC ?? true) StartRPC()
	return true
}
