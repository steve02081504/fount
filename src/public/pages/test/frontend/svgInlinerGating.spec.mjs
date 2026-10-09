/**
 * svgInliner 可见性门控契约：只有视口内（含 `INLINE_ROOT_MARGIN` 提前量）的 `.svg` 图标才立刻取文本，
 * 屏幕外的先挂到 IntersectionObserver 上——否则一页几十个图标会同时打向图标 CDN（会被限流回 429）。
 */
import { test, expect } from './fixtures.mjs'

/** 路由满足的假图标内容：`currentColor` 填充，内联后才有意义。 */
const ICON_BODY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>'

/**
 * 满足本用例的两个假图标请求。
 * @param {import('npm:@playwright/test').Page} page 页面
 * @returns {Promise<void>} 路由挂载完成
 */
async function routeTestIcons(page) {
	await page.route(
		/**
		 * 只拦本用例的两个假图标。
		 * @param {URL} url 请求地址
		 * @returns {boolean} 是否拦截
		 */
		url => url.pathname.startsWith('/__fount_svg_inliner_') && url.pathname.endsWith('.svg'),
		/**
		 * 用假 SVG 满足请求。
		 * @param {import('npm:@playwright/test').Route} route 被拦截的请求
		 * @returns {Promise<void>} 满足完成
		 */
		route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: ICON_BODY }),
	)
}

test('offscreen icons are not fetched until they enter the viewport', async ({ page, modulePage }) => {
	await routeTestIcons(page)

	const result = await modulePage.run(async () => {
		const { svgInliner } = await import('/scripts/lib/svgInliner.mjs')
		// 记录 svgInliner 自己发的取文本请求（`<img>` 自身的加载不走 fetch，不计入）。
		const iconFetches = []
		const originalFetch = window.fetch
		/**
		 * 劫持 fetch 以记录取文本请求。
		 * @param {RequestInfo | URL} input 请求地址
		 * @param {RequestInit} [init] 请求参数
		 * @returns {Promise<Response>} 原始响应
		 */
		window.fetch = (input, init) => {
			const pathname = new URL(String(input), location.href).pathname
			if (pathname.includes('__fount_svg_inliner_')) iconFetches.push(pathname)
			return originalFetch(input, init)
		}
		const container = document.createElement('div')
		const visible = document.createElement('img')
		visible.src = '/__fount_svg_inliner_visible.svg'
		const spacer = document.createElement('div')
		spacer.style.height = '3000px'
		const offscreen = document.createElement('img')
		offscreen.src = '/__fount_svg_inliner_offscreen.svg'
		container.append(visible, spacer, offscreen)
		document.body.append(container)
		const offscreenSelector = 'img[src$="__fount_svg_inliner_offscreen.svg"]'
		const startRects = {
			visibleY: visible.getBoundingClientRect().y,
			offscreenY: offscreen.getBoundingClientRect().y,
		}
		try {
			await svgInliner(container)
			const firstPass = {
				fetched: [...iconFetches],
				inlineSvgs: container.querySelectorAll('svg').length,
				offscreenStillImage: !!container.querySelector(offscreenSelector),
			}
			// 把屏幕外的图标挪到视口内（等价于用户滚动到它），观察者此时才该取文本。
			container.prepend(offscreen)
			const deadline = Date.now() + 5000
			while (container.querySelector(offscreenSelector) && Date.now() < deadline)
				await new Promise(resolve => setTimeout(resolve, 50))
			return {
				firstPass,
				startRects,
				afterEnterViewport: {
					fetched: [...iconFetches],
					inlineSvgs: container.querySelectorAll('svg').length,
					offscreenStillImage: !!container.querySelector(offscreenSelector),
				},
			}
		}
		finally {
			window.fetch = originalFetch
			container.remove()
		}
	})

	// 前置条件：一个图标在视口内，另一个确实在视口外。
	expect(result.startRects.visibleY).toBeLessThan(720)
	expect(result.startRects.offscreenY).toBeGreaterThan(720)
	// 首轮只取视口内那个；屏幕外的仍是 `<img>`，文本还没取。
	expect(result.firstPass.fetched).toEqual(['/__fount_svg_inliner_visible.svg'])
	expect(result.firstPass.inlineSvgs).toBe(1)
	expect(result.firstPass.offscreenStillImage).toBe(true)
	// 进入视口后才取文本并内联。
	expect(result.afterEnterViewport.fetched).toEqual([
		'/__fount_svg_inliner_visible.svg',
		'/__fount_svg_inliner_offscreen.svg',
	])
	expect(result.afterEnterViewport.inlineSvgs).toBe(2)
	expect(result.afterEnterViewport.offscreenStillImage).toBe(false)
})

test('an already-fetched icon is inlined even when it sits offscreen', async ({ page, modulePage }) => {
	await routeTestIcons(page)

	const result = await modulePage.run(async () => {
		const { svgInliner } = await import('/scripts/lib/svgInliner.mjs')
		const container = document.createElement('div')
		const spacer = document.createElement('div')
		spacer.style.height = '3000px'
		const first = document.createElement('img')
		first.src = '/__fount_svg_inliner_warmup.svg'
		const offscreen = document.createElement('img')
		offscreen.src = '/__fount_svg_inliner_warmup.svg'
		container.append(first, spacer, offscreen)
		document.body.append(container)
		try {
			// 同一 URL 的文本在内联第一个时已进模块缓存，屏幕外的那个应直接内联，不再等观察者。
			await svgInliner(container)
			return {
				inlineSvgs: container.querySelectorAll('svg').length,
				remainingImages: container.querySelectorAll('img').length,
			}
		}
		finally {
			container.remove()
		}
	})

	expect(result.inlineSvgs).toBe(2)
	expect(result.remainingImages).toBe(0)
})
