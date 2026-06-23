/**
 * Social 集成 / live 测试共用的 init 后引导（与 node_bootstrap 一致）。
 * @param {string} username replica 登录名
 */
export async function ensureSocialTestReady(username) {
	const { ensureOperatorPubKey, resolveOperatorEntityHashForUser } =
		await import('fount/server/p2p_server/operator_identity.mjs')
	const { ensureOperatorSocialReady } = await import('../src/lib/bootstrap.mjs')
	await ensureOperatorPubKey(username)
	if (!await resolveOperatorEntityHashForUser(username))
		throw new Error('operator entityHash not resolved after ensureOperatorPubKey')
	await ensureOperatorSocialReady(username)
}
