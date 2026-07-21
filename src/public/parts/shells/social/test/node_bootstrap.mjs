import { ensureSocialTestReady } from './afterInit.mjs'
import { seedForeignFeedAuthorPost } from './seedForeignFeedAuthor.mjs'
import { seedKnownTestEntityTarget } from './seedKnownEntity.mjs'

/**
 * Social live / 前端测试节点 bootstrap（由 test node worker 调用）。
 * @param {string} username 测试用户名
 */
export default async function bootstrap(username) {
	await ensureSocialTestReady(username)
	await seedKnownTestEntityTarget()
	await seedForeignFeedAuthorPost(username)
}
