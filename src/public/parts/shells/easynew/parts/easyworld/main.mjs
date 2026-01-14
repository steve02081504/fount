import path from 'node:path'

import fs from 'npm:fs-extra'
import sanitizeFilename from 'npm:sanitize-filename'

import { saveJsonFile } from '../../../../../../scripts/json_loader.mjs'
import { getUserDictionary } from '../../../../../../server/auth.mjs'

/**
 * 获取一个可用的部件路径。
 * @param {string} username - 用户名。
 * @param {string} type - 部件类型。
 * @param {string} name - 部件名称。
 * @returns {Promise<string>} - 可用的部件路径。
 */
async function getAvailablePath(username, type, name) {
	const userPath = getUserDictionary(username)
	const partPath = path.join(userPath, type, name)
	if (fs.existsSync(partPath))
		throw new Error(`A part with the name "${name}" already exists. Please choose a different name.`)
	return partPath
}

/**
 * 创建一个新的世界部件。
 * @param {object} context - 上下文对象。
 * @param {string} context.username - 用户名。
 * @param {string} context.templateDir - 模板目录。
 * @param {object} context.formData - 表单数据。
 * @param {object} context.files - 上传的文件。
 * @returns {Promise<string>} - 新部件的名称。
 */
export async function New(context) {
	const { username, templateDir, formData, files } = context
	const partType = 'worlds'

	if (!formData.name)
		throw new Error('World Name is required.')

	const partData = {
		// info
		name: formData.name,
		description: formData.description || '',
		description_markdown: formData.description_markdown || '',
		author: formData.author || username,
		version: formData.version || '0.0.0',
		tags: formData.tags ? formData.tags.split(',').map(tag => tag.trim()) : [],
		home_page: formData.home_page || '',
		issue_page: formData.issue_page || '',

		// world data
		prompt: formData.prompt || '',
		greeting: formData.greeting || '',
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

	if (imageFile) {
		const publicDir = path.join(targetPath, 'public')
		await fs.ensureDir(publicDir)
		await fs.writeFile(path.join(publicDir, 'image.png'), imageFile.data)
	}

	// Create partdata.json
	const templateDataPath = path.join(templateDir, 'template_partdata.json')
	const templateData = fs.existsSync(templateDataPath) ? await fs.readJson(templateDataPath) : {}
	await saveJsonFile(path.join(targetPath, 'partdata.json'), { ...templateData, ...partData, creator: username })

	return partData.name
}
