/**
 * Chat live / 联邦测试节点 bootstrap（由 test node worker 调用）。
 * @param {string} username 测试用户名
 */
export default async function bootstrap(username) {
	const { ensureOperatorPubKey } = await import('fount/server/p2p_server/operator_identity.mjs')
	await ensureOperatorPubKey(username)
}
