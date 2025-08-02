import { setEndpoints } from './src/server/main.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getUserDictionary } from '../../../server/auth.mjs'

async function getTemplates(username) {
	const userTemplatesPath = path.join(getUserDictionary(username), 'shells', 'easynew', 'parts')
	const defaultTemplatesPath = path.resolve(import.meta.dirname, '.', 'parts')

	const allTemplates = {}

	const findTemplates = async (basePath) => {
		try {
			const templateNames = await fs.readdir(basePath)
			for (const templateName of templateNames) {
				const templatePath = path.join(basePath, templateName)
				const templateMainPath = path.join(templatePath, 'main.mjs')
				if ((await fs.stat(templatePath)).isDirectory() && (await fs.stat(templateMainPath)).isFile()) 
					allTemplates[templateName] = true
                
			}
		} catch (error) {
			if (error.code !== 'ENOENT') 
				console.error(`Error reading templates from ${basePath}:`, error)
            
		}
	}

	await findTemplates(defaultTemplatesPath)
	await findTemplates(userTemplatesPath)

	return Object.keys(allTemplates)
}


/** @type {import('../../../../decl/shellAPI.ts').ShellAPI_t} */
export default {
	info: {
		'': {
			name: 'EasyNew',
			description: 'Easily create new parts from templates.',
			version: '1.0.0',
			author: 'steve02081504',
			tags: ['tool', 'creator'],
		},
	},

	Load: async ({ router }) => {
		setEndpoints(router)
	},

	Unload: () => { },

	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const action = args[0]

				switch (action) {
					case 'list-templates':
						console.log(await getTemplates(user))
						break
					case 'create':
						const templateName = args[1]
						const partName = args[2]
						const jsonData = args[3] ? JSON.parse(args[3]) : {}

						if (!templateName || !partName) throw new Error('Template name and part name are required.')

						const templateDir = path.resolve(import.meta.dirname, '.', 'parts', templateName)
						const templateModulePath = path.join(templateDir, 'main.mjs')
						const templateModule = await import(pathToFileURL(templateModulePath))

						const formData = { name: partName, ...jsonData }
						const context = { username: user, templateDir, formData, files: {} }
						await templateModule.New(context)
						console.log(`Part '${partName}' created from template '${templateName}'.`)
						break
					default:
						throw new Error(`Unknown action: ${action}. Available actions: list-templates, create`)
				}
			},
			IPCInvokeHandler: async (user, { action, templateName, partName, jsonData, files }) => {
				switch (action) {
					case 'list-templates':
						return getTemplates(user)
					case 'create':
						if (!templateName || !partName) throw new Error('Template name and part name are required.')

						const templateDir = path.resolve(import.meta.dirname, '.', 'parts', templateName)
						const templateModulePath = path.join(templateDir, 'main.mjs')
						const templateModule = await import(pathToFileURL(templateModulePath))

						const formData = { name: partName, ...jsonData }
						const context = { username: user, templateDir, formData, files: files || {} }
						await templateModule.New(context)
						return `Part '${partName}' created from template '${templateName}'.`
					default:
						throw new Error(`Unknown action: ${action}. Available actions: list-templates, create`)
				}
			}
		}
	}
}