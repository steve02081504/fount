import { getAvailablePath } from './path.mjs'
import data_reader from './data_reader.mjs'
import fs from 'npm:fs-extra@11.3.0'
import path from 'node:path'
import { saveJsonFile } from '../../../scripts/json_loader.mjs'
import { GetV2CharDataFromV1 } from './engine/charData.mjs'
import sanitizeFilename from 'npm:sanitize-filename'
import { downloadCharacter } from './char-download.mjs'
import { Buffer } from 'node:buffer'

async function ImportAsData(username, data) {
	const chardata = GetV2CharDataFromV1(JSON.parse(data_reader.read(data)))

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
	const imagePath = path.join(targetPath, 'image.png')
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
			version: '1.0.0',
			author: 'steve02081504',
			homepage: '',
			tags: []
		}
	},

	ImportAsData,
	ImportByText
}
