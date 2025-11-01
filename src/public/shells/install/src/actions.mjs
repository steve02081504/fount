import fs from 'node:fs/promises'

import { uninstallPartBase } from '../../../../server/parts_loader.mjs'

import { importPart, importPartByText } from './Installer_handler.mjs'

/**
 *
 */
export const actions = {
	/**
	 *
	 * @param root0
	 * @param root0.user
	 * @param root0.input
	 */
	install: async ({ user, input }) => {
		try {
			const stats = await fs.stat(input)
			if (stats.isFile()) {
				const fileData = await fs.readFile(input)
				await importPart(user, fileData)
				return `Installed from file: ${input}`
			}
			throw new Error('Input is not a valid file path')
		}
		catch {
			await importPartByText(user, input)
			return `Installed from text: ${input}`
		}
	},
	/**
	 *
	 * @param root0
	 * @param root0.user
	 * @param root0.partType
	 * @param root0.partName
	 */
	uninstall: async ({ user, partType, partName }) => {
		await uninstallPartBase(user, partType, partName)
		return `Uninstalled ${partType}: ${partName}`
	},
	/**
	 *
	 * @param root0
	 * @param root0.user
	 * @param root0.input
	 */
	installFromText: async ({ user, input }) => {
		await importPartByText(user, input)
		return 'Installed from text.'
	},
	/**
	 *
	 * @param root0
	 * @param root0.user
	 * @param root0.buffer
	 */
	installFromBuffer: async ({ user, buffer }) => {
		await importPart(user, buffer)
		return 'Installed from buffer.'
	}
}
