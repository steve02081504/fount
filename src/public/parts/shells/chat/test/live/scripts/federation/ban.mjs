import { ms } from 'fount/scripts/ms.mjs'
import { allowNoise } from 'fount/scripts/test/core/allowNoise.mjs'
import {
	Api,
	ClearFedGroup,
	completeLiveScript,
	FedA,
	FedB,
	FedC,
	InitializeOpenGroupJoinMulti,
	requireCase,
	testCase,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

if (!FedC) throw new Error('fed_ban requires FOUNT_TEST_NODE_COUNT >= 3')

/**
 * 有界重试：fn 返回真值即成功；否则重试至 attempts 次（间隔 intervalMs），彻底失败抛错。
 * @param {number} attempts 重试上限
 * @param {() => unknown | Promise<unknown>} fn 探测函数
 * @param {number} [intervalMs=2000] 重试间隔
 * @returns {Promise<unknown>} 首次真值或末次结果
 */
async function retryUntil(attempts, fn, intervalMs = 2000) {
	let lastError
	while (attempts-- > 0) {
		try {
			const last = await fn()
			if (last) return last
		}
		catch (error) {
			lastError = error
		}
		if (attempts > 0) await new Promise(resolve => setTimeout(resolve, intervalMs))
	}
	if (lastError) throw lastError
	return false
}

/** 单次请求超时（秒），比 catchup 的 waitMs 多留余量，避免挂起拖垮有界轮询。 */
const REQ_TIMEOUT_SEC = 20

console.log('=== Setup: open group + join A/B/C ===')
const setup = await InitializeOpenGroupJoinMulti('FedBan', 'ban-seed-abc', [FedB, FedC])
const gid = setup.groupId
const cid = setup.channelId
let bPub = null
let banEventId = null

console.log('\n=== 1. Resolve B member pubkey ===')
await requireCase('resolve B pubKeyHash from B state', async () => {
	const st = await Api(FedB, 'GET', `/groups/${gid}/state`, undefined, { timeoutSec: REQ_TIMEOUT_SEC })
	if (st.status !== 200) throw new Error(`state ${st.status}`)
	bPub = st.json.viewer?.memberKey
	return Boolean(bPub)
})

console.log('\n=== 2. A bans B (entity) ===')
await requireCase('A memberCount >= 3 before ban', async () => {
	const ok = await retryUntil(10, async () => {
		const s = await Api(FedA, 'GET', `/groups/${gid}/state`, undefined, { timeoutSec: REQ_TIMEOUT_SEC })
		return s.status === 200 && Number(s.json.meta?.memberCount) >= 3
	})
	return Boolean(ok)
})

await requireCase('A POST members/:hash/ban entity', async () => {
	const ok = await retryUntil(5, async () => {
		const k = await Api(FedA, 'POST', `/groups/${gid}/members/${encodeURIComponent(bPub)}/ban`, { banScope: 'entity' }, { timeoutSec: REQ_TIMEOUT_SEC })
		if (k.status !== 200) throw new Error(`ban ${k.status}: ${k.raw}`)
		banEventId = k.json.reputationSlash?.banEventId
		await Api(FedA, 'POST', `/groups/${gid}/dag/merge-tips`, {}, { timeoutSec: REQ_TIMEOUT_SEC })
		const s = await Api(FedA, 'GET', `/groups/${gid}/state`, undefined, { timeoutSec: REQ_TIMEOUT_SEC })
		return (s.json.meta?.bannedMembers?.filter(m => m.memberKey === bPub).length ?? 0) >= 1
	})
	if (!ok) throw new Error('A must materialize the ban')
	return true
})

console.log('\n=== 3. C receives ban via federation ===')
// 致命用例：第三方同步是后续 ban 验证的前提，失败后剩余验证无意义，立即退出而非空跑。
// 直接用 ban 响应带出的 banEventId 定向索要，不再反复让 A merge/catchup 制造额外 tips。
await requireCase('C catchup receives ban (third-party sync)', async () => {
	let diag = null
	const ok = await retryUntil(20, async () => {
		const body = { waitMs: ms('6s') }
		if (banEventId) body.extraWantIds = [banEventId]
		await Api(FedC, 'POST', `/groups/${gid}/federation/catchup`, body, { timeoutSec: REQ_TIMEOUT_SEC })
		await Api(FedC, 'POST', `/groups/${gid}/dag/merge-tips`, {}, { timeoutSec: REQ_TIMEOUT_SEC })
		const s = await Api(FedC, 'GET', `/groups/${gid}/state`, undefined, { timeoutSec: REQ_TIMEOUT_SEC })
		diag = s.status === 200
			? { banned: s.json.meta?.bannedMembers?.length ?? -1, tips: s.json.meta?.dagTips?.length, consensus: s.json.meta?.consensusBranchTip?.slice(0, 8), localView: s.json.meta?.localViewBranchTip?.slice(0, 8) }
			: { status: s.status }
		return s.status === 200 && (s.json.meta?.bannedMembers?.filter(m => m.memberKey === bPub).length ?? 0) >= 1
	}, 4000)
	if (!ok) throw new Error(`C must receive member_ban via normal federation catchup; banEventId=${banEventId} ${JSON.stringify(diag)}`)
	return true
})

console.log('\n=== 4. B probes peers and self-judges removed ===')
await requireCase('B probes peers and self-judges removed', async () => {
	let diag = null
	const ok = await allowNoise('group replica is being purged', async () =>
		retryUntil(20, async () => {
			for (const node of [FedB, FedA, FedC])
				await Api(node, 'POST', `/groups/${gid}/federation/rebind`, {}, { timeoutSec: REQ_TIMEOUT_SEC })

			const r = await Api(FedB, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('8s') }, { timeoutSec: REQ_TIMEOUT_SEC })
			if (r.status === 200 && r.json.suspectedRemoved === true) return true
			const s = await Api(FedB, 'GET', `/groups/${gid}/state`, undefined, { timeoutSec: REQ_TIMEOUT_SEC })
			const peers = await Api(FedB, 'GET', `/groups/${gid}/peers`, undefined, { timeoutSec: REQ_TIMEOUT_SEC })
			diag = {
				catchupStatus: r.status,
				suspected: s.status === 200 ? s.json.viewer?.suspectedRemoved : null,
				bannedSelf: s.status === 200 ? s.json.meta?.bannedMembers?.length : null,
				peerCount: peers.status === 200 ? peers.json.peers?.length : null,
				memberCount: s.status === 200 ? s.json.meta?.memberCount : null,
			}
			return s.status === 200 && s.json.viewer?.suspectedRemoved === true
		}, 4000),
	)
	if (!ok) throw new Error(`B must suspect removal after shuns from known member nodes ${JSON.stringify(diag)}`)
	return true
})

