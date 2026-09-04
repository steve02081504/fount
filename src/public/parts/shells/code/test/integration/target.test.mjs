/* global Deno */
/**
 * 目标解析与执行器 · 单元测试（本机路径）。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { createArgsExecutorResolver, createTargetExecutor, joinWorkdir, listMachines, parseTagAttrs, resolveTarget } from '../../../../plugins/file-operations/src/target.mjs'

Deno.test('parseTagAttrs parses quoted attributes', () => {
	assertEquals(parseTagAttrs('machine="1" workdir="D:\\proj"'), { machine: '1', workdir: 'D:\\proj' })
	assertEquals(parseTagAttrs(''), {})
	assertEquals(parseTagAttrs(undefined), {})
})

Deno.test('resolveTarget explicit overrides request defaults', () => {
	const args = { username: 'u', workdir: { machine: '0', path: '/base' } }
	assertEquals(resolveTarget(args), { machine: '0', machineId: 0, workdir: '/base', remote: false })
	assertEquals(resolveTarget(args, { machine: '2' }), { machine: '2', machineId: 2, workdir: '/base', remote: true })
	assertEquals(resolveTarget(args, { workdir: 'sub/dir' }), { machine: '0', machineId: 0, workdir: '/base/sub/dir', remote: false })
	assertEquals(resolveTarget(undefined), { machine: '0', machineId: 0, workdir: undefined, remote: false })
})

Deno.test('joinWorkdir keeps separators and passes absolute paths through', () => {
	assertEquals(joinWorkdir('/base', 'a/b'), '/base/a/b')
	assertEquals(joinWorkdir('C:\\base', 'C:\\other'), 'C:\\other')
	assertEquals(joinWorkdir(undefined, 'x'), 'x')
})

Deno.test('local executor read/write/list against temp workspace', async () => {
	const root = await tempDir()
	try {
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })
		await executor.writeTextFile('a/b.txt', 'hello')
		assertEquals(await executor.readTextFile('a/b.txt'), 'hello')
		assert((await executor.readFileBuffer('a/b.txt')).toString() === 'hello')
		const entries = await executor.listDir('a')
		assertEquals(entries.length, 1)
		assertEquals(entries[0].name, 'b.txt')
		assertEquals((await executor.statEntry('a')).isDirectory, true)
		assertEquals(await executor.pathExists('a/b.txt'), true)
		assert((await executor.listRoots()).length > 0)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('createArgsExecutorResolver caches per target', () => {
	const args = { username: 'u', workdir: { machine: '0', path: '/base' } }
	const resolver = createArgsExecutorResolver(args)
	const first = resolver('machine="0" workdir="sub"')
	const second = resolver({ machine: '0', workdir: '/base/sub' })
	assert(first === second, '同一目标复用执行器')
	assert(resolver({ machine: 2 }) !== first, '不同目标新执行器')
})

Deno.test('listMachines includes localhost as id 0', async () => {
	const machines = await listMachines('u')
	assert(machines.some(m => m.id === '0' && m.isConnected), '本机在列表中且已连接')
	assert(machines.every(m => typeof m.description === 'string'), 'description 均为字符串')
})

/**
 * 创建临时目录。
 * @returns {Promise<string>} 目录路径。
 */
async function tempDir() {
	return await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_target_'))
}
