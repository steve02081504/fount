import notifier from 'npm:node-notifier'
import path from 'node:path'
import process from 'node:process'
import { __dirname } from '../server/server.mjs'
import { in_docker, in_termux } from './env.mjs'

export async function notify(title, message, options = {}) {
	if (process.platform === 'win32') return // https://github.com/mikaelbr/node-notifier/issues/454
	if (in_docker || in_termux) return
	return new Promise((resolve, reject) => notifier.notify({
		title: title,
		message: message,
		icon: path.join(__dirname, process.platform === 'win32' ? '/src/public/favicon.ico' : '/src/public/favicon.ico'),
		...options
	}, function (err, response, metadata) {
		if (err) reject(err)
		else resolve(response)
	}))
}
