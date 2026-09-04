/**
 * i18n 子树白名单守卫：data-i18n 覆盖前检查白名单外元素（svg/img/button/…）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std/assert/mod.ts'

import {
	ALLOWED_I18N_CHILD_TAGS,
	findDisallowedChildTags,
} from '../../../public/pages/scripts/i18n/clobber_guard.mjs'

Deno.test('whitelist covers text-flow tags i18n itself emits', () => {
	assertEquals(ALLOWED_I18N_CHILD_TAGS, new Set(['div', 'p', 'br', 'code', 'span', 'a']))
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
