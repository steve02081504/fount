import process from 'node:process'

const shutdowm_functions = []
export function on_shutdown(func) {
	shutdowm_functions.unshift(func)
}
async function shutdown(code = 0) {
	for (const func of shutdowm_functions)
		await func()
	process.exit(code)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGHUP', shutdown)
process.on('exit', shutdown)
