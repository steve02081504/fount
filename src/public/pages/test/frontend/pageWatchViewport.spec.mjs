/**
 * 页面 watch `[test:viewport]` / `[test:flicker]` 的前端实跑自测：
 * - viewport：声明 `data-app-shell` 的满屏布局 + 仿扩展浮层探针 → 略超一屏须命中；body `overflow: clip` 与真长页面不得误报。
 * - flicker：跨帧反复显隐须命中；单次切换不报。
 *
 * modulePage 不挂 page-watch，检测函数在这里单独装载，互不干扰。
 * modulePage.run 的函数会 toString 序列化，不能引用 Node 侧闭包。
 */
import { expect, test } from './fixtures.mjs'

test.describe('page watch viewport overflow', () => {
	test('flags a full-viewport shell pushed past the viewport by an extension-like overlay', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			const mod = await import('/scripts/test/watch/viewport.mjs')
			const saved = document.body.getAttribute('style')
			const hadShellAttr = document.body.hasAttribute(mod.APP_SHELL_ATTRIBUTE)
			document.body.setAttribute(mod.APP_SHELL_ATTRIBUTE, '')
			const shell = document.createElement('div')
			shell.style.height = '100dvh'
			document.body.style.margin = '0'
			document.body.prepend(shell)
			mod.ensureExtensionProbe()
			const probe = document.body.querySelector(`[${mod.EXTENSION_PROBE_ATTRIBUTE}]`)
			try {
				const unclipped = mod.measurePageOverflow().overflow
				const culprits = mod.findOverflowCulprits(document.scrollingElement.clientHeight).map(hit => hit.where)
				document.body.style.overflow = 'clip'
				const clipped = mod.measurePageOverflow().overflow
				document.body.style.overflow = ''
				shell.style.height = '300dvh'
				const longPage = mod.measurePageOverflow().overflow
				return { unclipped, clipped, longPage, culprits, probeIsLast: document.body.lastElementChild === probe }
			}
			finally {
				shell.remove()
				probe?.remove()
				if (!hadShellAttr) document.body.removeAttribute(mod.APP_SHELL_ATTRIBUTE)
				if (saved === null) document.body.removeAttribute('style')
				else document.body.setAttribute('style', saved)
			}
		})
		expect(result.probeIsLast).toBe(true)
		expect(result.unclipped).toBeGreaterThan(0)
		expect(result.culprits.join(' ')).toContain('div')
		expect(result.clipped).toBe(0)
		expect(result.longPage).toBe(0)
	})
})

test.describe('page watch flicker', () => {
	test('reports repeated cross-frame visibility flips but not a single toggle', async ({ modulePage }) => {
		const lines = await modulePage.run(async () => {
			const { installFlickerWatch } = await import('/scripts/test/watch/flicker.mjs')
			const logged = []
			const original = console.error
			/**
			 * 记录 console.error 参数。
			 * @param {...unknown} args 日志参数
			 * @returns {void}
			 */
			function record(...args) { logged.push(args.map(String).join(' ')) }
			console.error = record
			/** @returns {Promise<void>} 等两帧 */
			const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
			/**
			 * 建一个可见小方块。
			 * @param {string} id 元素 id
			 * @returns {HTMLElement} 元素
			 */
			const make = id => {
				const element = document.createElement('div')
				element.id = id
				element.textContent = id
				element.style.cssText = 'width: 40px; height: 20px'
				document.body.appendChild(element)
				return element
			}
			installFlickerWatch()
			const blinking = make('blinking')
			const steady = make('steady')
			try {
				await frames()
				for (let index = 0; index < 8; index++) {
					blinking.hidden = !blinking.hidden
					await frames()
				}
				steady.hidden = true
				await frames()
			}
			finally {
				console.error = original
				blinking.remove()
				steady.remove()
			}
			return logged
		})
		expect(lines.some(line => line.includes('visibility-flicker') && line.includes('#blinking')), JSON.stringify(lines)).toBe(true)
		expect(lines.some(line => line.includes('#steady'))).toBe(false)
	})
})
