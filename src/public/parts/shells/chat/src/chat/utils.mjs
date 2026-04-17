import fs from 'node:fs'
import { readFile, rm, unlink } from 'node:fs/promises'

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

/**
 * `rm`；仅忽略 `ENOENT`。
 * @param {string} path 文件或目录路径
 * @param {import('node:fs').RmOptions} [options] 传给 `fs.promises.rm` 的选项
 * @returns {Promise<void>} 删除完成或目标已不存在
 */
export async function safeRm(path, options) {
	try {
		await rm(path, options)
	}
	catch (e) {
		if (!isEnoent(e)) throw /** @type {Error} */ e
	}
}
