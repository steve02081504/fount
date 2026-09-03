/**
 * 【文件】core/temp_origin.mjs
 * 【职责】fount[-_]* 临时目录（系统 Temp / data/test）创建时写入来源标记（origin.txt），
 *  残留排查直接读该文件定位创建者，无需反查代码。best-effort：写失败不碍事。
 */
import { writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 目录内来源标记文件名。 */
export const TEMP_ORIGIN_FILE = 'origin.txt'

/**
 * @param {string} dir 临时目录
 * @returns {string} origin 文件完整路径
 */
export function tempOriginPath(dir) {
	return join(dir, TEMP_ORIGIN_FILE)
}

/**
 * @param {string} origin 创建者描述
 * @returns {string} `origin 描述 + ISO 时间` 两行内容
 */
function originContent(origin) {
	return `${origin}\n${new Date().toISOString()}\n`
}

/**
 * 异步写来源标记（best-effort：标记失败不碍事）。
 * @param {string} dir 临时目录
 * @param {string} origin 创建者描述（如 `suite chat:pure (runSuiteOnce)`）
 * @returns {Promise<void>}
 */
export async function markTempDirOrigin(dir, origin) {
	try {
		await writeFile(tempOriginPath(dir), originContent(origin), 'utf8')
	}
	catch { /* best-effort：标记失败不碍事 */ }
}

/**
 * 同步写来源标记（mkdtempSync 创建点用）。
 * @param {string} dir 临时目录
 * @param {string} origin 创建者描述（如 `telegrambot format_bridge.test.mjs fount_tg_bq_`）
 * @returns {void}
 */
export function markTempDirOriginSync(dir, origin) {
	try {
		writeFileSync(tempOriginPath(dir), originContent(origin), 'utf8')
	}
	catch { /* best-effort：标记失败不碍事 */ }
}
