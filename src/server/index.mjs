import * as Sentry from 'npm:@sentry/deno'
Sentry.init({
	dsn: 'https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704',
	_experiments: { enableLogs: true },
})

import { set_start } from './base.mjs'
set_start()

import process from 'node:process'
import { console } from '../scripts/console.mjs'
import { init } from './server.mjs'
import { IPCManager } from './ipc_server.mjs'
import { ReStartJobs } from './jobs.mjs'
import { geti18n } from '../scripts/i18n.mjs'
import { startTimerHeartbeat } from './timers.mjs'

console.log(await geti18n('fountConsole.server.standingBy'))

let args = process.argv.slice(2)

const isFirstInstance = await init()

if (args.length) {
	const command = args[0]
	args = args.slice(1)

	if (command === 'run') {
		const username = args[0]
		const parttype = args[1]
		const partname = args[2]
		args = args.slice(3)

		try {
			await IPCManager.sendCommand('runpart', { username, parttype, partname, args })
		} catch (err) {
			console.error(await geti18n('fountConsole.ipc.sendCommandFailed', { error: err }))
			process.exit(1)
		}
	}
	else if (command === 'shutdown')
		try {
			await IPCManager.sendCommand('shutdown')
		} catch (err) {
			console.error(await geti18n('fountConsole.ipc.sendCommandFailed', { error: err }))
			process.exit(1)
		}
	else {
		console.error(await geti18n('fountConsole.ipc.invalidCommand'))
		process.exit(1)
	}
}

if (!isFirstInstance) process.exit(0)

ReStartJobs()
startTimerHeartbeat()
