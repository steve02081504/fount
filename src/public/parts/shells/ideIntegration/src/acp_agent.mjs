/**
 * ACP AgentContext 操作封装（SDK method 路径的薄包装）。
 */
import { methods } from 'npm:@agentclientprotocol/sdk'

/**
 * @param {import('npm:@agentclientprotocol/sdk').AgentContext} ctx AgentContext
 * @param {object} params session.update 参数
 * @returns {void | Promise<void>} notify 结果
 */
export function sessionUpdate(ctx, params) {
	return ctx.notify(methods.client.session.update, params)
}

/**
 * @param {import('npm:@agentclientprotocol/sdk').AgentContext} ctx AgentContext
 * @param {object} params requestPermission 参数
 * @returns {Promise<object>} 授权结果
 */
export function requestPermission(ctx, params) {
	return ctx.request(methods.client.session.requestPermission, params)
}

/**
 * @param {import('npm:@agentclientprotocol/sdk').AgentContext} ctx AgentContext
 * @param {object} params readTextFile 参数
 * @returns {Promise<object>} 文件内容
 */
export function readTextFile(ctx, params) {
	return ctx.request(methods.client.fs.readTextFile, params)
}

/**
 * @param {import('npm:@agentclientprotocol/sdk').AgentContext} ctx AgentContext
 * @param {object} params writeTextFile 参数
 * @returns {Promise<object>} 写入结果
 */
export function writeTextFile(ctx, params) {
	return ctx.request(methods.client.fs.writeTextFile, params)
}

/**
 * @param {import('npm:@agentclientprotocol/sdk').AgentContext} ctx AgentContext
 * @param {object} params terminal.create 参数（含 sessionId）
 * @returns {Promise<{ id: string, waitForExit: Function, currentOutput: Function, release: Function }>} 终端句柄
 */
export async function createTerminal(ctx, params) {
	const { terminalId } = await ctx.request(methods.client.terminal.create, params)
	const sid = params.sessionId
	return {
		id: terminalId,
		/** @returns {Promise<object>} 退出状态 */
		waitForExit: () => ctx.request(methods.client.terminal.waitForExit, { sessionId: sid, terminalId }),
		/** @returns {Promise<object>} 当前输出 */
		currentOutput: () => ctx.request(methods.client.terminal.output, { sessionId: sid, terminalId }),
		/** @returns {Promise<object>} 释放结果 */
		release: () => ctx.request(methods.client.terminal.release, { sessionId: sid, terminalId }),
	}
}
