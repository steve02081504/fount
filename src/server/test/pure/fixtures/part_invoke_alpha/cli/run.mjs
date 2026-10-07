/* eslint-disable jsdoc/require-jsdoc */
export async function Run(context) {
	const { args, data, stdout, cwd, ipcPort, onCleanup } = context
	onCleanup(() => stdout.write('cleanup\n'))
	stdout.write(JSON.stringify({ args, data, cwd, ipcPort }) + '\n')
	return 7
}
