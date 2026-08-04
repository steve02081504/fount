/**
 * CI-only stub swapped in place of src/server/index.mjs by .github/path-ci/install-hooks.sh.
 * Not used locally.
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

process.exit(0)
