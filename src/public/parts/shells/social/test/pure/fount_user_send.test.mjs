/**
 * fount.user.send 触发帖定位。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { resolveTriggerPost } from '../../public/shared/fountUserSend.mjs'

/**
 * 仅命中 `.post-card` 的 closest 假元素。
 * @param {object} card 卡片假元素
 * @returns {object} 假按钮元素
 */
function cardButton(card) {
	/**
	 * @param {string} selector 选择器
	 * @returns {object | null} 匹配元素
	 */
	const closest = selector => selector === '.post-card' ? card : null
	return { closest }
}

/**
 * 仅命中 `[data-replies-for]` 的 closest 假元素。
 * @param {object} panel 回复面板假元素
 * @returns {object} 假回复行元素
 */
function panelRow(panel) {
	/**
	 * @param {string} selector 选择器
	 * @returns {object | null} 匹配元素
	 */
	const closest = selector => selector === '[data-replies-for]' ? panel : null
	return { closest }
}

/**
 * 从不命中的 closest 假元素。
 * @returns {object} 假孤立元素
 */
function orphanElement() {
	/**
	 * @returns {null} 无匹配
	 */
	const closest = () => null
	return { closest }
}

/**
 * 命中残缺卡片的 closest 假元素。
 * @returns {object} 假残缺卡片元素
 */
function badCardElement() {
	/**
	 * @returns {object} 残缺卡片
	 */
	const closest = () => ({ dataset: { authorEntity: '', postId: 'p3' } })
	return { closest }
}

Deno.test('resolveTriggerPost locates the enclosing post card', () => {
	const card = { dataset: { authorEntity: 'a'.repeat(128), postId: 'p1' } }
	assertEquals(resolveTriggerPost(cardButton(card)), { entityHash: card.dataset.authorEntity, postId: 'p1' })
})

Deno.test('resolveTriggerPost falls back to the replies-for panel actionKey', () => {
	const panel = { dataset: { repliesFor: `${'b'.repeat(128)}:p2` } }
	assertEquals(resolveTriggerPost(panelRow(panel)), { entityHash: 'b'.repeat(128), postId: 'p2' })
})

Deno.test('resolveTriggerPost returns null without a card or panel', () => {
	assertEquals(resolveTriggerPost(null), null)
	assertEquals(resolveTriggerPost(orphanElement()), null)
	assertEquals(resolveTriggerPost(badCardElement()), null)
})
