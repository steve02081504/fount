/**
 * i18n 子树白名单守卫：data-i18n 覆盖前检查白名单外元素（svg/img/button/…）；
 * 白名单 = 基础文本类元素 ∪ locale 值动态注入（硬禁区除外）。
 */
/* global Deno */
import { assertEquals, assert } from 'https://deno.land/std/assert/mod.ts'

import {
	allowedI18nChildTags,
	findDisallowedChildTags,
	seedAllowedTagsFromLocaleValues,
} from '../../../public/pages/scripts/i18n/clobber_guard.mjs'

Deno.test('whitelist covers text-flow tags i18n itself emits', () => {
	assertEquals(allowedI18nChildTags(), new Set(['div', 'p', 'br', 'code', 'span', 'a']))
})

Deno.test('locale values extend the whitelist; hard-banned tags never pass', () => {
	seedAllowedTagsFromLocaleValues([
		'fount 是由 AI 驱动的平台，赋能<i>您</i>。',
		'但因为 <strong>fount</strong>，所以没有这些东西 :D',
		'<em>斜体</em> 与 <b>粗体</b> 同理',
		'危险值携带 <svg></svg> 也不放行',
	])
	const allowed = allowedI18nChildTags()
	for (const tag of ['i', 'em', 'strong', 'b']) assert(allowed.has(tag), `seeded tag ${tag} must be allowed`)
	assert(!allowed.has('svg'), 'hard-banned tag must never be allowed')
	// findDisallowedChildTags 按动态白名单判定：i 放行、svg 仍标记
	const element = {
		/**
		 * stub 子树。
		 * @returns {Array<{ tagName: string }>} 假元素列表
		 */
		querySelectorAll: () => [{ tagName: 'i' }, { tagName: 'EM' }, { tagName: 'svg' }],
	}
	assertEquals(findDisallowedChildTags(element), ['svg'])
})

Deno.test('findDisallowedChildTags flags svg/img/button and passes text tags', () => {
	const element = {
		/**
		 * stub 子树。
		 * @returns {Array<{ tagName: string }>} 假元素列表
		 */
		querySelectorAll: () => [
			{ tagName: 'SVG' },
			{ tagName: 'span' },
			{ tagName: 'BUTTON' },
			{ tagName: 'code' },
			{ tagName: 'div' },
		],
	}
	assertEquals(findDisallowedChildTags(element), ['svg', 'button'])
})

Deno.test('findDisallowedChildTags dedups and orders by first occurrence', () => {
	const element = {
		/**
		 * stub 子树。
		 * @returns {Array<{ tagName: string }>} 假元素列表
		 */
		querySelectorAll: () => [
			{ tagName: 'img' },
			{ tagName: 'IMG' },
			{ tagName: 'svg' },
		],
	}
	assertEquals(findDisallowedChildTags(element), ['img', 'svg'])
})

Deno.test('findDisallowedChildTags tolerates empty and tag-less subtrees', () => {
	const empty = {
		/**
		 * stub 子树。
		 * @returns {Array<{ tagName: string }>} 假元素列表
		 */
		querySelectorAll: () => [],
	}
	const tagLess = {
		/**
		 * stub 子树。
		 * @returns {Array<{ tagName: undefined }>} 假元素列表
		 */
		querySelectorAll: () => [{ tagName: undefined }],
	}
	assertEquals(findDisallowedChildTags(empty), [])
	assertEquals(findDisallowedChildTags(tagLess), [])
})

Deno.test('findDisallowedChildTags accepts an object keyed like an element', () => {
	const element = {
		/**
		 * stub 子树。
		 * @returns {Array<{ tagName: string }>} 假元素列表
		 */
		querySelectorAll: () => [{ tagName: 'a' }, { tagName: 'br' }],
	}
	assertEquals(findDisallowedChildTags(element), [])
})
