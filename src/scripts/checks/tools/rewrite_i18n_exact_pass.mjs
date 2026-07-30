/**
 * 第二遍：仅 exact 替换 rename map（补全 prefix 半截路径）。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import createIgnore from 'npm:ignore'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'

const map = new Map(Object.entries(JSON.parse(
	await readFile(join(REPO_ROOT, 'data/test/i18n_key_rename_map.json'), 'utf8'),
)))
const entries = [...map.entries()]
	.filter(([from, to]) => from !== to && !to.startsWith(`${from}.`))
	.sort((a, b) => b[0].length - a[0].length)

/**
 * @param {string} text
 * @returns {{ text: string, hits: number }}
 */
function rewriteExact(text) {
	let hits = 0
	let out = text
	for (const [from, to] of entries) {
		for (const quote of ["'", '"', '`']) {
			const exact = `${quote}${from}${quote}`
			if (!out.includes(exact)) continue
			const parts = out.split(exact)
			hits += parts.length - 1
			out = parts.join(`${quote}${to}${quote}`)
		}
	}
	return { text: out, hits }
}

const ignore = createIgnore()
try { ignore.add(await readFile(join(REPO_ROOT, '.gitignore'), 'utf8')) }
catch { /* */ }
ignore.add('.git')

const SOURCE_SUFFIXES = ['.mjs', '.js', '.ts', '.html', '.ps1']
/** @type {string[]} */
const files = []
/**
 * @param {string} dir
 * @returns {Promise<void>}
 */
async function walk(dir) {
	for (const ent of await readdir(dir, { withFileTypes: true })) {
		const abs = join(dir, ent.name)
		const rel = relative(REPO_ROOT, abs).replaceAll('\\', '/')
		if (ignore.ignores(rel)) continue
		if (ent.isDirectory()) {
			await walk(abs)
			continue
		}
		if (SOURCE_SUFFIXES.some(s => rel.endsWith(s))) files.push(abs)
	}
}
await walk(REPO_ROOT)

let touched = 0
let total = 0
for (const abs of files) {
	const rel = relative(REPO_ROOT, abs).replaceAll('\\', '/')
	if (rel.startsWith('src/public/locales/') || rel.startsWith('src/decl/')) continue
	if (rel.startsWith('src/scripts/checks/tools/')) continue
	const raw = await readFile(abs, 'utf8')
	let text = raw
	let hits = 0
	for (let i = 0; i < 10; i++) {
		const once = rewriteExact(text)
		if (!once.hits) break
		hits += once.hits
		text = once.text
	}
	if (!hits) continue
	await writeFile(abs, text, 'utf8')
	touched++
	total += hits
	console.log(rel, hits)
}
console.log('touched', touched, 'hits', total)
