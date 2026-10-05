/* global Deno */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { readEditorExtensions } from '../../src/editor_extensions.mjs'

Deno.test('editor contributions load user assets and reject escaping or invalid configurations', async () => {
	const user = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_editor_extensions_'))
	const root = path.join(user, '.fount')
	try {
		assertEquals(await readEditorExtensions(user), { languages: [] })
		await fs.mkdir(root)
		await fs.writeFile(path.join(root, 'grammar.json'), JSON.stringify({ scopeName: 'source.demo', patterns: [] }))
		await fs.writeFile(path.join(root, 'format.mjs'), 'export function format({text}) {return text}')
		const language = { id: 'demo', extensions: ['.demo'], grammar: 'grammar.json', formatter: 'format.mjs' }
		/**
		 * 写入测试配置。
		 * @param {object} config 测试配置。
		 * @returns {Promise<void>} 配置已写入。
		 */
		function write(config) { return fs.writeFile(path.join(root, 'editor.json'), JSON.stringify(config)) }
		await write({ version: 1, languages: [language] })
		const loaded = await readEditorExtensions(user)
		assertEquals(loaded.languages[0].grammar.scopeName, 'source.demo')
		assertEquals(loaded.languages[0].formatter, 'export function format({text}) {return text}')
		await fs.writeFile(path.join(user, 'outside.mjs'), 'outside')
		await write({ version: 1, languages: [{ ...language, formatter: '../outside.mjs' }] })
		await assertRejects(() => readEditorExtensions(user), Error, 'escapes')
		await write({ version: 1, languages: [language, language] })
		await assertRejects(() => readEditorExtensions(user), Error, 'unique')
		await write({ version: 2, languages: [] })
		await assertRejects(() => readEditorExtensions(user), Error, 'version 1')
		await write({ version: 1, languages: [language] })
		await fs.writeFile(path.join(root, 'format.mjs'), 'x'.repeat(2 * 1024 * 1024 + 1))
		await assertRejects(() => readEditorExtensions(user), Error, 'smaller than 2 MiB')
	} finally { await fs.rm(user, { recursive: true, force: true }) }
})

Deno.test('editor contributions reject a configuration directory symlinked outside the user directory', async () => {
	const user = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_editor_extensions_link_'))
	const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_editor_extensions_outside_'))
	try {
		await fs.writeFile(path.join(outside, 'grammar.json'), JSON.stringify({ scopeName: 'source.secret', patterns: [] }))
		await fs.writeFile(path.join(outside, 'editor.json'), JSON.stringify({ version: 1, languages: [
			{ id: 'secret', extensions: ['.secret'], grammar: 'grammar.json' },
		] }))
		await fs.symlink(outside, path.join(user, '.fount'), 'junction')
		await assertRejects(() => readEditorExtensions(user), Error, 'escapes')
	} finally {
		await fs.rm(user, { recursive: true, force: true })
		await fs.rm(outside, { recursive: true, force: true })
	}
})
