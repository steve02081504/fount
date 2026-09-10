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
