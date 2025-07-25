import * as Sentry from 'npm:@sentry/deno'
Sentry.init({
	dsn: 'https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704',
})
import 'https://cdn.jsdelivr.net/gh/steve02081504/js-polyfill@master/index.mjs'

import { __dirname, set_start } from './base.mjs'
set_start()

import process from 'node:process'
import { init } from './server.mjs'
import { console } from '../scripts/i18n.mjs'

console.logI18n('fountConsole.server.standingBy')

let args = process.argv.slice(2)

const fount_config = {
	restartor: () => process.exit(131),
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
	else if (command === 'shutdown') {
		command_obj = {
			type: 'shutdown',
		}
		fount_config.starts = {
			Base: false,
			Web: false,
			Tray: false,
			DiscordIPC: false,
		}
	}
	else {
		console.errorI18n('fountConsole.ipc.invalidCommand')
		process.exit(1)
	}
}

const okey = await init(fount_config)

if (command_obj) try {
	if (!fount_config.starts.IPC) throw new Error('cannot send command when IPC not enabled')
	const { IPCManager } = await import('./ipc_server.mjs')
	await IPCManager.sendCommand(command_obj.type, command_obj.data)
} catch (err) {
	if (!(command_obj.type === 'shutdown' && String(err).endsWith('read ECONNRESET')))
		console.errorI18n('fountConsole.ipc.sendCommandFailed', { error: err })
	else throw err
}

if (!okey) process.exit(0)
