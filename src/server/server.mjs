import express from 'npm:express'
import bodyParser from 'npm:body-parser'
import cookieParser from 'npm:cookie-parser'
import fileUpload from 'npm:express-fileupload'
import path from 'node:path'
import fs from 'node:fs'
import process from 'node:process'
import { console } from '../scripts/console.mjs'
import { registerEndpoints } from './endpoints.mjs'
import { on_shutdown } from './on_shutdown.mjs'
import { IPCManager } from './ipc_server.mjs'
import https from 'node:https' // 引入 https 模块
import { initAuth } from './auth.mjs' // 引入新的身份验证模块

export const app = express()

export const __dirname = path.resolve(import.meta.dirname + '/../../')

app.use((req, res, next) => {
	if (!(req.url.includes('/heartbeat/') || req.url.endsWith('/heartbeat')))
		console.log(`Request received: ${req.method} ${req.url}`)
	next()
})
app.use(express.json({ limit: Infinity }))
app.use(express.urlencoded({ limit: Infinity, extended: true }))
app.use(fileUpload())
app.use(bodyParser.json())
app.use(cookieParser())

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

export function setDefaultWindowTitle() {
	setWindowTitle('fount')
}

export let hosturl = 'http://localhost:' + config.port

export async function init() {
	console.freshLine('server start', 'start up')
	globalThis.addEventListener('error', (e) => {
		console.log(e.error)
		e.preventDefault()
	})
	if (!await new IPCManager().startServer()) return false

	console.freshLine('server start', 'server starting')
	registerEndpoints(app)
	app.use(express.static(__dirname + '/src/public'))
	const { port, https: httpsConfig } = config // 获取 HTTPS 配置

	let server
	if (httpsConfig && httpsConfig.enabled) {
		// 启用 HTTPS
		const options = {
			key: fs.readFileSync(httpsConfig.keyFile),
			cert: fs.readFileSync(httpsConfig.certFile),
		}
		server = https.createServer(options, app)
		server.listen(port, () => {
			hosturl = 'https://localhost:' + port
			console.log(`HTTPS 服务器运行在 https://localhost:${port}`)
		})
	}
	else
		// 使用 HTTP
		server = app.listen(port, () => {
			console.log(`HTTP 服务器运行在 http://localhost:${port}`)
		})

	console.freshLine('server start', 'server ready')
	const titleBackup = process.title
	on_shutdown(() => setWindowTitle(titleBackup))
	setDefaultWindowTitle()
	console.freshLine('server start', Array(Math.floor(Math.random() * 7)).fill('fo-').join('') + 'fount!')
	return true
}
