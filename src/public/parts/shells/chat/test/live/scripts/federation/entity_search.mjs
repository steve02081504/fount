/**
 * 联邦双节点：A 设 handle → 链路预热 → B 按名搜索到 A → 验签含 activePubKeyHex。
 * 多跳转发正确性由 fount-p2p part_query integration 覆盖；此处验用户 room 一跳可达 + EVFS 复核闭环。
 */
import {
	Api,
	completeLiveScript,
	FedA,
	FedB,
	PollUntil,
	testCase,
	WarmupFedNodeLinks,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

const handle = `steve_${Date.now().toString(36).slice(-6)}`

console.log('=== Warmup user-room links ===')
await WarmupFedNodeLinks([FedA, FedB])

console.log(`=== NodeA: set handle=${handle} ===`)
const viewerA = await Api(FedA, 'GET', '/viewer')
if (viewerA.status !== 200 || !viewerA.json?.viewerEntityHash)
	throw new Error(`A viewer failed: ${viewerA.status} ${viewerA.raw}`)
const entityA = String(viewerA.json.viewerEntityHash).toLowerCase()
const put = await Api(FedA, 'PUT', `/entities/${entityA}`, {
	handle,
	localized: { 'zh-CN': { name: '搜人探针A' } },
})
if (put.status !== 200)
	throw new Error(`A profile put failed: ${put.status} ${put.raw}`)
const pubHandle = String(put.json?.profile?.handle || '').toLowerCase()
if (pubHandle !== handle)
	throw new Error(`A handle not saved: got ${pubHandle}`)

console.log('=== NodeB: search by handle ===')
await testCase('B finds A by handle with verified activePubKeyHex', async () => {
	const found = await PollUntil(90, 3, async () => {
		const search = await Api(FedB, 'GET', `/entities/search?q=${encodeURIComponent(handle)}&limit=20`)
		if (search.status !== 200) {
			console.log(`  search status=${search.status}`)
			return false
		}
		const entities = search.json?.entities || []
		const hit = entities.find(row => String(row.entityHash || '').toLowerCase() === entityA)
		if (!hit) {
			console.log(`  no hit yet (n=${entities.length})`)
			return false
		}
		console.log(`  hit handle=${hit.handle} name=${hit.name} pub=${String(hit.activePubKeyHex || '').slice(0, 8)}…`)
		return String(hit.handle || '').toLowerCase() === handle
			&& /^[\da-f]{64}$/i.test(String(hit.activePubKeyHex || ''))
	})
	return found
})

WriteFedSummary('FED-ENTITY-SEARCH', entityA)
completeLiveScript()
