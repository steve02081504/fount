/**
 * 集成测试共用的 mock AI serviceSource 播种。
 */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** mock AI serviceSource 目录名。 */
export const MOCK_AI_NAME = 'mock_echo'
/** 埋入角色描述、供 StructCall 检测的提示标记。 */
export const PROMPT_MARKER = 'FOUNT_PROMPT_MARKER'

const fixtureRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	'serviceSources',
	'AI',
	MOCK_AI_NAME,
)

/**
 * 将 mock AI serviceSource 播种到测试用户目录。
 * @param {string} dataDir shared test data root
 * @param {string} username fount username
 * @returns {Promise<void>}
 */
export async function seedMockAiSource(dataDir, username) {
	const to = join(dataDir, 'users', username, 'serviceSources', 'AI', MOCK_AI_NAME)
	await mkdir(dirname(to), { recursive: true })
	await cp(fixtureRoot, to, { recursive: true })
}
