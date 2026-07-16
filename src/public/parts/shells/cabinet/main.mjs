import { setEndpoints } from './src/endpoints.mjs'
import { startFolderSyncScheduler, stopFolderSyncScheduler } from './src/folderSync.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 文件柜 shell 入口。
 */
export default {
	info,
	/**
	 * @param {{ router: import('npm:express').Router }} options 选项
	 * @returns {void}
	 */
	Load({ router }) {
		setEndpoints(router)
		startFolderSyncScheduler()
	},
	/**
	 * @returns {void}
	 */
	Unload() {
		stopFolderSyncScheduler()
	},
	interfaces: {
		web: {},
	},
}
