import fs from 'node:fs'
import { setTimeout, clearTimeout } from 'node:timers'

import { sendEventToAll } from './event_dispatcher.mjs'
const watchers = {}
/**
 * 监听前端文件修改并通知所有客户端
 * @param {string} url 前端文件路径
 * @param {string} dir 前端文件目录
 */
export function watchFrontendChanges(url, dir) {
	let timeout
	watchers[url] ??= fs.watch(dir, { recursive: true }, (eventType, filename) => {
		if (!filename) return
		if (timeout) clearTimeout(timeout)
		timeout = setTimeout(() => {
			console.logI18n('fountConsole.web.frontendFilesChanged', { path: url })
			sendEventToAll('page-modified', { path: url })
		}, 666).unref()
	})
}
