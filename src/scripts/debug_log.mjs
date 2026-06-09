import fs from 'node:fs'
import path from 'node:path'

import { __dirname } from '../server/base.mjs'

const dir = path.resolve(__dirname + '/debug_logs')

/**
 * 服务端调试日志写入工具。
 * 将调试数据追加写入项目 `debug_logs/` 目录下的日志文件。
 * @param {string} name 日志文件名（不含扩展名，自动追加 `.log`）。
 * @param {unknown} data 要写入的调试数据。
 * @returns {Promise<void>}
 */
export async function debugLog(name, data) {
	const text = Object(data) instanceof String ? data : JSON.stringify(data)
	await fs.promises.mkdir(dir, { recursive: true })
	await fs.promises.appendFile(path.join(dir, `${name}.log`), text)
}
