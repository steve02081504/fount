// todo: remove this file when https://github.com/denoland/deno/issues/35774 is fixed
import process from 'node:process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { execFile } from 'npm:@steve02081504/exec'

const liveDir = dirname(fileURLToPath(import.meta.url))
const files = [
	'link_smoke.test.mjs',
	'backpressure_smoke.test.mjs',
	'link_registry_mock.test.mjs',
	'group_link_set_mock.test.mjs',
]

for (const file of files) {
	const path = join(liveDir, file)
	const result = await execFile('deno', ['test', '--no-check', '--allow-all', '-c', './deno.json', path], {
		cwd: join(liveDir, '..', '..', '..', '..', '..'),
	})
	process.stdout.write(result.stdall)
	if ((result.code ?? 1) !== 0) process.exit(result.code ?? 1)
}
