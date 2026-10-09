/**
 * 图片 CORS 探测工具测试：按 hostname 缓存、并发去重、真实结论回填、标签生成。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	applyCorsAttribute,
	corsifyHtml,
	corsifyImages,
	createCorsSupportProbe,
	KNOWN_CORS_HOSTS,
} from '../../scripts/lib/corsImage.mjs'

/**
 * 构造可控的探测器。
 * @param {(url: string) => Promise<object>} fetchImpl - 伪造的 fetch
 * @param {object} [options] - 覆盖选项
 * @returns {{ probe: object, calls: string[] }} 探测器与调用记录
 */
function createHarness(fetchImpl, options = {}) {
	const calls = []
	const probe = createCorsSupportProbe({
		/**
		 * 记录调用并交给伪造实现。
		 * @param {string} url - 请求地址
		 * @param {object} init - 请求参数
		 * @returns {Promise<object>} 模拟响应
		 */
		fetchImpl: (url, init) => { calls.push(url); return fetchImpl(url, init) },
		...options,
	})
	return { probe, calls }
}

Deno.test('known hosts answer synchronously without any request', async () => {
	const { probe, calls } = createHarness(async () => ({ ok: true }))
	assertEquals(KNOWN_CORS_HOSTS.includes('api.iconify.design'), true)
	assertEquals(probe.knownVerdictFor('https://api.iconify.design/mdi/home.svg'), true)
	assertEquals(await probe.verdictFor('https://api.iconify.design/mdi/home.svg'), true)
	assertEquals(calls, [])
})

Deno.test('an unknown host is probed once and the verdict is cached per hostname', async () => {
	const { probe, calls } = createHarness(async () => ({ ok: true }))
	assertEquals(probe.knownVerdictFor('https://cdn.example/a.svg'), undefined)
	assertEquals(await probe.verdictFor('https://cdn.example/a.svg'), true)
	assertEquals(await probe.verdictFor('https://cdn.example/b.svg'), true)
	assertEquals(calls, ['https://cdn.example/a.svg'])
})

Deno.test('a failing probe is cached as unsupported and reused', async () => {
	const { probe, calls } = createHarness(async () => { throw new Error('blocked by CORS') })
	assertEquals(await probe.verdictFor('https://no-cors.example/a.png'), false)
	assertEquals(probe.knownVerdictFor('https://no-cors.example/b.png'), false)
	assertEquals(await probe.verdictFor('https://no-cors.example/b.png'), false)
	assertEquals(calls.length, 1)
})

Deno.test('concurrent verdicts for one hostname share a single probe', async () => {
	let resolveProbe
	const { probe, calls } = createHarness(() => new Promise(resolve => { resolveProbe = resolve }))
	const pending = [probe.verdictFor('https://slow.example/a.svg'), probe.verdictFor('https://slow.example/b.svg')]
	assertEquals(calls.length, 1)
	resolveProbe({ ok: true })
	assertEquals(await Promise.all(pending), [true, true])
	assertEquals(calls.length, 1)
})

Deno.test('a recorded verdict from a real request skips the probe', async () => {
	const { probe, calls } = createHarness(async () => ({ ok: true }))
	probe.recordVerdict('https://real.example/a.svg', true)
	assertEquals(probe.knownVerdictFor('https://real.example/b.svg'), true)
	assertEquals(await probe.verdictFor('https://real.example/b.svg'), true)
	assertEquals(calls, [])
	probe.recordVerdict('https://real.example/a.svg', false)
	assertEquals(probe.knownVerdictFor('https://real.example/c.svg'), false)
})

Deno.test('clear resets unknown hosts but keeps the known list', () => {
	const { probe } = createHarness(async () => ({ ok: true }))
	probe.recordVerdict('https://cdn.example/a.svg', true)
	probe.clear()
	assertEquals(probe.knownVerdictFor('https://cdn.example/a.svg'), undefined)
	assertEquals(probe.knownVerdictFor('https://api.iconify.design/a.svg'), true)
})

