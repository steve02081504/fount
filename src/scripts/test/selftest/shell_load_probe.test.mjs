/**
 * shellLoadProbe：具名 import / export 解析自测。
 */
/* global Deno */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { assertEquals } from 'jsr:@std/assert'

import {
	collectModuleExports,
	parseBindingNames,
	partPublicBrowserPath,
	probeShellPart,
	resolveBrowserImportSpec,
} from '../shellLoadProbe.mjs'

Deno.test('parseBindingNames distinguishes import source vs export public names', () => {
	assertEquals(parseBindingNames('a, b as c, type D', 'import'), ['a', 'b', 'D'])
	assertEquals(parseBindingNames('a, b as c', 'export'), ['a', 'c'])
})

Deno.test('collectModuleExports follows export-star and local decls', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount-shell-probe-'))
	try {
		const base = path.join(root, 'base.mjs')
		const star = path.join(root, 'star.mjs')
		const ns = path.join(root, 'ns.mjs')
		const remote = path.join(root, 'remote.mjs')
		await writeFile(base, 'export function alpha() {}\nexport const beta = 1\n')
		await writeFile(star, 'export { alpha as gamma } from \'./base.mjs\'\nexport * from \'./base.mjs\'\nexport function delta() {}\n')
		await writeFile(ns, 'export * as bundle from \'./base.mjs\'\n')
		await writeFile(remote, 'export { remoteName as localName } from \'npm:@example/pkg\'\n')
		const names = await collectModuleExports(root, star)
		assertEquals([...names].sort(), ['alpha', 'beta', 'delta', 'gamma'])
		const nsNames = await collectModuleExports(root, ns)
		assertEquals([...nsNames], ['bundle'])
		const remoteNames = await collectModuleExports(root, remote)
		assertEquals([...remoteNames], ['localName'])
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('collectModuleExports reads export const destructuring', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount-shell-probe-destructure-'))
	try {
		const file = path.join(root, 'templates.mjs')
		await writeFile(file, `export const {
	renderTemplate,
	mountTemplate,
	appendTemplate as append,
} = templatesFor('/x')
`)
		const names = await collectModuleExports(root, file)
		assertEquals([...names].sort(), ['append', 'mountTemplate', 'renderTemplate'])
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('part public relative climbs resolve like browser /scripts URLs', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount-shell-probe-url-'))
	try {
		const hub = path.join(root, 'src/public/parts/shells/probe_fixture/public/hub')
		const scripts = path.join(root, 'src/public/pages/scripts/lib')
		await mkdir(hub, { recursive: true })
		await mkdir(scripts, { recursive: true })
		await writeFile(path.join(scripts, 'regex.mjs'), 'export function escapeRegExp(value) { return value }\n')
		const importer = path.join(hub, 'friendsList.mjs')
		await writeFile(importer, 'export const x = 1\n')

		assertEquals(
			partPublicBrowserPath(root, importer),
			'/parts/shells:probe_fixture/hub/friendsList.mjs',
		)
		assertEquals(
			resolveBrowserImportSpec(root, importer, '../../../../scripts/lib/regex.mjs'),
			path.join(scripts, 'regex.mjs'),
		)
		assertEquals(
			resolveBrowserImportSpec(root, importer, '../../../../scripts/regex.mjs'),
			null,
		)
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('probeShellPart reports missing named exports', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount-shell-probe-part-'))
	try {
		const part = path.join(root, 'src/public/parts/shells/probe_fixture')
		const src = path.join(part, 'src')
		const shared = path.join(part, 'public/shared')
		await mkdir(shared, { recursive: true })
		await mkdir(src, { recursive: true })
		await writeFile(path.join(shared, 'api.mjs'), 'export function realName() {}\n')
		await writeFile(
			path.join(src, 'consumer.mjs'),
			'import { missingName } from \'../public/shared/api.mjs\'\nexport const x = missingName\n',
		)

		const { missingNamed, backendMissing } = await probeShellPart({
			repoRoot: root,
			partPath: 'shells/probe_fixture',
			dynamicProbes: [],
		})
		assertEquals(backendMissing, [])
		assertEquals(missingNamed.length, 1)
		assertEquals(missingNamed[0].includes('missingName'), true)
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})
