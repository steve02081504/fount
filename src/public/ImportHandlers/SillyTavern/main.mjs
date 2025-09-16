import { Buffer } from 'node:buffer'
import path from 'node:path'

import fs from 'npm:fs-extra'
import sanitizeFilename from 'npm:sanitize-filename'

import { saveJsonFile } from '../../../scripts/json_loader.mjs'

import { downloadCharacter } from './char-download.mjs'
import data_reader from './data_reader.mjs'
import { GetV2CharDataFromV1 } from './engine/charData.mjs'
import { getAvailablePath } from './path.mjs'







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
}

async function ImportByText(username, text) {
	const lines = text.split('\n').filter(line => line)
	for (const line of lines)
		if (line.startsWith('http')) {
			const arrayBuffer = await downloadCharacter(line)
			const buffer = Buffer.from(arrayBuffer)
			await ImportAsData(username, buffer)
		}
}

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
