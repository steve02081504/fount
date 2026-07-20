import { mkdir, readFile, writeFile } from 'node:fs/promises'

/**
 * @param {string} filePath 文件路径
 * @returns {Promise<void>}
 */
export async function ensureParentDir(filePath) {
	await mkdir(filePath.replace(/[/\\][^/\\]+$/, ''), { recursive: true })
}

/**
 * @param {string} filePath 文件路径
 * @param {unknown} fallback 缺省值
 * @returns {Promise<unknown>} JSON
 */
export async function readJsonFile(filePath, fallback) {
	try {
		return JSON.parse(await readFile(filePath, 'utf8'))
	}
	catch {
		return fallback
	}
}

/**
 * @param {string} filePath 文件路径
 * @param {unknown} data 数据
 * @param {{ pretty?: boolean }} [options] 选项
 * @returns {Promise<void>}
 */
export async function writeJsonFile(filePath, data, options = {}) {
	await ensureParentDir(filePath)
	const text = options.pretty === false ? JSON.stringify(data) : JSON.stringify(data, null, '\t')
	await writeFile(filePath, text, 'utf8')
}
