import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getUserDictionary } from '../../../../server/auth.mjs'

async function getTemplates(username) {
	const userTemplatesPath = path.join(getUserDictionary(username), 'shells', 'easynew', 'parts')
	const defaultTemplatesPath = path.resolve(import.meta.dirname, '..', 'parts')

	const allTemplates = {}

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

export const actions = {
	'list-templates': ({ user }) => getTemplates(user),
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
