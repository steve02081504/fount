/**
 * 【文件】core/temp_origin.mjs
 * 【职责】fount[-_]* 临时目录（系统 Temp / data/test）创建时写入来源标记（origin.txt），
 *  残留排查直接读该文件定位创建者，无需反查代码。best-effort：写失败不碍事。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

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
 * 读取来源标记里的 job 归属；无标记、旧格式或写失败时返回 null。
 * @param {string} dir 临时目录
 * @returns {string | null} job id
 */
export function readTempDirOwner(dir) {
	try {
		const metadata = JSON.parse(readFileSync(tempOriginPath(dir), 'utf8').split('\n')[2])
		return typeof metadata?.jobId === 'string' ? metadata.jobId : null
	}
	catch {
		return null
	}
}

/**
 * @param {string} origin 创建者描述
 * @param {string} [owner] 所属 job；默认继承测试子进程环境
 * @returns {string} 来源、时间和可选 job 元数据
 */
function originContent(origin, owner = process.env.FOUNT_TEST_CLEANUP_OWNER) {
	const metadata = owner ? `${JSON.stringify({ jobId: owner })}\n` : ''
	return `${origin}\n${new Date().toISOString()}\n${metadata}`
}

/**
 * 异步写来源标记（best-effort：标记失败不碍事）。
 * @param {string} dir 临时目录
 * @param {string} origin 创建者描述（如 `suite chat:pure (runSuiteOnce)`）
 * @param {string} [owner] 所属 job
 * @returns {Promise<void>}
 */
export async function markTempDirOrigin(dir, origin, owner) {
	try {
		await writeFile(tempOriginPath(dir), originContent(origin, owner), 'utf8')
	}
	catch { /* best-effort：标记失败不碍事 */ }
}

/**
 * 同步写来源标记（mkdtempSync 创建点用）。
 * @param {string} dir 临时目录
 * @param {string} origin 创建者描述（如 `telegrambot format_bridge.test.mjs fount_tg_bq_`）
 * @param {string} [owner] 所属 job
 * @returns {void}
 */
export function markTempDirOriginSync(dir, origin, owner) {
	try {
		writeFileSync(tempOriginPath(dir), originContent(origin, owner), 'utf8')
	}
	catch { /* best-effort：标记失败不碍事 */ }
}
