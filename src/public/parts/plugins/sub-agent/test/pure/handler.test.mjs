/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { terminateSubAgentHandler } from '../../handler.mjs'

/**
 * 收集工具日志的函数。
 * @param {object[]} logs - 日志数组。
 * @returns {(entry: object) => void} 收集函数。
 */
function collectLog(logs) {
	return entry => {
		logs.push(entry)
	}
}

Deno.test('terminate-subagent marks failed when the run is missing', async () => {
	const logs = []
	const result = await terminateSubAgentHandler.handle(
		{},
		{ AddLongTimeLog: collectLog(logs) },
		{ params: { id: 'missing-run' } },
	)
	assertEquals(result, { regen: true, failed: true })
	assertStringIncludes(logs[0].content, '未找到子代理运行')
})