await requireCase('B state does not materialize ban event locally', async () => {
	const s = await Api(FedB, 'GET', `/groups/${gid}/state`, undefined, { timeoutSec: REQ_TIMEOUT_SEC })
	if (s.status !== 200) throw new Error(`state ${s.status}`)
	return (s.json.meta?.bannedMembers?.filter(m => m.memberKey === bPub).length ?? 0) === 0
})

console.log('\n=== 5. B cannot send; A roster clean ===')
await testCase('B POST message rejected after suspectedRemoved (403)', async () => {
	const ok = await retryUntil(15, async () => {
		const s = await Api(FedB, 'GET', `/groups/${gid}/state`, undefined, { timeoutSec: REQ_TIMEOUT_SEC })
		if (s.status !== 200 || s.json.viewer?.suspectedRemoved !== true) return false
		const r = await Api(FedB, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
			content: { content: 'banned-attempt' },
		}, { timeoutSec: REQ_TIMEOUT_SEC })
		return r.status === 403
	})
	if (!ok) throw new Error('B must be suspectedRemoved and get 403 on POST message')
	return true
})

await testCase('A channel has no banned-attempt message', async () => {
	const ok = await retryUntil(15, async () => {
		await Api(FedA, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('3s') }, { timeoutSec: REQ_TIMEOUT_SEC })
		const m = await Api(FedA, 'GET', `/groups/${gid}/channels/${cid}/messages?limit=80`, undefined, { timeoutSec: REQ_TIMEOUT_SEC })
		if (m.status !== 200) return false
		return (m.json.messages?.filter(row => String(row.content?.content).includes('banned-attempt')).length ?? 0) === 0
	})
	return Boolean(ok)
})

await testCase('A events keep member_ban and no unban rollback', async () => {
	const ev = await Api(FedA, 'GET', `/groups/${gid}/events?limit=60`, undefined, { timeoutSec: REQ_TIMEOUT_SEC })
	if (ev.status !== 200) return false
	const banN = ev.json.events?.filter(e => e.type === 'member_ban').length ?? 0
	const unbanN = ev.json.events?.filter(e => e.type === 'member_unban').length ?? 0
	return banN >= 1 && unbanN === 0
})

await testCase('A can still send after ban', async () => {
	const r = await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
		content: { content: 'after-ban-A' },
	}, { timeoutSec: REQ_TIMEOUT_SEC })
	return r.status === 201
})

// purge 后仍有 in-flight 异步链（signer 加载）会打印 `group replica is being purged`；
// 窗口内留 drainMs 让尾巴落进豁免区，避免套件判 noisy。
await allowNoise('group replica is being purged', () => ClearFedGroup(gid), { drainMs: ms('2s') })
WriteFedSummary('FED-BAN', gid)
completeLiveScript()
