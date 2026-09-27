/* global Deno */
/**
 * 读文件工具日志的连续重复行压缩 · 端到端测试。
 * 覆盖 <view-file>：一个满是连续重复行的巨文件进上下文前应被折叠为首尾各若干行 + 省略标记。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { runReplyHandlers } from '../../../../shells/chat/src/reply/handlerPipeline.mjs'
import { fileOperationsReplyHandlers } from '../../handler.mjs'

/**
 * 构造 handler 调用参数，收集回写日志。
 * @param {string} root - 工作区根。
 * @returns {{logs: object[], args: object}} 日志数组与参数。
 */
function createHandlerArgs(root) {
	const logs = []
	/**
	 * 收集工具回写日志。
	 * @param {object} entry - 日志条目。
	 * @returns {void}
	 */
	const addLog = entry => { logs.push(entry) }
	return {
		logs,
		args: {
			Charname: 'TestChar',
			char_id: 'test-char',
			username: 'test-user',
			workdir: { machine: '0', path: root },
			chat_scoped_char_memory: {},
			AddLongTimeLog: addLog,
		},
	}
}

Deno.test('view-file compresses long identical-line runs in a huge file', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_read_dedupe_'))
	try {
		// 一个「十几 GB 日志」的微缩版：大量完全相同的行，带不同的首尾行（行数须在默认读取窗口内）
		const content = ['HEAD', ...Array.from({ length: 1200 }, () => 'the same repeated log line'), 'TAIL'].join('\n')
		await fs.writeFile(path.join(root, 'big.log'), content, 'utf8')

		const { logs, args } = createHandlerArgs(root)
		assertEquals(await runReplyHandlers({ content: '<view-file>big.log</view-file>', extension: {} }, args, fileOperationsReplyHandlers), true)
		const entry = logs.find(log => log.name === 'file-operations.view-file')
		assert(entry, 'view-file 应写入工具日志')
		assertStringIncludes(entry.content, '已省略', '连续重复行应被压缩为省略标记')
		assert(!entry.content.includes('the same repeated log line\nthe same repeated log line\nthe same repeated log line\nthe same repeated log line'), '不应保留巨量重复行')
		assertStringIncludes(entry.content, 'HEAD')
		assertStringIncludes(entry.content, 'TAIL')
		// 压缩后上下文规模应远小于原始重复内容
		assert(entry.content.length < content.length / 10, `压缩后应显著变小（${entry.content.length} vs ${content.length}）`)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})
