import process from 'node:process'

import { __dirname, set_start } from '../../src/server/base.mjs'
import { hosturl, init } from '../../src/server/server.mjs'

set_start()

const fount_config = {
	/**
	 * 重新启动服务器。
	 * @returns {never}
	 */
	restartor: () => process.exit(131),
	data_path: __dirname + '/.github/workflows/default_data',
	starts: {
		Web: true,
		Tray: false,
		DiscordRPC: false,
		Base: {
			Jobs: false,
			Timers: false,
			Idle: false,
			AutoUpdate: false,
		},
	},
}

console.log('starting fount server')

const okey = await init(fount_config)

if (!okey) {
	console.error('server init failed')
	process.exit(1)
}

const pingUrl = hosturl + '/api/ping'
console.log('pinging', pingUrl)

const res = await fetch(pingUrl, { method: 'GET', cache: 'no-store' })

if (!res.ok) {
	console.error('api/ping failed:', res.status, res.statusText)
	process.exit(1)
}

const data = await res.json()
if (data?.message !== 'pong') {
	console.error('api/ping unexpected response:', data)
	process.exit(1)
}

console.log('api/ping OK:', data.message)
process.exit(0)
