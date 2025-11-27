
import fs from 'npm:fs-extra'
import path from 'node:path'
import sanitizeFilename from 'npm:sanitize-filename'
import { getAvailablePath } from '../../../server/parts_paths.mjs'
import { saveJsonFile } from '../../../scripts/loadJsonFile.mjs'

import { data_reader, downloadCharacter } from './card_data_reader.mjs'
import { GetV2CharDataFromV1 } from './TavernCardV2_schema.mjs'
import info from './info.json' assert { type: 'json' }
/**
 * @typedef {import('../../../decl/import.ts').import_handler_t} import_handler_t
 */

/**
 * 将类布尔值（0 或 1）转换为布尔值。
 * @param {any} obj - 要转换的对象。
 * @returns {any} 转换后的对象。
 */
function RN2N(obj) {
	if (obj instanceof Array)
		return obj.map(RN2N)
	else if (typeof obj != 'object' || obj == null)
		return obj
	else if (obj.type === 'bool' || obj.type === 'boolean' || typeof obj === 'boolean' || obj.value instanceof Boolean)
		return obj
	else
		return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, RN2N(v)]))
}

/**
 * 将数据作为 SillyTavern 角色导入。
 * @param {string} username - 用户名。
 * @param {Buffer} data - 数据缓冲区。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
 */
async function ImportAsData(username, data) {
	const chardata = GetV2CharDataFromV1(RN2N(JSON.parse(data_reader.read(data))))

	// make an dir for the character
	// copy directory
	const templateDir = path.join(import.meta.dirname, 'Template')
	const targetPath = await getAvailablePath(username, 'chars', sanitizeFilename(chardata.name || 'unknown'))

	await fs.copy(templateDir, targetPath)
	// write chardata to the character
	const chardataPath = path.join(targetPath, 'chardata.json')
	saveJsonFile(chardataPath, chardata)
	// save image to the character
	const image = data_reader.remove(data)
	const publicDir = path.join(targetPath, 'public')
	await fs.ensureDir(publicDir)
	const imagePath = path.join(publicDir, 'image.png')
	await fs.writeFile(imagePath, image)
	return [{ parttype: 'chars', partname: chardata.name }]
}

/**
 * 通过文本导入 SillyTavern 角色。
 * @param {string} username - 用户名。
 * @param {string} text - 包含角色 URL 的文本。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
 */
async function ImportByText(username, text) {
	const lines = text.split('\n').filter(line => line)
	const importedParts = []
	for (const line of lines)
		if (line.startsWith('http')) {
			const arrayBuffer = await downloadCharacter(line)
			const buffer = Buffer.from(arrayBuffer)
			importedParts.push(...await ImportAsData(username, buffer))
		}
	return importedParts
}

/**
 * @type {import('../../../decl/import.ts').import_handler_t}
 */
export default {
	info,

	interfaces: {
		import: {
			ImportAsData,
			ImportByText,
		}
	}
}
