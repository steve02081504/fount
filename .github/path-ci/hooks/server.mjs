/**
 * CI-only stub swapped in place of src/server/index.mjs by .github/path-ci/install-hooks.sh.
 * Not used locally.
 */
import 'npm:on-shutdown'

const line = [
	'FOUNT_CI_HOOK:server',
	...Deno.args,
].join(' ')
console.log(line)
const markerFile = Deno.env.get('FOUNT_CI_HOOK_MARKER_FILE')
if (markerFile) {
	await Deno.writeTextFile(markerFile, `${line}\n`, { append: true })
}
Deno.exit(0)
