import process from 'node:process'

import notifier from 'npm:node-notifier'

import { __dirname } from '../server/base.mjs'
import { setDefaultStuff } from '../server/server.mjs'

import { in_docker, in_termux } from './env.mjs'
import { exec } from './exec.mjs'


/**
 * 发送桌面通知。
 * @param {string} title - 通知的标题。
 * @param {string} message - 通知的内容。
 * @param {object} [options={}] - 通知的其他选项。
 * @returns {Promise<any>} 一个解析为通知程序响应的承诺。
 */
export async function notify(title, message, options = {}) {
	if (process.platform === 'win32') { // https://github.com/denoland/deno/issues/25867
		exec(`\
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show('${message.replace(/(['‘’])/g, '$1$1')}', '${title.replace(/(['‘’])/g, '$1$1')}', 0, [System.Windows.Forms.MessageBoxIcon]::Information)
`, { shell: 'powershell.exe' }).then(() => setDefaultStuff()).catch(console.error)
		return
	}
	if (in_docker || in_termux) console.log(`[Notify] ${title}\n${message}`)
	// if linux, check notify-send for notifier workability
	if (process.platform === 'linux') try {
		const { stdout } = await exec('which notify-send')
		if (!stdout.trim()) console.log(`[Notify] ${title}\n${message}`)
	} catch (e) {
		console.log(`[Notify] ${title}\n${message}`)
	}
	return new Promise((resolve, reject) => notifier.notify({
		title,
		message,
		icon: __dirname + '/src/pages/favicon.ico',
		...options
	}, function (err, response, metadata) {
		if (err) reject(err)
		else resolve(response)
	}))
}
