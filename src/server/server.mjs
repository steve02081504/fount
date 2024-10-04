import express from 'express'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs'
import { registerEndpoints } from './endpoints.mjs'

export const app = express()

export const __dirname = path.resolve()

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

export async function init() {
	registerEndpoints(app)
	app.use(express.static(__dirname + '/src/public'))
	const { port } = config
	app.listen(port, () => {
		console.log(`服务器运行在 http://localhost:${port}`)
	})

}

