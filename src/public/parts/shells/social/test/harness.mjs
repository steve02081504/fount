/**
 * Social 后端集成测试 harness：每文件独立 dataDir。
 *
 * 用 createTestSession() 惰性启动 server，避免模块加载时即 boot 多个实例。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLazySession } from 'fount/scripts/test/fixtures.mjs'
import { createTestServerBoot } from 'fount/scripts/test/node/boot.mjs'

import { ensureSocialTestReady } from './afterInit.mjs'

/**
 * 创建 Social 集成测试 boot 句柄。
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
 * 启动 server 并解析 operator 会话。
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
 * 创建惰性 operator 会话启动器。
 * @param {object} [options] createIntegrationBoot 选项
 * @returns {() => Promise<{ username: string, operator: string }>} 惰性 operator 会话启动器
 */
export function createTestSession(options = {}) {
	const boot = createIntegrationBoot(options)
	return createLazySession(() => resolveTestOperator(boot))
}
