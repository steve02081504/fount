/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createCommandHistory } from '../../public/shared/commandHistory.mjs'
import { isEditableTarget, matchCabinetShortcut } from '../../public/shared/keyboard.mjs'

/**
 * @param {Partial<{ key: string, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean, altKey: boolean, target: object }>} partial 部分事件
 * @returns {KeyboardEvent} 伪键盘事件
 */
function keyEvent(partial) {
	return /** @type {KeyboardEvent} */ {
		key: 'a',
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		target: {
			tagName: 'DIV',
			/**
			 * @returns {null} 无匹配
			 */
			closest: () => null,
			isContentEditable: false,
		},
		...partial,
	}
}

Deno.test('matchCabinetShortcut maps common chords', () => {
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'c', ctrlKey: true })), 'copy')
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'x', ctrlKey: true })), 'cut')
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'v', ctrlKey: true })), 'paste')
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'v', ctrlKey: true, shiftKey: true })), 'pasteLink')
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'a', ctrlKey: true })), 'selectAll')
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'd', ctrlKey: true })), 'delete')
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'z', ctrlKey: true })), 'undo')
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'y', ctrlKey: true })), 'redo')
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'z', ctrlKey: true, shiftKey: true })), 'redo')
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'n', ctrlKey: true })), 'newWindow')
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'F2' })), 'rename')
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'Delete' })), 'goUp')
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'Enter' })), 'open')
})

Deno.test('matchCabinetShortcut skips editable targets', () => {
	const input = {
		tagName: 'INPUT',
		/**
		 * @returns {null} 无匹配
		 */
		closest: () => null,
		isContentEditable: false,
	}
	assertEquals(matchCabinetShortcut(keyEvent({ key: 'c', ctrlKey: true, target: input })), null)
	assertEquals(isEditableTarget(input), true)
})

Deno.test('commandHistory undo/redo and discard on branch', async () => {
	const history = createCommandHistory(2)
	/** @type {string[]} */
	const log = []
	/** @type {string[]} */
	const discarded = []

	/**
	 * @param {string} label 标签
	 * @returns {import('../../public/src/commandHistory.mjs').HistoryEntry} 条目
	 */
	function entry(label) {
		return {
			label,
			/**
			 * @returns {Promise<void>}
			 */
			undo: async () => { log.push(`undo-${label}`) },
			/**
			 * @returns {Promise<void>}
			 */
			redo: async () => { log.push(`redo-${label}`) },
			/**
			 * @returns {Promise<void>}
			 */
			discard: async () => { discarded.push(label) },
		}
	}

	await history.push(entry('a'))
	await history.push(entry('b'))
	assertEquals(history.canUndo(), true)
	assertEquals(await history.undo(), true)
	assertEquals(log, ['undo-b'])
	assertEquals(await history.redo(), true)
	assertEquals(log, ['undo-b', 'redo-b'])

	await history.push(entry('c'))
	assertEquals(discarded.includes('a'), true)

	assertEquals(await history.undo(), true)
	await history.push(entry('d'))
	assertEquals(discarded.includes('c'), true)
})
