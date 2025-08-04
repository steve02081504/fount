import path from 'node:path'
import { pathToFileURL } from 'node:url'

import fs from 'npm:fs-extra'

import { authenticate, getUserByReq, getUserDictionary } from '../../../../../server/auth.mjs'

function getUserTemplatesPath(username) {
	return path.join(getUserDictionary(username), 'shells', 'easynew', 'parts')
}

function getDefaultTemplatesPath() {
	return path.resolve(import.meta.dirname, '..', '..', 'parts')
}

async function getTemplateDir(username, templateName) {
	const userTemplateDir = path.join(getUserTemplatesPath(username), templateName)
	if (fs.existsSync(userTemplateDir))
		return userTemplateDir

	const defaultTemplateDir = path.join(getDefaultTemplatesPath(), templateName)
	if (fs.existsSync(defaultTemplateDir))
		return defaultTemplateDir

	return null
}

export function setEndpoints(router) {
	router.get('/api/shells/easynew/templates', authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const userTemplatesPath = getUserTemplatesPath(username)
			const defaultTemplatesPath = getDefaultTemplatesPath()

			const allTemplates = {}

			const findTemplates = async (basePath) => {
				if (!fs.existsSync(basePath)) return
				const templateNames = await fs.readdir(basePath)
				for (const templateName of templateNames) {
					const templatePath = path.join(basePath, templateName)
					if (!(await fs.stat(templatePath)).isDirectory()) continue

					const templateMainPath = path.join(templatePath, 'main.mjs')
					if (fs.existsSync(templateMainPath))
						allTemplates[templateName] = true // Simply mark as available
				}
			}

			await findTemplates(defaultTemplatesPath)
			await findTemplates(userTemplatesPath)

			res.json(allTemplates)

		} catch (error) {
			console.error('Error getting templates:', error)
			res.status(500).json({ error: 'Failed to get templates.' })
		}
	})

	router.get('/api/shells/easynew/template-html', authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const { templateName } = req.query

			const templateDir = await getTemplateDir(username, templateName)
			const htmlPath = path.join(templateDir, 'index.html')
			const html = await fs.readFile(htmlPath, 'utf-8')
			res.json(html)
		} catch (error) {
			console.error('Error getting template HTML:', error)
			res.status(500).json({ error: 'Failed to get template HTML.' })
		}
	})

	router.post('/api/shells/easynew/create', authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const { templateName } = req.body
			const templateDir = await getTemplateDir(username, templateName)
			const templateModulePath = path.join(templateDir, 'main.mjs')
			const templateModule = await import(pathToFileURL(templateModulePath))
			const partName = await templateModule.New({
				username,
				templateDir,
				formData: req.body,
				files: req.files,
			})

			res.status(201).json({ message: `Part '${partName}' created successfully!`, partName })
		} catch (error) {
			console.error('Error creating part:', error)
			res.status(500).json({ error: error.message || 'Failed to create part.' })
		}
	})
}
