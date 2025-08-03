import { importPart, importPartByText } from './Installer_handler.mjs'
import { uninstallPartBase } from '../../../../../server/parts_loader.mjs'
import fs from 'node:fs/promises'

export const actions = {
	install: async ({ user, input }) => {
		try {
			const stats = await fs.stat(input)
			if (stats.isFile()) {
				const fileData = await fs.readFile(input)
				await importPart(user, fileData)
				return `Installed from file: ${input}`
			}
			throw new Error('Input is not a valid file path')
		} catch (error) {
			await importPartByText(user, input)
			return `Installed from text: ${input}`
		}
	},
	uninstall: async ({ user, partType, partName }) => {
		await uninstallPartBase(user, partType, partName)
		return `Uninstalled ${partType}: ${partName}`
	},
	installFromText: async ({ user, input }) => {
		await importPartByText(user, input)
		return 'Installed from text.'
	},
	installFromBuffer: async ({ user, buffer }) => {
		await importPart(user, buffer)
		return 'Installed from buffer.'
	}
}
