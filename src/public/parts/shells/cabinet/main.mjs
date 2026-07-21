import {
	registerShellPartpath,
	unregisterShellPartpath,
} from 'npm:@steve02081504/fount-p2p/registries/part_path'

import { setEndpoints } from './src/endpoints.mjs'
import { startFolderSyncScheduler, stopFolderSyncScheduler } from './src/folderSync.mjs'
import { handleCabinetP2PInvoke, registerCabinetOperationInbound } from './src/shared/sync.mjs'
import { registerCabinetManifestTransfer, unregisterCabinetManifestTransfer } from './src/shared/transfer.mjs'

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
		registerShellPartpath('cabinet', 'shells/cabinet')
		registerCabinetManifestTransfer()
		registerCabinetOperationInbound()
		setEndpoints(router)
		startFolderSyncScheduler()
	},
	/**
	 * @returns {void}
	 */
	Unload() {
		unregisterShellPartpath('cabinet')
		unregisterCabinetManifestTransfer()
		stopFolderSyncScheduler()
	},
	interfaces: {
		web: {},
		invokes: {
			P2PInvokeHandler: handleCabinetP2PInvoke,
		},
	},
}
