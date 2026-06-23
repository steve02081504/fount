/**
 * Chat 后端集成测试 harness：每文件独立 dataDir，可并行 deno test。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTestServerBoot } from 'fount/scripts/test/node/boot.mjs'

/**
 * 创建 Chat 集成测试 boot 句柄。
 * @param {object} [options] harness 选项
 * @param {string} [options.username] 测试用户名
 * @param {string} [options.tempDirPrefix] 临时目录前缀
 * @param {boolean} [options.minP2pNode] 是否初始化离线 P2P node
 * @param {string[]} [options.loadParts] loadPart 列表
 * @param {(username: string) => Promise<void>} [options.afterInit] init 后钩子
 * @returns {{ ensureServer: () => Promise<{ dataDir: string, username: string }>, dataDir: string, username: string }} 集成 boot 句柄
 */
export function createIntegrationBoot(options = {}) {
	const username = options.username ?? 'chat-test-user'
	const dataDir = mkdtempSync(join(tmpdir(), options.tempDirPrefix ?? 'fount_chat_test_'))
	const loadParts = options.loadParts ?? ['shells/chat']
	const afterInit = options.afterInit ?? (options.minP2pNode
		? async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/operator_identity.mjs')
			await ensureOperatorPubKey(user)
		}
		: undefined)
	return {
		ensureServer: createTestServerBoot({
			username,
			dataDir,
			minP2pNode: options.minP2pNode ?? false,
			loadParts,
			afterInit,
		}),
		dataDir,
		username,
	}
}

/**
 * 启动 server 并返回测试会话。
 * @param {{ ensureServer: () => Promise<{ dataDir: string, username: string }>, username: string }} boot 集成 boot 对象
 * @returns {Promise<{ username: string, dataDir: string }>} 已启动的会话
 */
export async function resolveTestSession(boot) {
	const row = await boot.ensureServer()
	return { username: boot.username, dataDir: row.dataDir }
}

/**
 * 创建惰性测试会话启动器。
 * @param {object} [options] createIntegrationBoot 选项
 * @returns {() => Promise<{ username: string, dataDir: string }>} 惰性会话启动器
 */
export function createTestSession(options = {}) {
	const boot = createIntegrationBoot(options)
	let session = null
	return () => session ??= resolveTestSession(boot)
}
