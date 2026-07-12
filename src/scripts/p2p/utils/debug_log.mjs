import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(process.cwd(), 'debug_logs')

/**
 * P2P 观测落盘：写入进程 cwd 下 `debug_logs/`（与 monorepo `debugLog` 行为对齐）。
 * @param {string} name 日志文件名（不含扩展名）
 * @param {unknown} data 调试数据
 * @returns {Promise<void>}
 */
export async function debugLog(name, data) {
	const text = Object(data) instanceof String ? data : JSON.stringify(data)
	await fs.promises.mkdir(dir, { recursive: true })
	await fs.promises.appendFile(path.join(dir, `${name}.log`), text)
}
