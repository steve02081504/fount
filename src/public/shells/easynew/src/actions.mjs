import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getUserDictionary } from '../../../../server/auth.mjs'

/**
 * 获取模板。
 * @param {string} username - 用户名。
 * @returns {Promise<Array<string>>} - 模板列表。
 */
async function getTemplates(username) {
	const userTemplatesPath = path.join(getUserDictionary(username), 'shells', 'easynew', 'parts')
	const defaultTemplatesPath = path.resolve(import.meta.dirname, '..', 'parts')

	const allTemplates = {}

	/**
	 * 查找模板。
	 * @param {string} basePath - 基本路径。
	 * @returns {Promise<void>}
	 */
	const findTemplates = async basePath => {
		try {
			const templateNames = await fs.readdir(basePath)
			for (const templateName of templateNames) {
				const templatePath = path.join(basePath, templateName)
				const templateMainPath = path.join(templatePath, 'main.mjs')
				if ((await fs.stat(templatePath)).isDirectory() && (await fs.stat(templateMainPath)).isFile())
					allTemplates[templateName] = true
			}
		}
		catch (error) {
			if (error.code !== 'ENOENT')
				console.error(`Error reading templates from ${basePath}:`, error)
		}
	}

	await findTemplates(defaultTemplatesPath)
	await findTemplates(userTemplatesPath)

	return Object.keys(allTemplates)
}

/**
 * 快速新建操作
 */
export const actions = {
	/**
	 * 列出模板。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @returns {Promise<Array<string>>} - 模板列表。
	 */
	'list-templates': ({ user }) => getTemplates(user),
	/**
	 * 创建。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.templateName - 模板名称。
	 * @param {string} root0.partName - 部件名称。
	 * @param {object} root0.jsonData - JSON数据。
	 * @param {object} root0.files - 文件。
	 * @returns {Promise<string>} - 成功消息。
	 */
	create: async ({ user, templateName, partName, jsonData, files }) => {
		if (!templateName || !partName) throw new Error('Template name and part name are required.')

		const templateDir = path.resolve(import.meta.dirname, '..', 'parts', templateName)
		const templateModulePath = path.join(templateDir, 'main.mjs')
		const templateModule = await import(pathToFileURL(templateModulePath))

		const formData = { name: partName, ...jsonData }
		const context = { username: user, templateDir, formData, files: files || {} }
		await templateModule.New(context)
		return `Part '${partName}' created from template '${templateName}'.`
	}
}
