import express from 'npm:express@^5.0.1'
import cookieParser from 'npm:cookie-parser@^1.4.0'
import fileUpload from 'npm:express-fileupload@^1.5.0'
import fs from 'node:fs'
import process from 'node:process'
import https from 'node:https'
import { __dirname } from './base.mjs'
import { console } from '../scripts/console.mjs'
import { registerEndpoints } from './endpoints.mjs'
import { on_shutdown } from './on_shutdown.mjs'
import { IPCManager } from './ipc_server.mjs'
import { initAuth } from './auth.mjs'
import { createTray } from '../scripts/tray.mjs'
import { StartRPC } from '../scripts/discordrpc.mjs'
import { geti18n } from '../scripts/i18n.mjs'

export { __dirname }
const app = express()
const mainRouter = express.Router()
export const PartsRouter = express.Router()
const FinalRouter = express.Router()

app.use(mainRouter)
app.use(PartsRouter)
app.use(FinalRouter)

mainRouter.use(async (req, res, next) => {
	if (!req.path.endsWith('/heartbeat'))
		console.log(await geti18n('fountConsole.web.requestReceived', {
			method: req.method,
			url: req.url
		}))
	next()
})
mainRouter.use(express.json({ limit: Infinity }))
mainRouter.use(express.urlencoded({ limit: Infinity, extended: true }))
mainRouter.use(fileUpload())
mainRouter.use(cookieParser())
FinalRouter.use((req, res) => {
	if (req.accepts('html')) return res.status(404).sendFile(__dirname + '/src/public/404.html')
	res.status(404).type('txt').send('Not found')
})
const errorHandler = (err, req, res, next) => {
	console.error(err)
	res.status(500).json({ message: 'Internal Server Error', errors: err.errors, error: err.message })
}
FinalRouter.use(errorHandler)

function get_config() {
	if (!fs.existsSync(__dirname + '/data/config.json')) {
		try { fs.mkdirSync(__dirname + '/data') } catch { }
		fs.copyFileSync(__dirname + '/default/config.json', __dirname + '/data/config.json')
	}

	return JSON.parse(fs.readFileSync(__dirname + '/data/config.json', 'utf8'))
}
export function save_config() {
	fs.writeFileSync(__dirname + '/data/config.json', JSON.stringify(config, null, '\t'))
}

//读取confing文件
export const config = get_config()

// 初始化身份验证模块
initAuth(config)

/**
 * Set the title of the terminal window
 * @param {string} title Desired title for the window
 */
function setWindowTitle(title) {
	process.stdout.write(`\x1b]2;${title}\x1b\x5c`)
}

export function setDefaultStuff() {
	setWindowTitle('fount')
	PartsRouter.use(errorHandler)
}

export let hosturl = 'http://localhost:' + config.port

export async function init() {
	console.freshLine('server start', await geti18n('fountConsole.server.start'))
	globalThis.addEventListener('error', (e) => {
		console.log(e.error)
		e.preventDefault()
	})
	globalThis.addEventListener('unhandledRejection', (e) => {
		console.log(e.reason)
		e.preventDefault()
	})
	if (!await new IPCManager().startServer()) return false

	console.freshLine('server start', await geti18n('fountConsole.server.starting'))
	registerEndpoints(mainRouter)
	mainRouter.use(express.static(__dirname + '/src/public'))
	const { port, https: httpsConfig } = config // 获取 HTTPS 配置

	let server
	if (httpsConfig && httpsConfig.enabled) {
		// 启用 HTTPS
		const options = {
			key: fs.readFileSync(httpsConfig.keyFile),
			cert: fs.readFileSync(httpsConfig.certFile),
		}
		server = https.createServer(options, app)
		server.listen(port, async () => {
			hosturl = 'https://localhost:' + port
			console.log(await geti18n('fountConsole.server.showUrl.https', {
				url: 'https://localhost:' + port
			}))
		})
	}
	else
		// 使用 HTTP
		server = app.listen(port, async () => {
			console.log(await geti18n('fountConsole.server.showUrl.http', {
				url: 'http://localhost:' + port
			}))
		})

	console.freshLine('server start', await geti18n('fountConsole.server.ready'))
	const titleBackup = process.title
	on_shutdown(() => setWindowTitle(titleBackup))
	createTray()
	setDefaultStuff()
	console.freshLine('server start', Array(Math.floor(Math.random() * 7)).fill('fo-').join('') + 'fount!')
	StartRPC()
	return true
}
