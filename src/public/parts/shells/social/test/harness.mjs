/**
 * Social 后端集成测试 harness：每文件独立 dataDir。
 *
 * 用 createTestSession() 惰性启动 server，避免模块加载时即 boot 多个实例。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTestServerBoot } from 'fount/scripts/test/server_harness.mjs'

import { ensureSocialTestReady } from './after_init.mjs'

/**
 * @param {object} [options] harness 选项
 * @param {string} [options.username] 测试用户名
 * @param {string} [options.tempDirPrefix] 临时目录前缀
 * @param {(username: string) => Promise<void>} [options.afterInit] init 后钩子
 * @returns {{ ensureServer: () => Promise<{ dataDir: string, username: string }>, dataDir: string, username: string }} 集成 boot 句柄
 */
export function createIntegrationBoot(options = {}) {
	const username = options.username ?? 'social-test-user'
	const dataDir = mkdtempSync(join(tmpdir(), options.tempDirPrefix ?? 'fount_social_test_'))
	const afterInit = options.afterInit ?? ensureSocialTestReady
	const ensureServer = createTestServerBoot({
		username,
		dataDir,
		minP2pNode: true,
		loadParts: ['shells/social'],
		afterInit,
	})
	return { ensureServer, dataDir, username }
}

/**
 * @param {{ ensureServer: () => Promise<unknown>, username: string }} boot 集成 boot 对象
 * @returns {Promise<{ username: string, operator: string }>} operator 会话
 */
export async function resolveTestOperator(boot) {
	await boot.ensureServer()
	const { resolveOperatorEntityHashForUser } = await import('fount/server/p2p_server/operator_identity.mjs')
	const operator = await resolveOperatorEntityHashForUser(boot.username)
	if (!operator) throw new Error('operator entityHash missing')
	return { username: boot.username, operator }
}

/**
 * @param {object} [options] createIntegrationBoot 选项
 * @returns {() => Promise<{ username: string, operator: string }>} 惰性 operator 会话启动器
 */
export function createTestSession(options = {}) {
	const boot = createIntegrationBoot(options)
	return () => boot.session ??= resolveTestOperator(boot)
}
