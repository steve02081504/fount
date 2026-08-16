/**
 * 预加载 URL 静态提取：跳过未插值模板占位。
 */
/* global Deno */
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

Deno.test('extractFromJs picks literal fetch URL', async () => {
	const { extractFromJs } = await import('../../web_server/preload_list.mjs')
	const urls = extractFromJs('await fetch(\'https://api.iconify.design/line-md/play.svg\')')
	assertEquals(urls.map(resource => resource.url), ['https://api.iconify.design/line-md/play.svg'])
})

Deno.test('extractFromJs picks const/let/var single-quoted URL assignments', async () => {
	const { extractFromJs } = await import('../../web_server/preload_list.mjs')
	const urls = extractFromJs(`\
const UPDATE_ICON = 'https://api.iconify.design/mdi/update.svg'
let loading = 'https://api.iconify.design/line-md/loading-twotone-loop.svg'
var skipDouble = "https://example.com/ignored.svg"
const templatey = \`https://example.com/\${id}.svg\`
`)
	assertEquals(urls.map(resource => resource.url), [
		'https://api.iconify.design/mdi/update.svg',
		'https://api.iconify.design/line-md/loading-twotone-loop.svg',
	])
})

Deno.test('extractFromJs does not preload POST APIs or origin roots from const URLs', async () => {
	const { extractFromJs } = await import('../../web_server/preload_list.mjs')
	const urls = extractFromJs(`\
const CATBOX_API_URL = 'https://litterbox.catbox.moe/resources/internals/api.php'
const CATBOX_SERVE_HOST = 'https://litter.catbox.moe'
const base_dir = 'https://steve02081504.github.io/fount'
const DAISY = 'https://cdn.jsdelivr.net/npm/daisyui/daisyui.css'
await fetch('https://api.iconify.design/line-md/play.svg')
`)
	assertEquals(urls.map(resource => resource.url), [
		'https://cdn.jsdelivr.net/npm/daisyui/daisyui.css',
		'https://api.iconify.design/line-md/play.svg',
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
