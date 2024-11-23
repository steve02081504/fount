import express from 'npm:express'
import bodyParser from 'npm:body-parser'
import cookieParser from 'npm:cookie-parser'
import path from 'node:path'
import fs from 'node:fs'
import process from 'node:process'
import { console } from './console.mjs'
import { registerEndpoints } from './endpoints.mjs'
import { on_shutdown } from './on_shutdown.mjs'
import { IPCManager } from './ipc_manager.mjs'

export const app = express()

export const __dirname = path.resolve(import.meta.dirname + '/../../')

app.use((req, res, next) => { console.log(`Request received: ${req.method} ${req.url}`); next() })
app.use(bodyParser.json())
app.use(cookieParser())

function get_config() {
	if (!fs.existsSync(__dirname + '/data/config.json')) {
		fs.mkdirSync(__dirname + '/data')
		fs.copyFileSync(__dirname + '/default/config.json', __dirname + '/data/config.json')
	}

	return JSON.parse(fs.readFileSync(__dirname + '/data/config.json', 'utf8'))
}
export function save_config() {
	fs.writeFileSync(__dirname + '/data/config.json', JSON.stringify(config, null, '\t'))
}

//读取confing文件
export const config = get_config()
if (!config.secretKey) {
	config.secretKey = Math.random().toString(36).slice(2)
	save_config()
}

/**
 * Set the title of the terminal window
 * @param {string} title Desired title for the window
 */
function setWindowTitle(title) {
	process.stdout.write(`\x1b]2;${title}\x1b\x5c`)
}

export function setDefaultWindowTitle() {
	setWindowTitle(`fount`)
}

export async function init() {
	console.freshLine('server start', 'start up')
	globalThis.addEventListener("error", (e)=>{
		console.log(e.error)
		e.preventDefault()
	})
	if (!await new IPCManager().startServer()) return false

	console.freshLine('server start', 'server starting')
	registerEndpoints(app)
	app.use(express.static(__dirname + '/src/public'))
	const { port } = config
	app.listen(port, () => {
		console.log(`服务器运行在 http://localhost:${port}`)
	})
	console.freshLine('server start', 'server ready')
	let titleBackup = process.title
	on_shutdown(() => setWindowTitle(titleBackup))
	setDefaultWindowTitle()
	console.freshLine('server start', Array(Math.floor(Math.random() * 7)).fill('fo-').join('')+'fount!')
	return true
}
