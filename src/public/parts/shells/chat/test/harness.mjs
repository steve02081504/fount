/**
 * Chat 后端集成测试 harness：同进程共享 dataDir，每测试独立 username。
 */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLazySession } from 'fount/scripts/test/fixtures.mjs'
import { createTestServerBoot, ensureSharedTestDataDir } from 'fount/scripts/test/node/boot.mjs'

/** 集成测试轮询：毫秒超时，失败抛错（与 live `pollUntil` 秒超时/软失败相对）。 */
export { waitUntil } from 'fount/scripts/test/live/http.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/**
 * 创建 Chat 集成测试 boot 句柄。
 * @param {object} [options] harness 选项
 * @param {string} [options.username] 测试用户名
 * @param {boolean} [options.minP2pNode] 是否初始化离线 P2P node
 * @param {string[]} [options.loadParts] loadPart 列表
 * @param {(username: string) => Promise<void>} [options.afterInit] init 后钩子
 * @returns {{ ensureServer: () => Promise<{ dataDir: string, username: string }>, dataDir: string, username: string }} 集成 boot 句柄
 */
export function createIntegrationBoot(options = {}) {
	const username = options.username ?? 'chat-test-user'
	const dataDir = ensureSharedTestDataDir()
	const loadParts = options.loadParts ?? ['shells/chat']
	const afterInit = options.afterInit ?? (options.minP2pNode
		? async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
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
 * 将 `test/fixtures/chars/<name>` 复制到用户 chars 目录。
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @param {string | string[]} charNames 角色 fixture 名
 * @returns {Promise<void>}
 */
export async function seedCharFixture(dataDir, username, charNames) {
	const userRoot = join(dataDir, 'users', username)
	for (const name of [charNames].flat()) {
		const from = join(fixturesRoot, 'chars', name)
		const to = join(userRoot, 'chars', name)
		await mkdir(dirname(to), { recursive: true })
		await cp(from, to, { recursive: true })
	}
}

/**
 * minP2pNode boot：ensureOperator + 可选 seed 角色 fixture。
 * @param {object} [options] createIntegrationBoot 选项
 * @param {string | string[]} [options.chars] 要 seed 的角色名
 * @param {(username: string) => Promise<void>} [options.afterInit] 在 seed 之后再跑的钩子
 * @returns {ReturnType<typeof createIntegrationBoot>} boot 句柄
 */
export function createCharBoot(options = {}) {
	const { chars: charsOpt, afterInit: userAfter, ...rest } = options
	const chars = [charsOpt].flat().filter(Boolean)
	const dataDir = ensureSharedTestDataDir()
	return createIntegrationBoot({
		minP2pNode: true,
		...rest,
		/**
		 * @param {string} user 用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			if (chars.length) await seedCharFixture(dataDir, user, chars)
			if (userAfter) await userAfter(user)
		},
	})
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
	return createLazySession(() => resolveTestSession(boot))
}
