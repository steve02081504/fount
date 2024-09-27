const shutdowm_functions = []
export function on_shutdown(func) {
	shutdowm_functions.push(func)
}
function shutdown() {
	shutdowm_functions.forEach(func => func())
	process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
