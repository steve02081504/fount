/**
 * Social 后端集成测试 harness：同进程共享 dataDir，每测试独立 username。
 *
 * 用 createTestSession() 惰性启动 server，避免模块加载时即 boot 多个实例。
 */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLazySession } from 'fount/scripts/test/fixtures.mjs'
import { createTestServerBoot, ensureSharedTestDataDir } from 'fount/scripts/test/node/boot.mjs'

import { ensureSocialTestReady } from './afterInit.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/**
 * 创建 Social 集成测试 boot 句柄。
 * @param {object} [options] harness 选项
 * @param {string} [options.username] 测试用户名
 * @param {(username: string) => Promise<void>} [options.afterInit] init 后钩子
 * @returns {{ ensureServer: () => Promise<{ dataDir: string, username: string }>, dataDir: string, username: string }} 集成 boot 句柄
 */
export function createIntegrationBoot(options = {}) {
	const username = options.username ?? 'social-test-user'
	const dataDir = ensureSharedTestDataDir()
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
 * 将 `test/fixtures/chars/<name>` 复制到用户 chars 目录并解析 agent entityHash。
 * @param {string} username 用户
 * @param {string} charName fixture 目录名
 * @param {object} [options] 选项
 * @param {boolean} [options.ensureSocialReady] 是否 `ensureEntitySocialReady`
 * @returns {Promise<string>} agent entityHash
 */
export async function seedAgentChar(username, charName, options = {}) {
	const { getUserDictionary } = await import('fount/server/auth/index.mjs')
	const { ensureLocalAgentEntityHash } = await import('fount/public/parts/shells/chat/src/entity/member.mjs')
	const to = join(getUserDictionary(username), 'chars', charName)
	await mkdir(to, { recursive: true })
	await cp(join(fixturesRoot, 'chars', charName), to, { recursive: true })
	const hash = await ensureLocalAgentEntityHash(username, charName)
	if (options.ensureSocialReady) {
		const { ensureEntitySocialReady } = await import('../src/lib/bootstrap.mjs')
		await ensureEntitySocialReady(username, hash)
	}
	return hash
}

/**
 * 启动 server 并解析 operator 会话。
 * @param {{ ensureServer: () => Promise<unknown>, username: string }} boot 集成 boot 对象
 * @returns {Promise<{ username: string, operator: string }>} operator 会话
 */
export async function resolveTestOperator(boot) {
	await boot.ensureServer()
	const { resolveOperatorEntityHashForUser } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
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
