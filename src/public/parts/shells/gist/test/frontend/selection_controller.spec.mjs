/**
 * 通用选择控制器（前端实跑）：普通点击 / Ctrl 切换 / Shift 范围 / 全选 / 模式 / 剔除不可见。
 * 控制器零 DOM 依赖，但作为浏览器共享组件经 modulePage 在真实页面里求值。
 */
import { test, expect } from './fixtures.mjs'

test.describe('selection controller', () => {
	test('toggle click, modifier toggle and additive shift range', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			const { createSelectionController } = await import('/scripts/components/selectionController.mjs')
			const ids = ['a', 'b', 'c', 'd']
			const controller = createSelectionController({
				/**
				 * @returns {string[]} 可见 id 顺序
				 */
				getOrderedIds: () => ids,
				plainClick: 'toggle',
				shiftRange: 'add',
			})
			controller.handleClick('a')
			const afterPlain = { mode: controller.getMode(), selected: controller.getSelected() }
			controller.handleClick('c', { ctrl: true })
			const afterCtrl = controller.getSelected()
			controller.clear()
			controller.handleClick('a')
			controller.handleClick('c', { shift: true })
			const afterShift = controller.getSelected()
			controller.selectAll(true)
			const all = controller.getSelected()
			controller.setMode(false)
			const cleared = { mode: controller.getMode(), selected: controller.getSelected() }
			return { afterPlain, afterCtrl, afterShift, all, cleared }
		})
		expect(result.afterPlain).toEqual({ mode: true, selected: ['a'] })
		expect([...result.afterCtrl].sort()).toEqual(['a', 'c'])
		expect([...result.afterShift].sort()).toEqual(['a', 'b', 'c'])
		expect(result.all).toEqual(['a', 'b', 'c', 'd'])
		expect(result.cleared).toEqual({ mode: false, selected: [] })
	})

	test('interval range keeps only endpoints, middle deselect splits into two', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			const { createSelectionController } = await import('/scripts/components/selectionController.mjs')
			const ids = Array.from({ length: 10_000 }, (_, i) => `id-${i}`)
			const controller = createSelectionController({
				/**
				 * @returns {string[]} 有序 id
				 */
				getOrderedIds: () => ids,
			})
			controller.setRangeFromAnchor('id-100', 'id-9000')
			const count = controller.getCount()
			const segmentsBefore = controller.getSegments().length
			controller.setItemSelected('id-4500', false)
			const countAfter = controller.getCount()
			const segmentsAfter = controller.getSegments().length
			const view = controller.getSelectedView()
			return {
				count,
				segmentsBefore,
				countAfter,
				segmentsAfter,
				removed: controller.isSelected('id-4500'),
				edge: controller.isSelected('id-100'),
				viewSize: view.size,
				viewHas: view.has('id-5000'),
				selectedLength: controller.getSelected().length,
			}
		})
		expect(result.count).toBe(8901)
		expect(result.segmentsBefore).toBe(1)
		expect(result.countAfter).toBe(8900)
		expect(result.segmentsAfter).toBe(2)
		expect(result.removed).toBe(false)
		expect(result.edge).toBe(true)
		expect(result.viewSize).toBe(8900)
		expect(result.viewHas).toBe(true)
		expect(result.selectedLength).toBe(8900)
	})

	test('interval selection re-anchors across prepend and additive range', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			const { createSelectionController } = await import('/scripts/components/selectionController.mjs')
			let ids = ['a', 'b', 'c', 'd']
			const controller = createSelectionController({
				/**
				 * @returns {string[]} 有序 id
				 */
				getOrderedIds: () => ids,
				shiftRange: 'add',
			})
			controller.setRangeFromAnchor('b', 'c')
			ids = ['x', 'y', 'a', 'b', 'c', 'd']
			const afterPrepend = controller.getSelected().sort()
			controller.handleClick('b')
			controller.handleClick('d', { shift: true })
			const afterShift = controller.getSelected().sort()
			return { afterPrepend, afterShift }
		})
		expect(result.afterPrepend).toEqual(['b', 'c'])
		expect(result.afterShift).toEqual(['b', 'c', 'd'])
	})

	test('native selection across two items upgrades to item selection', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			const { bindSelectionUpgrade, createSelectionController } = await import('/scripts/components/selectionController.mjs')
			const container = document.createElement('div')
			container.style.cssText = 'position:fixed;top:0;left:0;width:200px'
			container.innerHTML = '<div data-id="a">alpha text</div><div data-id="b">beta text</div>'
			document.body.appendChild(container)
			const ids = ['a', 'b']
			const controller = createSelectionController({
				/**
				 * @returns {string[]} 有序 id
				 */
				getOrderedIds: () => ids,
			})
			const unbind = bindSelectionUpgrade(container, {
				itemSelector: '[data-id]',
				/**
				 * @param {HTMLElement} element 项元素
				 * @returns {string} 项 id
				 */
				getId: element => element.dataset.id,
				controller,
			})
			const range = document.createRange()
			range.setStart(container.children[0].firstChild, 0)
			range.setEnd(container.children[1].firstChild, 4)
			const selection = window.getSelection()
			selection.removeAllRanges()
			selection.addRange(range)
			document.dispatchEvent(new Event('selectionchange'))
			const selected = controller.getSelected().sort()
			const mode = controller.getMode()
			unbind()
			container.remove()
			return { selected, mode }
		})
		expect(result.selected).toEqual(['a', 'b'])
		expect(result.mode).toBe(true)
	})

	test('single click policy and reconcile drops hidden ids', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			const { createSelectionController } = await import('/scripts/components/selectionController.mjs')
			let ids = ['a', 'b', 'c']
			const controller = createSelectionController({
				/**
				 * @returns {string[]} 可见 id 顺序
				 */
				getOrderedIds: () => ids,
				plainClick: 'single',
				shiftRange: 'replace',
			})
			controller.handleClick('b')
			const single = controller.getSelected()
			controller.handleClick('a')
			controller.handleClick('c', { shift: true })
			const shiftReplace = controller.getSelected()
			ids = ['c']
			controller.reconcile(ids)
			const reconciled = controller.getSelected()
			controller.setItemSelected('c', false)
			const afterUncheck = controller.getSelected()
			return { single, shiftReplace, reconciled, afterUncheck }
		})
		expect(result.single).toEqual(['b'])
		expect([...result.shiftReplace].sort()).toEqual(['a', 'b', 'c'])
		expect(result.reconciled).toEqual(['c'])
		expect(result.afterUncheck).toEqual([])
	})
})