Deno.test('an unparsable url is treated as unsupported', async () => {
	const { probe, calls } = createHarness(async () => ({ ok: true }))
	assertEquals(await probe.verdictFor('https://'), false)
	assertEquals(probe.knownVerdictFor('https://'), undefined)
	assertEquals(calls.length, 0)
})

Deno.test('supportsCorsSync answers known hosts and warms the cache for unknown ones', async () => {
	const { probe, calls } = createHarness(async () => ({ ok: true }))
	assertEquals(probe.supportsCorsSync('https://api.iconify.design/mdi/home.svg'), true)
	assertEquals(probe.supportsCorsSync('https://cdn.example/a.svg'), false)
	assertEquals(calls, ['https://cdn.example/a.svg'])
	assertEquals(await probe.verdictFor('https://cdn.example/a.svg'), true)
	assertEquals(probe.supportsCorsSync('https://cdn.example/b.svg'), true)
	assertEquals(calls.length, 1)
})

Deno.test('same-origin images are neither attributed nor probed', () => {
	const { probe, calls } = createHarness(async () => ({ ok: true }), { origin: 'https://app.example' })
	assertEquals(probe.supportsCorsSync('https://app.example/api/parts/avatar'), false)
	assertEquals(probe.supportsCorsSync('https://other.example/a.svg'), false)
	assertEquals(calls, ['https://other.example/a.svg'])
})

/**
 * 构造一个假图片元素。
 * @param {string} src - 初始 src
 * @returns {object} 带有 crossOrigin / getAttribute / removeAttribute 的假元素
 */
function fakeImage(src) {
	return {
		crossOrigin: null,
		/**
		 * 取属性值（只认 src）。
		 * @param {string} name - 属性名
		 * @returns {string | null} 属性值
		 */
		getAttribute(name) { return name === 'src' ? src : null },
		/**
		 * 移除属性（只认 crossorigin）。
		 * @param {string} name - 属性名
		 * @returns {void} 无返回值
		 */
		removeAttribute(name) { if (name === 'crossorigin') this.crossOrigin = null },
	}
}

Deno.test('applyCorsAttribute sets the attribute for a supported host and clears it otherwise', () => {
	const { probe } = createHarness(async () => ({ ok: true }))
	const image = fakeImage('https://api.iconify.design/mdi/home.svg')
	assertEquals(applyCorsAttribute(image, image.getAttribute('src'), probe).crossOrigin, 'anonymous')
	image.crossOrigin = 'anonymous'
	applyCorsAttribute(image, 'https://cdn.example/a.svg', probe)
	assertEquals(image.crossOrigin, null)
})

Deno.test('corsifyImages only touches images whose host supports CORS', () => {
	const { probe } = createHarness(async () => ({ ok: true }))
	const supported = fakeImage('https://api.iconify.design/mdi/home.svg')
	const plain = fakeImage('https://cdn.example/a.png')
	const root = {
		/**
		 * 返回两个假图片。
		 * @returns {object[]} 图片列表
		 */
		querySelectorAll: () => [supported, plain],
	}
	assertEquals(corsifyImages(root, probe), root)
	assertEquals(supported.crossOrigin, 'anonymous')
	assertEquals(plain.crossOrigin, null)
})

Deno.test('corsifyHtml adds the attribute before the tag is parsed, leaving other markup intact', () => {
	const { probe } = createHarness(async () => ({ ok: true }))
	const html = '<div class="a">\n\t<img src="https://api.iconify.design/mdi/home.svg" alt="">\n\t<img src="https://cdn.example/a.png">\n\t<img crossorigin="anonymous" src="https://api.iconify.design/mdi/home.svg">\n</div>'
	const corsified = corsifyHtml(html, probe)
	assertEquals(corsified, '<div class="a">\n\t<img crossorigin="anonymous" src="https://api.iconify.design/mdi/home.svg" alt="">\n\t<img src="https://cdn.example/a.png">\n\t<img crossorigin="anonymous" src="https://api.iconify.design/mdi/home.svg">\n</div>')
	assertEquals(corsifyHtml('no images here', probe), 'no images here')
	assertEquals(corsifyHtml('<img>', probe), '<img>')
})
