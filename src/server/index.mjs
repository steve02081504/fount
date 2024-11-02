import { init } from "./server.mjs"
import { loadShell } from "./shell_manager.mjs"

await init()
let args = process.argv.slice(2)

if (args.length) {
	let shell = await loadShell(args[0], args[1])
	await shell.ArgumentsHandler(args[0], args.slice(2))
}
