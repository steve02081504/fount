/* global Deno */
/**
 * code-execution 的 shell 可用性：提示词里的标签必须都有处理器认领，不可用的 shell 不能原样穿透。
 *
 * 回归背景：Windows 上未安装 PowerShell 7（`pwsh`）时只有 `powershell.exe`。
 * 旧实现按 `available[shell_name]` 在注册期过滤处理器，于是 `<run-pwsh>` / `<inline-pwsh>` 没有处理器，
 * 而提示词却又指引模型使用 pwsh —— 标签原样留在消息里被 shell 直接渲染（AI 正常、插件看似失效）。
 */

import { assert, assertEquals } from 'jsr:@std/assert'

import { flattenReplyHandlers } from '../../../../shells/chat/src/reply/defineReplyHandler.mjs'
import { runReplyHandlers } from '../../../../shells/chat/src/reply/handlerPipeline.mjs'
import { isShellUsable, pickDefaultShell } from '../../availability.mjs'
import { getCodeExecutionReplyHandlers } from '../../handler.mjs'
import { getCodeExecutionPrompt } from '../../prompt.mjs'

/**
 * 构造 handler / prompt 调用所需的请求上下文。
 * @returns {{logs: object[], result: object, args: object}} 日志数组、回复对象与参数。
 */
function createArgs() {
	const logs = []
	const result = { content: '', extension: {} }
	return {
		logs,
		result,
		args: {
			Charname: 'TestChar',
			UserCharname: 'User',
			char_id: 'test-char',
			username: 'test-user',
			workdir: { machine: '0' },
			chat_log: [],
			chat_scoped_char_memory: {},
			plugins: {},
			supported_functions: {},
			/**
			 * 收集工具回写日志。
			 * @param {object} entry - 日志条目。
			 * @returns {void}
			 */
			AddLongTimeLog: entry => { logs.push(entry) },
		},
	}
}

/**
 * 造一个返回固定可用 shell 列表的解析函数（测试注入用）。
 * @param {string[]} shells - 要返回的可用 shell 列表。
 * @returns {(args: object) => Promise<string[]>} 解析函数。
 */
function stubShells(shells) {
	/**
	 * 返回固定的可用 shell 列表。
	 * @returns {Promise<string[]>} 可用 shell 列表。
	 */
	return async () => shells
}

/**
 * 造一个返回固定默认 shell 的解析函数（测试注入用）。
 * @param {string} shell - 要返回的默认 shell。
 * @returns {(args: object) => Promise<string>} 解析函数。
 */
function stubDefault(shell) {
	/**
	 * 返回固定的默认 shell。
	 * @returns {Promise<string>} 默认 shell。
	 */
	return async () => shell
}

/**
 * 从文本中抽取全部 `run-*` / `inline-*` 标签名。
 * @param {string} text - 文本。
 * @returns {Set<string>} 标签名集合。
 */
function extractToolTags(text) {
	const tags = new Set()
	for (const match of text.matchAll(/<(run|inline)-([A-Za-z_][\w.-]*)\s*[>/]/g))
		tags.add(`${match[1]}-${match[2]}`)
	return tags
}

/**
 * 解析 handler 列表的 tag 名集合。
 * @param {object[]} handlers - handler 列表。
 * @returns {Set<string>} tag 名集合。
 */
function handlerTags(handlers) {
	return new Set(flattenReplyHandlers(handlers).map(handler => handler.name))
}

Deno.test('isShellUsable 把 pwsh 视为 powershell 的可用别名（仅单向）', () => {
	assert(isShellUsable('pwsh', ['powershell']), '无 pwsh 时可回退 powershell')
	assert(isShellUsable('powershell', ['powershell']))
	assert(!isShellUsable('powershell', ['pwsh']), 'powershell 不会回退到 pwsh')
	assert(!isShellUsable('bash', ['powershell']))
	assert(!isShellUsable('bash', undefined))
})

Deno.test('pickDefaultShell 尊重目标默认并回退到可用优先级', () => {
	assertEquals(pickDefaultShell(['pwsh', 'powershell'], 'powershell'), 'powershell')
	assertEquals(pickDefaultShell(['bash', 'sh'], 'pwsh'), 'bash')
	assertEquals(pickDefaultShell([], 'pwsh'), 'sh')
})

Deno.test('getCodeExecutionReplyHandlers 注册所有已注册 shell（不按可用性在注册期过滤）', () => {
	const handlers = getCodeExecutionReplyHandlers({ resolveShells: stubShells(['powershell']) })
	const tags = handlerTags(handlers)
	for (const tag of ['run-js', 'inline-js', 'run-pwsh', 'inline-pwsh', 'run-powershell', 'inline-powershell', 'run-bash', 'inline-bash', 'run-sh', 'inline-sh'])
		assert(tags.has(tag), `应注册 ${tag}`)
})

Deno.test('提示词只引用有处理器的 shell 标签', async () => {
	for (const shells of [['powershell'], ['pwsh', 'powershell'], ['bash', 'sh'], []]) {
		const { args } = createArgs()
		const prompt = await getCodeExecutionPrompt(args, {
			resolveShells: stubShells(shells),
			resolveDefault: stubDefault(shells[0] ?? ''),
		})
		const text = prompt.text.map(part => part.content).join('\n')
		const handlers = getCodeExecutionReplyHandlers({ resolveShells: stubShells(shells) })
		const known = handlerTags(handlers)
		for (const tag of extractToolTags(text))
			assert(known.has(tag), `可用集合 ${JSON.stringify(shells)} 下提示词引用了无处理器的 ${tag}`)
	}
})

Deno.test('提示词不引用目标机器不可用的 shell', async () => {
	const { args } = createArgs()
	const prompt = await getCodeExecutionPrompt(args, {
		resolveShells: stubShells(['powershell']),
		resolveDefault: stubDefault('powershell'),
	})
	const tags = extractToolTags(prompt.text.map(part => part.content).join('\n'))
	assert(tags.has('run-powershell'), '应指引使用可用的 powershell')
	assert(!tags.has('run-bash') && !tags.has('inline-bash'), '不应指引使用不可用的 bash')
	assert(!tags.has('run-sh') && !tags.has('inline-sh'), '不应指引使用不可用的 sh')
})

Deno.test('目标机器缺少该 shell 时写失败日志而非原样穿透标签', async () => {
	const { logs, result, args } = createArgs()
	result.content = '<run-pwsh>Write-Output hi</run-pwsh>'
	const handled = await runReplyHandlers(result, args, getCodeExecutionReplyHandlers({ resolveShells: stubShells([]) }))
	assertEquals(handled, true)
	const entry = logs.find(item => item.name === 'code-execution.run-pwsh')
	assert(entry, '应写失败工具日志')
	assert(entry.extension?.error, '失败日志应带 error 标记')
	// agent 层 content 按设计保留原始标签；人类展示层（content_for_show）必须已替换掉标签，
	// 否则标签会被 shell 直接当文本渲染出来，这正是本回归的现象。
	assert(!result.content_for_show?.includes('<run-pwsh>'), '展示层不应原样渲染未执行的标签')
})

Deno.test('inline 不可用 shell 求值失败并记入日志', async () => {
	const { logs, result, args } = createArgs()
	result.content = '<inline-bash>echo hi</inline-bash>'
	await runReplyHandlers(result, args, getCodeExecutionReplyHandlers({ resolveShells: stubShells(['pwsh', 'powershell']) }))
	assert(logs.some(item => item.name === 'code-execution.inline-bash'), '应记录 inline-bash 结果')
})
