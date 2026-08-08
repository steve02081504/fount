import process from 'node:process'

import supportsAnsi from 'npm:supports-ansi'

/**
 * 备用屏 / raw stdin 是否可用。
 */
export const canUseTui = Boolean(
	process.stdin.isTTY && process.stdout.isTTY && process.stdout.writable && supportsAnsi,
)

/**
 * @returns {{ columns: number, rows: number }} 终端尺寸
 */
export const terminalSize = () => ({
	columns: process.stdout.columns || 0,
	rows: process.stdout.rows || 0,
})

/**
 * 订阅终端尺寸变化；回调收到当前 `terminalSize()`。
 * @param {(size: { columns: number, rows: number }) => void} listener 尺寸回调
 * @returns {() => void} 取消订阅
 */
export function watchTerminalSize(listener) {
	/** @returns {void} */
	const onResize = () => listener(terminalSize())
	process.stdout.on('resize', onResize)
	return () => process.stdout.off('resize', onResize)
}
