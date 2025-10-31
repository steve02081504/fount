import process from 'node:process'

import { __dirname, set_start } from '../../src/server/base.mjs'
import { getPartList } from '../../src/server/managers/index.mjs'
import { loadShell } from '../../src/server/managers/shell_manager.mjs'
import { init } from '../../src/server/server.mjs'

set_start()

const fount_config = {
	/**
	 * @description 重新启动服务器。
	 * @returns {void}
	 */
	restartor: () => process.exit(1),
	data_path: __dirname + '/.github/workflows/default_data',
	starts: {
		Web: false,
		Tray: false,
		DiscordIPC: false,
		Base: {
			Jobs: false,
			Timers: false,
		}
	}
}

console.log('starting fount server')

const okey = await init(fount_config)

if (!okey) {
	console.error('server init failed')
	process.exit(1)
}

const shells_list = getPartList('CI-user', 'shells')

let exitCode = 0
for (const shell of shells_list) try {
	await loadShell('CI-user', shell)
	console.log('loaded shell:', shell)
} catch (e) {
	console.error(`failed to load shell: ${shell}`)
	console.error(e)
	exitCode = 1
}

process.exit(exitCode)
