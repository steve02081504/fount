/**
 * 实体私有 JSON（drafts / savedPosts）：缺文件 → empty 工厂新对象。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * @template T
 * @param {string} filePath 绝对路径
 * @param {() => T} empty 空结构工厂
 * @param {(raw: unknown) => T} [normalize] 读盘规范化
 * @returns {Promise<T>} 数据
 */
export async function loadEntityJson(filePath, empty, normalize) {
	try {
		const raw = JSON.parse(await readFile(filePath, 'utf8'))
		return normalize ? normalize(raw) : /** @type {T} */ raw
	}
	catch {
		return empty()
	}
}

/**
 * @template T
 * @param {string} filePath 绝对路径
 * @param {T} data 写入数据
 * @returns {Promise<T>} 原样返回 data
 */
export async function saveEntityJson(filePath, data) {
	await mkdir(path.dirname(filePath), { recursive: true })
	await writeFile(filePath, JSON.stringify(data, null, '\t'), 'utf8')
	return data
}
