import { Buffer } from 'node:buffer'
import path from 'node:path'

import fs from 'npm:fs-extra'
import sanitizeFilename from 'npm:sanitize-filename'

import { saveJsonFile } from '../../../scripts/json_loader.mjs'

import { downloadCharacter } from './char-download.mjs'
import data_reader from './data_reader.mjs'
import { GetV2CharDataFromV1 } from './engine/charData.mjs'
import { getAvailablePath } from './path.mjs'

/**
 * 将对象中的 `\r\n` 和 `\r` 替换为 `\n`。
 * @param {any} obj - 要处理的对象。
 * @returns {any} - 处理后的对象。
 */
function RN2N(obj) {
	if (!obj) return obj
	if (Object(obj) instanceof String)
		return obj.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
	else if (Array.isArray(obj))
		return obj.map(RN2N)
	else if (Object(obj) instanceof Number || Object(obj) instanceof Boolean)
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
 *
 */
export default {
	info: {
		'': {
			name: 'SillyTavern',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: []
		}
	},

	interfaces: {
		import: {
			ImportAsData,
			ImportByText,
		}
	}
}
