import process from 'node:process'

import { __dirname, set_start } from '../../src/server/base.mjs'
import { getPartList, loadPart } from '../../src/server/parts_loader.mjs'
import { init } from '../../src/server/server.mjs'

set_start()

const fount_config = {
	/**
	 * 重新启动服务器。
	 * @returns {never} 不会返回，因为进程会退出。
	 */
	restartor: () => process.exit(131),
	data_path: __dirname + '/.github/workflows/default_data',
	starts: {
		Web: false,
		Tray: false,
		DiscordRPC: false,
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
	await loadPart('CI-user', 'shells/' + shell)
	console.log('loaded shell:', shell)
} catch (e) {
	console.error(`failed to load shell: ${shell}`)
	console.error(e)
	exitCode = 1
}

process.exit(exitCode)
