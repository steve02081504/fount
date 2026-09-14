/**
 * 页面 watch `[test:layout]` 的几何检测（前端实跑）：
 * CSS `columns` 容器内，普通分块子元素被拆到多列时 `getClientRects()` 返回多段，
 * `collectFragmentedBlocks` 必须命中并上报；`break-inside: avoid` 与普通单列布局不得误报。
 *
 * 浏览器模块必须在浏览器里测（后端 Deno 测试的 no_dom_shim 预载会拒绝 DOM 全局），
 * 经 modulePage 在真实页面里 evaluate 检测函数，断言回 Node 侧。
 * modulePage.run 的函数会 toString 序列化，不能引用 Node 侧闭包，DOM 样例须内联。
 */
import { expect, test } from './fixtures.mjs'

test.describe('page watch layout fragmentation', () => {
	test('flags a block fragmented across CSS columns and ignores safe layouts', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			const { collectFragmentedBlocks } = await import('/scripts/test/watch/layout.mjs')
			const host = document.createElement('div')
			host.style.position = 'absolute'
			host.style.top = '0'
			host.style.left = '-10000px'
			host.style.width = '240px'
			host.innerHTML = `
				<div id="multi" style="columns: 2; column-gap: 8px">
					<div id="frag" style="height: 400px; background: #f00">frag</div>
					<div id="safe" style="height: 60px; break-inside: avoid; background: #00f">safe</div>
				</div>
				<div id="single"><div id="normal" style="height: 400px; background: #0f0">normal</div></div>
			`
			document.body.appendChild(host)
			try {
				return collectFragmentedBlocks(host).map(hit => ({ id: hit.child.id, fragments: hit.fragments }))
			}
			finally {
				host.remove()
			}
		})
		const fragmented = result.find(hit => hit.id === 'frag')
		expect(fragmented, JSON.stringify(result)).toBeTruthy()
		expect(fragmented.fragments).toBeGreaterThan(1)
		expect(result.some(hit => hit.id === 'safe')).toBe(false)
		expect(result.some(hit => hit.id === 'normal')).toBe(false)
	})

	test('layout watch task reports a fragmented block through the reporter', async ({ modulePage }) => {
		const lines = await modulePage.run(async () => {
			const mod = await import('/scripts/test/watch/layout.mjs')
			const host = document.createElement('div')
			host.style.position = 'absolute'
			host.style.top = '0'
			host.style.left = '-10000px'
			host.style.width = '240px'
			host.innerHTML = `
				<div id="multi" style="columns: 2; column-gap: 8px">
					<div id="frag" style="height: 400px; background: #f00">frag</div>
					<div id="safe" style="height: 60px; break-inside: avoid; background: #00f">safe</div>
				</div>
			`
			document.body.appendChild(host)
			const logged = []
			const original = console.error
			/**
			 * 记录 console.error 参数。
			 * @param {...unknown} args 日志参数
			 * @returns {void}
			 */
			function record(...args) { logged.push(args.map(String).join(' ')) }
			console.error = record
			try {
				mod.markDirty()
				mod.task.run({ draining: false })
			}
			finally {
				console.error = original
				host.remove()
			}
			return logged
		})
		expect(lines.some(line => line.includes('frag'))).toBe(true)
		expect(lines.some(line => line.includes('safe'))).toBe(false)
	})
})
