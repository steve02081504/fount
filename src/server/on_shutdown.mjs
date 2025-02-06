import process from 'node:process'

const shutdowm_functions = []
export function on_shutdown(func) {
	shutdowm_functions.unshift(func)
}
export async function shutdown() {
	for (const func of shutdowm_functions)
		await func()
	process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGHUP', shutdown)
