import process from 'node:process'

import supportsAnsi from 'npm:supports-ansi'
/**
 * 设置终端窗口的标题。
 * @param {string} title - 窗口的期望标题。
 */
export function setWindowTitle(title) {
	if (supportsAnsi && process.stdout.writable) process.stdout.write(`\x1b]2;${title}\x1b\x5c`)
	process.title = title
}

/**
 * 获取终端窗口的标题。
 * @returns {string} 窗口的当前标题。
 */
export function getWindowTitle() {
	return process.title
}
