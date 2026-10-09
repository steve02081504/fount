/**
 * 预加载 URL 静态提取：跳过未插值模板占位。
 */
/* global Deno */
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { assertEquals } from 'jsr:@std/assert'

const GODBOLT_TEMPLATE = `\
const createGodboltExecutor = (compilerId, lang) => {
	const functionBody = \`\\
const response = await fetch('https://godbolt.org/api/compiler/\${compilerId}/compile', {
	method: 'POST',
})
\`
	return functionBody
}
`

Deno.test('extractFromJs picks literal fetch and import URLs', async () => {
	const { extractFromJs } = await import('../../web_server/preload_list.mjs')
	const extracted = extractFromJs(`\
await fetch('https://cdn.example/data.json')
await import('https://esm.sh/mermaid')
`)
	assertEquals(extracted, [
		{ url: 'https://cdn.example/data.json', type: 'resource' },
		{ url: 'https://esm.sh/mermaid', type: 'mjs' },
	])
})

Deno.test('extractFromJs picks const/let/var single-quoted URL assignments and skips unresolved templates', async () => {
	const { extractFromJs } = await import('../../web_server/preload_list.mjs')
	const urls = extractFromJs(`\
const STYLES = 'https://cdn.jsdelivr.net/npm/daisyui/daisyui.css'
var skipDouble = "https://example.com/ignored.css"
const templatey = \`https://example.com/\${id}.css\`
`)
	assertEquals(urls, [{ url: 'https://cdn.jsdelivr.net/npm/daisyui/daisyui.css', type: 'css' }])
})

Deno.test('extractFromJs does not preload POST APIs, origin roots or image URLs', async () => {
	const { extractFromJs } = await import('../../web_server/preload_list.mjs')
	const extracted = extractFromJs(`\
const CATBOX_API_URL = 'https://litterbox.catbox.moe/resources/internals/api.php'
const CATBOX_SERVE_HOST = 'https://litter.catbox.moe'
const base_dir = 'https://steve02081504.github.io/fount'
const ICON_LOADING = 'https://api.iconify.design/line-md/loading-loop.svg'
await fetch('https://api.iconify.design/line-md/play.svg')
`)
	assertEquals(extracted, [])
})

Deno.test('extractFromJs honors @fetch-resource for non-images and drops its image annotations', async () => {
	const { extractFromJs } = await import('../../web_server/preload_list.mjs')
	const extracted = extractFromJs(`\
// @fetch-resource https://cdn.example/table.json
// @fetch-resource
// https://api.iconify.design/line-md/watch.svg
`)
	assertEquals(extracted, [{ url: 'https://cdn.example/table.json', type: 'resource' }])
})

Deno.test('extractFromHtml drops img tags but keeps scripts by module-ness and other media', async () => {
	const { extractFromHtml } = await import('../../web_server/preload_list.mjs')
	const extracted = extractFromHtml(`\
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<script type="module" src="https://esm.sh/foo"></script>
<img src="https://api.iconify.design/mdi/menu.svg" class="text-icon" />
<source src="https://cdn.example/poster.png" />
<video src="https://example.com/clip.mp4"></video>
`)
	assertEquals(extracted, [
		{ url: 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4', type: 'js' },
		{ url: 'https://esm.sh/foo', type: 'mjs' },
		{ url: 'https://example.com/clip.mp4', type: 'resource' },
	])
})

Deno.test('mergeAndDedupe keeps code, style and fetch resources and dedupes by url', async () => {
	const { mergeAndDedupe } = await import('../../web_server/preload_list.mjs')
	const merged = mergeAndDedupe([[
		{ url: 'https://esm.sh/mermaid', type: 'mjs' },
		{ url: 'https://cdn.jsdelivr.net/npm/daisyui/daisyui.css', type: 'css' },
		{ url: 'https://cdn.jsdelivr.net/npm/unicode-emoji-json/data-by-group.json', type: 'resource' },
	]])
	assertEquals(merged.map(resource => resource.url), [
		'https://esm.sh/mermaid',
		'https://cdn.jsdelivr.net/npm/daisyui/daisyui.css',
		'https://cdn.jsdelivr.net/npm/unicode-emoji-json/data-by-group.json',
	])
})

Deno.test('mergeAndDedupe drops unresolved ${…} preload URLs (godbolt executor body)', async () => {
	const { extractFromJs, isConcreteExternalUrl, mergeAndDedupe } = await import('../../web_server/preload_list.mjs')
	const extracted = extractFromJs(GODBOLT_TEMPLATE)
	assertEquals(
		extracted.some(resource => resource.url.includes('${')),
		true,
		'fixture must still surface the unresolved URL at extract time',
	)
	const merged = mergeAndDedupe([extracted])
	assertEquals(
		merged.filter(resource => resource.url.includes('godbolt.org') || resource.url.includes('${')),
		[],
	)
	assertEquals(isConcreteExternalUrl('https://godbolt.org/api/compiler/${compilerId}/compile'), false)
})

Deno.test('collectPublicDirs follows symlinked/junction part dirs', async () => {
	const { collectPublicDirs } = await import('../../web_server/preload_list.mjs')
	const isWin = process.platform === 'win32'
	const root = await mkdtemp(path.join(tmpdir(), 'fount_preload_'))
	try {
		const realPart = path.join(root, 'real-part')
		await mkdir(path.join(realPart, 'public'), { recursive: true })
		const mount = path.join(root, 'mount')
		await mkdir(mount, { recursive: true })
		const alias = path.join(mount, 'mounted-part')
		if (isWin) await symlink(realPart, alias, 'junction')
		else await symlink(realPart, alias)

		assertEquals(collectPublicDirs(mount), [path.join(alias, 'public')])
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})
