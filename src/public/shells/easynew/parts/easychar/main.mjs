import fs from 'npm:fs-extra'
import path from 'node:path'
import sanitizeFilename from 'npm:sanitize-filename'
import { getUserDictionary } from '../../../../../server/auth.mjs'
import { saveJsonFile } from '../../../../../scripts/json_loader.mjs'

async function getAvailablePath(username, type, name) {
	const userPath = getUserDictionary(username)
	const partPath = path.join(userPath, type, name)
	if (fs.existsSync(partPath))
		throw new Error(`A part with the name "${name}" already exists. Please choose a different name.`)
	return partPath
}

// This function is called by the easynew shell's backend when the user clicks "Create".
export async function New(context) {
	const { username, templateDir, formData, files } = context
	const partType = 'chars'

	if (!formData.name)
		throw new Error('Part Name is required.')

	const partData = {
		// info
		name: formData.name,
		description: formData.description || '',
		description_markdown: formData.description_markdown || '',
		author: formData.author || username,
		version: formData.version || '1.0.0',
		tags: formData.tags ? formData.tags.split(',').map(tag => tag.trim()) : [],
		home_page: formData.home_page || '',
		issue_page: formData.issue_page || '',

		// char data
		first_mes: formData.first_mes || '',
		personality: formData.personality || '',
		scenario: formData.scenario || '',
		mes_example: formData.mes_example || '',
		// extensions for more complex data
		extensions: {
			talkativeness: 0.5, // example extension
		},
	}

	const sanitizedName = sanitizeFilename(partData.name)
	const targetPath = await getAvailablePath(username, partType, sanitizedName)
	await fs.ensureDir(targetPath)

	// Copy template files
	const templateMainPath = path.join(templateDir, 'template/main.mjs')
	if (fs.existsSync(templateMainPath))
		await fs.copy(templateMainPath, path.join(targetPath, 'main.mjs'))


	// Save uploaded image
	const imageFile = files?.image
	partData.has_avatar = !!imageFile

	if (imageFile) await fs.writeFile(path.join(targetPath, 'image.png'), imageFile.data)

	// Create partdata.json
	const templateDataPath = path.join(templateDir, 'template_partdata.json')
	const templateData = fs.existsSync(templateDataPath) ? await fs.readJson(templateDataPath) : {}
	await saveJsonFile(path.join(targetPath, 'partdata.json'), {
		...templateData,
		...partData,
		creator: username,
	})

	return partData.name
}
