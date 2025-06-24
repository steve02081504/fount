import notifier from 'npm:node-notifier'
import path from 'node:path'
import process from 'node:process'
import { __dirname } from '../server/server.mjs'
import { in_docker, in_termux } from './env.mjs'
import { exec } from 'node:child_process'

export async function notify(title, message, options = {}) {
	if (process.platform === 'win32') { // https://github.com/denoland/deno/issues/25867
		exec(`\
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show("${message}", "${title}", 0, [System.Windows.Forms.MessageBoxIcon]::Information)
`, { 'shell': 'powershell.exe' })
		return
	}
	if (in_docker || in_termux) return
	return new Promise((resolve, reject) => notifier.notify({
		title,
		message,
		icon: path.join(__dirname, process.platform === 'win32' ? '/src/pages/favicon.ico' : '/src/pages/favicon.ico'),
		...options
	}, function (err, response, metadata) {
		if (err) reject(err)
		else resolve(response)
	}))
}
