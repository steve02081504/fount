/**
 * CI-only stub swapped in place of src/server/index.mjs by .github/path-ci/install-hooks.sh.
 * Not used locally.
 */
const label = 'FOUNT_CI_HOOK:server'
const args = Deno.args.join(' ')
const line = args ? `${label} ${args}` : label
console.log(line)
const markerFile = Deno.env.get('FOUNT_CI_HOOK_MARKER_FILE')
if (markerFile) {
	await Deno.writeTextFile(markerFile, `${line}\n`, { append: true })
}
Deno.exit(0)
