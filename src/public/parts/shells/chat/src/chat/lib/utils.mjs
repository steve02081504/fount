/**
 * 【文件】src/chat/lib/utils.mjs
 * 【职责】chat 后端通用小工具：延迟、重试、数组去重等无领域语义的 helper。
 * 【原理】纯函数集合，避免各子模块复制粘贴相同逻辑。
 * 【数据结构】无持久状态；导出 sleep、uniqBy、clamp 等。
 * 【关联】dag、session、stream 各模块按需引用。
 */
import fs from 'node:fs'
import { readFile, rm, unlink } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * 判断是否为文件或目录不存在的 Node 错误。
 * @param {unknown} e 捕获到的异常
 * @returns {boolean} 当 `code === 'ENOENT'` 时为 true
 */
export function isEnoent(e) {
	return /** @type {{ code?: string }} */ e?.code === 'ENOENT'
}

/**
 * 仅在 `ENOENT` 或 `ENOTDIR` 时吞掉；否则抛出。
 * @param {unknown} e 捕获到的异常
 * @returns {void} 可忽略错误时不抛出；否则抛出 `e`
 */
export function rethrowUnlessEnoentOrEnotdir(e) {
	if (!isEnoent(e) && /** @type {{ code?: string }} */ e?.code !== 'ENOTDIR') throw /** @type {Error} */ e
}

/**
 * 缺失或 JSON 语法无效时吞掉；其余错误原样抛出。
 * @param {unknown} e 捕获到的异常
 * @returns {void} 可忽略错误时不抛出；否则抛出 `e`
 */
export function rethrowUnlessMissingOrInvalidJson(e) {
	if (!isEnoent(e) && !(e instanceof SyntaxError)) throw /** @type {Error} */ e
}

/**
 * 读取 UTF-8 并 `JSON.parse`；`ENOENT` / `SyntaxError` 时返回 `null`。
 * @param {string} path 文件路径
 * @returns {Promise<object | null>} 解析后的对象；缺失或非法 JSON 时为 `null`
 */
export async function safeReadJson(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'))
	}
	catch (e) {
		rethrowUnlessMissingOrInvalidJson(e)
		return null
	}
}

/**
 * `unlink`；仅忽略 `ENOENT`。
 * @param {string} path 文件路径
 * @returns {Promise<void>} 删除完成或目标已不存在
 */
export async function safeUnlink(path) {
	try {
		await unlink(path)
	}
	catch (e) {
		if (!isEnoent(e)) throw /** @type {Error} */ e
	}
}

/**
 * `unlinkSync`；仅忽略 `ENOENT`。
 * @param {string} path 文件路径
 * @returns {void} 同步删除完成或目标已不存在
 */
export function safeUnlinkSync(path) {
	try {
		fs.unlinkSync(path)
	}
	catch (e) {
		if (!isEnoent(e)) throw /** @type {Error} */ e
	}
}

/** Windows 上删目录树时若仍有句柄占用会短暂抛 EPERM/EBUSY，做几次退避重试。 */
const RM_RETRY_DELAYS_MS = [10, 25, 50, 100, 200]
const RM_TRANSIENT_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])

/**
 * `rm`；忽略 `ENOENT`，并对 Windows 句柄占用类瞬时错误退避重试。
 * @param {string} path 文件或目录路径
 * @param {import('node:fs').RmOptions} [options] 传给 `fs.promises.rm` 的选项
 * @returns {Promise<void>} 删除完成或目标已不存在
 */
export async function safeRm(path, options) {
	/** @type {NodeJS.ErrnoException | undefined} */
	let lastError
	for (let attempt = 0; attempt <= RM_RETRY_DELAYS_MS.length; attempt++) {
		if (attempt) await sleep(RM_RETRY_DELAYS_MS[attempt - 1])
		try {
			await rm(path, options)
			return
		}
		catch (e) {
			if (isEnoent(e)) return
			lastError = /** @type {NodeJS.ErrnoException} */ e
			if (!RM_TRANSIENT_CODES.has(lastError.code)) throw lastError
		}
	}
	throw lastError
}
