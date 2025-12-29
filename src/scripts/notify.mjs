import process from 'node:process'

import { where_command } from 'npm:@steve02081504/exec'
import notifier from 'npm:node-notifier'

import { __dirname } from '../server/base.mjs'

import { in_docker, in_termux } from './env.mjs'

/**
 * 发送桌面通知。
 * @param {string} title - 通知的标题。
 * @param {string} message - 通知的内容。
 * @param {object} [options={}] - 通知的其他选项。
 * @returns {Promise<any>} 一个解析为通知程序响应的承诺。
 */
export async function notify(title, message, options = {}) {
	if (in_docker || in_termux) return console.log(`[Notify] ${title}\n${message}`)
	// if linux, check notify-send for notifier workability
	if (process.platform === 'linux') try {
		const path = await where_command('notify-send')
		if (!path) return console.log(`[Notify] ${title}\n${message}`)
	} catch (e) {
		return console.log(`[Notify] ${title}\n${message}`)
	}
	return new Promise((resolve, reject) => notifier.notify({
		title,
		message,
		icon: __dirname + '/src/public/pages/favicon.ico',
		...options
	}, function (err, response, metadata) {
		if (err) reject(err)
		else resolve(response)
	}))
}
