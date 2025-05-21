import process from 'node:process'
import { tray } from './server.mjs'

const shutdowm_functions = []
export function on_shutdown(func) {
	shutdowm_functions.unshift(func)
}
export async function shutdown(code = 0) {
	for (const func of shutdowm_functions)
		await func()
	if (tray) tray.kill()
	process.exit(code)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGHUP', shutdown)
