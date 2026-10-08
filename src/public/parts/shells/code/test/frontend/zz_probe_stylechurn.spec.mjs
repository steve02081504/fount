/**
 * 临时探针：找出持续写 DOM 内联样式的元凶（属性名 + 元素 + 调用栈聚合）。
 */
import { test } from './fixtures.mjs'
import { openCode } from './helpers.mjs'

test('probe: who writes inline style continuously', async ({ page, baseUrl }) => {
	await openCode(page, baseUrl)
	await page.waitForTimeout(1500)
	await page.evaluate(() => {
		const stacks = new Map()
		const byAttribute = new Map()
		let total = 0
		const describe = el => {
			if (!el || el.nodeType !== 1) return String(el)
			const cls = el.getAttribute?.('class')
			return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${String(cls).trim().split(/\s+/).slice(0, 3).join('.')}` : ''}>`
		}
		const bump = (map, key, element) => {
			const existing = map.get(key)
			if (existing) existing.count += 1
			else map.set(key, { count: 1, element: describe(element) })
		}
		const observer = new MutationObserver(mutations => {
			for (const mutation of mutations) {
				total += 1
				bump(byAttribute, mutation.attributeName ?? `<${mutation.type}>`, mutation.target)
				if (mutation.attributeName !== 'style') continue
				const stack = new Error().stack.split('\n').slice(2, 5).map(line => line.trim().replace(/^at /, '')).join(' | ')
				bump(stacks, `${describe(mutation.target)}\t${stack}`, mutation.target)
			}
		})
		observer.observe(document.documentElement, { attributes: true, subtree: true, childList: true, characterData: true })
		globalThis.__probeDump = () => {
			observer.disconnect()
			const top = map => [...map.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.count - a.count).slice(0, 8)
			return { total, attributes: top(byAttribute), stacks: top(stacks) }
		}
	})
	await page.waitForTimeout(4000)
	const dump = await page.evaluate(() => globalThis.__probeDump())
	console.log(`[probe] total mutations: ${dump.total} in 4000ms`)
	for (const row of dump.attributes)
		console.log(`[probe] attr ${row.count}\t${row.element}\t${row.key}`)
	for (const row of dump.stacks)
		console.log(`[probe] style ${row.count}\t${row.key}`)
})
