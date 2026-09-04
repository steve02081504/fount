/* global Deno */
/**
 * code shell 上下文（profile/commands 并集、渲染、会话、world 注入）· 集成测试。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertThrows, assertEquals } from 'jsr:@std/assert'

import {
	getCommand,
	listCommands,
	listProfiles,
	loadWorkspaceAgentsMd,
	renderCommand,
	resolveCommandArgs,
} from '../../src/context.mjs'
import { deleteSession, listSessions, loadSession, saveSession } from '../../src/sessions.mjs'
import { codeWorld } from '../../src/world.mjs'

/**
 * 创建带示例 .agents 的工作区。
 * @returns {Promise<string>} 工作区根。
 */
async function tempWorkspace() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_ws_'))
	await fs.mkdir(path.join(root, '.agents', 'commands'), { recursive: true })
	await fs.mkdir(path.join(root, '.agents', 'modes'), { recursive: true })
	await fs.writeFile(path.join(root, 'AGENTS.md'), '# 工作区规则', 'utf8')
	await fs.writeFile(path.join(root, '.agents', 'build.md'), '工作区版 build', 'utf8')
	await fs.writeFile(path.join(root, '.agents', 'review.md'), '---\ndescription: 复查代码\n---\n复查正文', 'utf8')
	await fs.writeFile(path.join(root, '.agents', 'modes', 'quick.md'), '快速模式', 'utf8')
	await fs.writeFile(path.join(root, '.agents', 'commands', 'greet.md'), '---\ndescription: 问候\nparams:\n  name:\n    required: true\n---\n你好 $argv.name，今天是 ${argv.name.length} 个字符', 'utf8')
	return root
}

Deno.test('listProfiles merges builtin/global/workspace with priority', async () => {
	const root = await tempWorkspace()
	try {
		const profiles = await listProfiles('u', { machine: 0, path: root })
		const names = profiles.map(p => p.name)
		assert(names.includes('plan') && names.includes('build'), '自带 plan/build 在列表中')
		const build = profiles.find(p => p.name === 'build')
		assertEquals(build.source, 'workspace', '工作区覆盖自带')
		assertEquals(build.content, '工作区版 build')
		const review = profiles.find(p => p.name === 'review')
		assertEquals(review.description, '复查代码')
		assert(profiles.some(p => p.name === 'quick'), '.agents/modes 拓展进入列表')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('loadWorkspaceAgentsMd is case-insensitive', async () => {
	const root = await tempWorkspace()
	try {
		const agents = await loadWorkspaceAgentsMd('u', { machine: 0, path: root })
		assertEquals(agents.content, '# 工作区规则')
		await fs.rm(path.join(root, 'AGENTS.md'))
		await fs.writeFile(path.join(root, 'agents.md'), 'lowercase', 'utf8')
		assertEquals((await loadWorkspaceAgentsMd('u', { machine: 0, path: root })).content, 'lowercase')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('commands resolve args and render argv/js/shell inline', async () => {
	const root = await tempWorkspace()
	try {
		const workdir = { machine: 0, path: root }
		const commands = await listCommands('u', workdir)
		assert(commands.some(c => c.name === 'greet'))
		const command = await getCommand('u', workdir, 'greet')
		assert(command.params.name.required)
		assertThrows(() => resolveCommandArgs(command, {}), undefined, '缺必填参数抛错')
		assertEquals(resolveCommandArgs(command, { name: 'abc' }).name, 'abc')
		const { createTargetExecutor } = await import('../../../../plugins/file-operations/src/target.mjs')
		const executor = createTargetExecutor('u', { machine: 0, workdir: root })
		const rendered = await renderCommand(command, { name: 'abc' }, executor)
		assertEquals(rendered, '你好 abc，今天是 3 个字符')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('sessions save/load/list/delete roundtrip', async () => {
	const root = await tempWorkspace()
	try {
		const workdir = { machine: 0, path: root }
		const session = {
			id: 'abcDEF123',
			title: '测试',
			charname: 'char',
			profile: 'build',
			ai_source: '',
			created: new Date().toISOString(),
			updated: new Date().toISOString(),
			memory: {},
			entries: [{ id: 'e1', uid: 'user', role: 'user', name: 'u', content: 'hi', time: new Date().toISOString() }],
		}
		await saveSession('u', workdir, session)
		assertEquals((await loadSession('u', workdir, 'abcDEF123')).title, '测试')
		assertEquals((await listSessions('u', workdir)).length, 1)
		await deleteSession('u', workdir, 'abcDEF123')
		assertEquals(await loadSession('u', workdir, 'abcDEF123'), null)
		assertEquals(await loadSession('u', workdir, '../evil'), null, '非法 id 拒绝')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('code world GetPrompt injects profile and AGENTS.md first', async () => {
	const root = await tempWorkspace()
	try {
		const prompt = await codeWorld.interfaces.chat.GetPrompt({
			username: 'u',
			workdir: { machine: 0, path: root },
			extension: { code: { profile: 'review' } },
		})
		assertEquals(prompt.text.length, 2, 'profile + AGENTS.md 两条')
		assert(prompt.text[0].content.includes('复查正文'))
		assert(prompt.text[1].content.includes('# 工作区规则'))
		assertEquals(prompt.text[0].important, 0)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})
