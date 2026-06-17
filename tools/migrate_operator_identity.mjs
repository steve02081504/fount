/**
 * Migrate resolveOperatorEntityHash imports to p2p_server/operator_identity (async).
 */
import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts'

const ROOT = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

/** @type {string[]} */
const changed = []

for await (const entry of walk(ROOT, { exts: ['.mjs'], skip: [/node_modules/] })) {
	let content = await Deno.readTextFile(entry.path)
	const original = content
	if (!content.includes('resolveOperatorEntityHash') && !content.includes('getOperatorEntityHash'))
		continue
	if (entry.path.includes('operator_identity.mjs') || entry.path.includes('http_glue.mjs'))
		continue
	if (entry.path.includes('chat/lib/replica.mjs'))
		continue

	// Skip entity/replica.mjs itself
	if (entry.path.endsWith('entity/replica.mjs') || entry.path.endsWith('entity\\replica.mjs'))
		continue

	content = content.replace(
		/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*entity\/replica\.mjs['"]/g,
		(match, imports) => {
			const names = imports.split(',').map(s => s.trim()).filter(Boolean)
			const opNames = names.filter(n =>
				/resolveOperatorEntityHash|getOperatorEntityHash|getLocalNodeHash/.test(n))
			const rest = names.filter(n =>
				!/resolveOperatorEntityHash|getOperatorEntityHash|getLocalNodeHash|getReplicaFromReq/.test(n))
			let out = ''
			if (opNames.length) {
				const opImports = opNames
					.map(n => n.replace('resolveOperatorEntityHash', 'resolveOperatorEntityHashForUser')
						.replace('getOperatorEntityHash', 'getOperatorEntityHash'))
					.join(', ')
				const depth = (match.match(/\.\.\//g) || []).length
				const prefix = '../'.repeat(Math.max(4, depth))
				out += `import { ${opImports} } from '${prefix}server/p2p_server/operator_identity.mjs'\n`
			}
			if (rest.length)
				out += `import { ${rest.join(', ')} } from '${match.match(/from\s*['"]([^'"]+)['"]/)?.[1] || ''}'\n`
			return out.trimEnd()
		},
	)

	content = content.replace(
		/\bresolveOperatorEntityHash\(/g,
		'await resolveOperatorEntityHashForUser(',
	)

	// getOperatorEntityHash is async now
	content = content.replace(
		/\bgetOperatorEntityHash\(/g,
		'await getOperatorEntityHash(',
	)

	// getLocalNodeHash from replica -> getNodeHash
	content = content.replace(
		/import\s*\{[^}]*getLocalNodeHash[^}]*\}\s*from\s*['"][^'"]*entity\/replica\.mjs['"]\s*\n?/g,
		'',
	)
	content = content.replace(
		/\bgetLocalNodeHash\(\s*[^)]*\)/g,
		'getNodeHash()',
	)

	if (content.includes('getNodeHash()') && !content.includes("from '") && !content.includes('node_context'))
		/* noop */

	if (content !== original) {
		// Add getNodeHash import if needed
		if (content.includes('getNodeHash()') && !/from ['"][^'"]*node_context/.test(content)) {
			const rel = entry.path.replace(/\\/g, '/')
			const depth = rel.split('/src/')[1]?.split('/').length - 1 || 4
			const prefix = '../'.repeat(depth)
			content = `import { getNodeHash } from '${prefix}scripts/p2p/node_context.mjs'\n` + content
		}
		await Deno.writeTextFile(entry.path, content)
		changed.push(entry.path.replace(ROOT.replace(/\\/g, '/'), 'src/'))
	}
}

console.log(`Changed ${changed.length} files`)
for (const f of changed.sort()) console.log(f)
