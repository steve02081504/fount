import * as Sentry from 'npm:@sentry/deno'
Sentry.init({
	dsn: 'https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704',
	_experiments: { enableLogs: true },
})

import { __dirname, set_start } from './base.mjs'
set_start()

import process from 'node:process'
import { console } from '../scripts/console.mjs'
import { init } from './server.mjs'
import { geti18n } from '../scripts/i18n.mjs'

console.log(await geti18n('fountConsole.server.standingBy'))

let args = process.argv.slice(2)

const fount_config = {
	starts: {
		IPC: true,
		Web: true,
		Tray: true,
		DiscordIPC: true,
	},
	data_path: __dirname + '/data',
}

let command_obj

if (args.length) {
	const command = args[0]
	args = args.slice(1)

	if (command === 'run') {
		const username = args[0]
		const parttype = args[1]
		const partname = args[2]
		args = args.slice(3)

		command_obj = {
			type: 'runpart',
			data: { username, parttype, partname, args },
		}
	}
	else if (command === 'shutdown')
		command_obj = {
			type: 'shutdown',
		}
	else {
		console.error(await geti18n('fountConsole.ipc.invalidCommand'))
		process.exit(1)
	}
}

const okey = await init(fount_config)

if (command_obj) try {
	if (!fount_config.starts.IPC) throw new Error('cannot send command when IPC not enabled')
	const { IPCManager } = await import('./ipc_server.mjs')
	await IPCManager.sendCommand(command_obj.type, command_obj.data)
} catch (err) {
	console.error(await geti18n('fountConsole.ipc.sendCommandFailed', { error: err }))
	process.exit(1)
}

if (!okey) process.exit(0)
