/**
 * scrollProgress 阅读位置锚点契约：按内容块指纹 + 块内比例采集位置，
 * 布局（宽度）变化后仍能恢复到同一段内容。
 */
import { test, expect } from './fixtures.mjs'

test('restores the anchored block after a width reflow', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { captureScrollPosition, applyScrollPosition } = await import('/scripts/features/scrollProgress.mjs')
		const scrollRoot = document.createElement('div')
		scrollRoot.style.cssText = 'position:fixed;inset:0;width:400px;height:300px;overflow-y:auto'
		const content = document.createElement('div')
		scrollRoot.appendChild(content)
		document.body.appendChild(scrollRoot)
		const blocks = []
		for (let index = 0; index < 40; index++) {
			const paragraph = document.createElement('p')
			paragraph.textContent = `段落 ${index} ` + '这是一段用于测试重排的较长正文内容。'.repeat(6)
			content.appendChild(paragraph)
			blocks.push(paragraph)
		}
		const target = blocks[10]
		scrollRoot.scrollTop = target.offsetTop + target.offsetHeight * 0.5
		const captured = captureScrollPosition({ scrollRoot, contentRoot: content })

		// 改变宽度触发重排后再乱滚，验证按锚点而非像素恢复
		scrollRoot.style.width = '220px'
		void scrollRoot.offsetHeight
		scrollRoot.scrollTop = 0
		const ok = await applyScrollPosition({ scrollRoot, contentRoot: content, record: captured })

		const restored = content.children[captured.anchor.blockIndex]
		const restoredRatio = (scrollRoot.scrollTop - restored.offsetTop) / restored.offsetHeight
		scrollRoot.remove()
		return {
			ok,
			blockIndex: captured.anchor.blockIndex,
			capturedRatio: captured.anchor.offsetRatio,
			restoredRatio,
		}
	})

	expect(result.ok).toBe(true)
	expect(result.blockIndex).toBe(10)
	expect(result.capturedRatio).toBeGreaterThan(0.4)
	expect(result.capturedRatio).toBeLessThan(0.6)
	expect(result.restoredRatio).toBeGreaterThan(0.3)
	expect(result.restoredRatio).toBeLessThan(0.7)
})

test('falls back to the overall ratio when no block matches', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { applyScrollPosition } = await import('/scripts/features/scrollProgress.mjs')
		const scrollRoot = document.createElement('div')
		scrollRoot.style.cssText = 'position:fixed;inset:0;width:400px;height:300px;overflow-y:auto'
		const content = document.createElement('div')
		scrollRoot.appendChild(content)
		document.body.appendChild(scrollRoot)
		for (let index = 0; index < 40; index++) {
			const paragraph = document.createElement('p')
			paragraph.textContent = `段落 ${index} ` + '填充内容。'.repeat(10)
			content.appendChild(paragraph)
		}
		void scrollRoot.offsetHeight
		const record = { anchor: { blockIndex: 999, blockSig: '不存在的块', offsetRatio: 0.5 }, ratio: 1 }
		const ok = await applyScrollPosition({ scrollRoot, contentRoot: content, record })
		const atBottom = scrollRoot.scrollTop >= scrollRoot.scrollHeight - scrollRoot.clientHeight - 4
		scrollRoot.remove()
		return { ok, atBottom }
	})
	expect(result.ok).toBe(true)
	expect(result.atBottom).toBe(true)
})
