import fs from 'node:fs/promises'

import { uninstallPartBase } from '../../../../../server/parts_loader.mjs'

import { importPart, importPartByText } from './Installer_handler.mjs'

/**
 * 定义了可用于安装和卸载组件的各种操作。
 */
export const actions = {
	/**
	 * 从文件路径或文本内容安装一个组件。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.input - 文件路径或文本内容。
	 * @returns {Promise<string>} - 确认消息。
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
	 * 卸载一个组件。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.partpath - 组件的路径。
	 * @returns {Promise<string>} - 确认消息。
	 */
	uninstall: async ({ user, partpath }) => {
		await uninstallPartBase(user, partpath)
		return `Uninstalled ${partpath}`
	},
	/**
	 * 从文本内容安装一个组件。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.input - 包含组件数据的文本内容。
	 * @returns {Promise<string>} - 确认消息。
	 */
	installFromText: async ({ user, input }) => {
		await importPartByText(user, input)
		return 'Installed from text.'
	},
	/**
	 * 从缓冲区安装一个组件。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {Buffer} root0.buffer - 包含组件数据的缓冲区。
	 * @returns {Promise<string>} - 确认消息。
	 */
	installFromBuffer: async ({ user, buffer }) => {
		await importPart(user, buffer)
		return 'Installed from buffer.'
	}
}
