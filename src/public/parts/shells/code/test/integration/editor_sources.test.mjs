/* global Deno */
/**
 * code shell 编辑器数据源采集测试：VS Code fork 变种目录发现 + workspaceStorage file:// 解码 + Notepad++ 会话。
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { assertEquals } from 'jsr:@std/assert'

import { collectEditorSources } from '../../src/editor_sources.mjs'

/**
 * 创建模拟的 VS Code fork 数据目录树（Cursor 风格），返回 APPDATA 根。
 * @param {string} root - 临时根目录。
 * @param {string[]} projects - 真实存在的项目目录（相对 root）。
 * @returns {Promise<void>}
 */
async function makeFakeEditorData(root, projects) {
	await mkdir(path.join(root, 'Cursor', 'User', 'globalStorage'), { recursive: true })
	await mkdir(path.join(root, 'Cursor', 'User', 'workspaceStorage', 'hash1'), { recursive: true })
	await mkdir(path.join(root, 'Cursor', 'User', 'workspaceStorage', 'hash2'), { recursive: true })
	const dbPath = path.join(root, 'Cursor', 'User', 'globalStorage', 'state.vscdb')
	const { DatabaseSync } = await import('node:sqlite')
	const db = new DatabaseSync(dbPath)
	db.exec('CREATE TABLE ItemTable(key TEXT, value BLOB)')
	const insert = db.prepare('INSERT INTO ItemTable VALUES (?, ?)')
	insert.run('terminal.history.entries.dirs', JSON.stringify({
		entries: projects.map(p => ({ key: path.join(root, p) })),
	}))
	db.close()
	for (const p of projects)
		await mkdir(path.join(root, p), { recursive: true })
	// workspaceStorage：folder 用 VS Code 真实 file:// URL 格式（盘符 %3A 编码）
	await writeFile(path.join(root, 'Cursor', 'User', 'workspaceStorage', 'hash1', 'workspace.json'), JSON.stringify({
		folder: 'file:///' + path.join(root, projects[0]).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1%3A'),
	}))
	await writeFile(path.join(root, 'Cursor', 'User', 'workspaceStorage', 'hash2', 'workspace.json'), JSON.stringify({
		folder: 'file:///' + path.join(root, projects[1]).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1%3A'),
	}))
}

Deno.test('collectEditorSources discovers VS Code fork variants and decodes file:// folders', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_code_editor_src_'))
	const savedAppdata = process.env.APPDATA
	try {
		await makeFakeEditorData(root, ['cursor-proj', 'trae-proj'])
		process.env.APPDATA = root
		const result = await collectEditorSources('u', '0')
		const names = result.map(item => item.name).sort()
		assertEquals(names, ['cursor-proj', 'trae-proj'])
		for (const item of result)
			assertEquals(item.path, path.join(root, item.name))
	}
	finally {
		if (savedAppdata === undefined) delete process.env.APPDATA
		else process.env.APPDATA = savedAppdata
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('collectEditorSources returns [] when no editor data exists', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_code_editor_empty_'))
	const savedAppdata = process.env.APPDATA
	try {
		process.env.APPDATA = root
		const result = await collectEditorSources('u', '0')
		assertEquals(result, [])
	}
	finally {
		if (savedAppdata === undefined) delete process.env.APPDATA
		else process.env.APPDATA = savedAppdata
		await rm(root, { recursive: true, force: true })
	}
})