/**
 * CI 专用桩：由 `path/CI/install-hooks.sh` 临时替换 `src/server/index.mjs`；本地不用。
 */
import fs from 'node:fs'
import process from 'node:process'
// Side-effect import: ensure node_modules layout for deno install in CI.
import 'npm:nop'

const line = [
	'FOUNT_CI_HOOK:server',
	...process.argv.slice(2),
].join(' ')
console.log(line)
const markerFile = process.env.FOUNT_CI_HOOK_MARKER_FILE
if (markerFile) fs.appendFileSync(markerFile, `${line}\n`)
