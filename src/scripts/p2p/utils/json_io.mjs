import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * @param {string} filePath 绝对路径
 * @returns {Promise<object | null>} JSON 或 null
 */
export async function readJsonFile(filePath) {
	try {
		const raw = await fsp.readFile(filePath, 'utf8')
		return JSON.parse(raw)
	}
	catch (err) {
		if (/** @type {NodeJS.ErrnoException} */ err.code === 'ENOENT') return null
		throw err
	}
}

/**
 * @param {string} filePath 绝对路径
 * @param {unknown} data 可序列化对象
 * @returns {Promise<void>}
 */
export async function writeJsonFile(filePath, data) {
	await fsp.mkdir(path.dirname(filePath), { recursive: true })
	const tmp = `${filePath}.tmp`
	await fsp.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
	await fsp.rename(tmp, filePath)
}

/**
 * @param {string} filePath 绝对路径
 * @returns {object | null} JSON 或 null
 */
export function readJsonFileSync(filePath) {
	try {
		const raw = fs.readFileSync(filePath, 'utf8')
		return JSON.parse(raw)
	}
	catch (err) {
		if (/** @type {NodeJS.ErrnoException} */ err.code === 'ENOENT') return null
		throw err
	}
}

/**
 * @param {string} filePath 绝对路径
 * @param {unknown} data 可序列化对象
 * @returns {void}
 */
export function writeJsonFileSync(filePath, data) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	const tmp = `${filePath}.tmp`
	fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
	fs.renameSync(tmp, filePath)
}
