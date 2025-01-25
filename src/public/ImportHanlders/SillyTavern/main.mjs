import { getAvailablePath } from './path.mjs'
import data_reader from './data_reader.mjs'
import fs from 'npm:fs-extra'
import path from 'node:path'
import { saveJsonFile } from '../../../scripts/json_loader.mjs'
import { GetV2CharDataFromV1 } from './engine/charData.mjs'
import sanitizeFilename from 'npm:sanitize-filename'

async function ImportAsData(username, data) {
	const chardata = GetV2CharDataFromV1(JSON.parse(data_reader.read(data)))

	// make an dir for the character
	// copy directory
	let templateDir = path.join(import.meta.dirname, 'Template')
	let targetPath = await getAvailablePath(username, 'chars', sanitizeFilename(chardata.name || 'unknown'))

	await fs.copy(templateDir, targetPath)
	// write chardata to the character
	let chardataPath = path.join(targetPath, 'chardata.json')
	saveJsonFile(chardataPath, chardata)
	// save image to the character
	let image = data_reader.remove(data)
	let imagePath = path.join(targetPath, 'image.png')
	await fs.writeFile(imagePath, image)
}

async function ImportByText(username, text) {
	throw new Error('Not implemented')
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
