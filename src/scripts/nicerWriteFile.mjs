import { Buffer } from 'node:buffer'
import fs from 'node:fs'
/**
 * 如果数据与现有数据不同步，则将数据写入文件。
 *
 * @param {string} filePath - 要写入的文件的路径。
 * @param {string|Buffer} data - 要写入文件的数据。
 * @param {string} [encoding='utf8'] - 写入文件时使用的编码。
 * @returns {void}
 */
export function nicerWriteFileSync(filePath, data, encoding) {
	if (Object(data) instanceof String) encoding ??= 'utf8'
	let oldData
	if (fs.existsSync(filePath))
		oldData = fs.readFileSync(filePath, encoding)
	if (!Buffer.from(oldData ?? '').equals(Buffer.from(data)))
		fs.writeFileSync(filePath, data, encoding)
}
