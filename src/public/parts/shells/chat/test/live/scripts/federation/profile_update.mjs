/**
 * 双节点复现/验收：A 更新 profile 后，B 能「当时」感知。
 *  - B 先缓存 A 旧 profile（陈旧 manifest）→ A 更新 → B `forceRemote` 必须一次读到新值（revalidate 跳过 manifest 缓存）。
 *  - 随后 B 无需强刷，经 `profile_update` 广播（user-room node scope）自动感知。
 */
import { ms } from 'fount/scripts/ms.mjs'
import { sleep } from 'fount/scripts/test/core/wait.mjs'
import {
	completeLiveScript,
	FedA,
	FedB,
	P2pApi,
	pollUntil,
	ShellApi,
	testCase,
	WarmupFedNodeLinks,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

let viewerA = null
let newHandle = null

console.log('\n=== Setup: federation identity + link warmup ===')
await testCase('federation identity ready on A/B', async () => {
	const fa = await P2pApi(FedA, 'GET', '/federation')
	const fb = await P2pApi(FedB, 'GET', '/federation')
	return fa.status === 200 && fb.status === 200 && fa.json.activePubKeyHex && fb.json.activePubKeyHex
})
await WarmupFedNodeLinks([FedA, FedB])
await sleep(ms('5s'))

console.log('\n=== B caches A operator profile (old value) ===')
await testCase('B fetches A profile (primes stale manifest cache)', async () => {
	const r = await ShellApi(FedA, 'chat', 'GET', '/viewer')
	viewerA = r.json.viewerEntityHash
	if (!viewerA) throw new Error('no viewerEntityHash on A')
	const first = await ShellApi(FedB, 'chat', 'GET', `/entities/${viewerA}`)
	return first.status === 200
})

console.log('\n=== A updates profile (handle) ===')
await testCase('A updates profile handle', async () => {
	newHandle = `pfu-${Date.now().toString(36)}`
	const r = await ShellApi(FedA, 'chat', 'PUT', `/entities/${viewerA}`, {
		handle: newHandle,
		localized: { 'zh-CN': { name: '联邦用户' } },
	})
	return r.status === 200 && r.json.profile?.handle === newHandle
})

console.log('\n=== B forceRemote observes the update (manifest revalidate) ===')
await testCase('B GET forceRemote sees new handle', async () => {
	if (!newHandle) throw new Error('A update step must run first')
	const ok = await pollUntil(async () => {
		const r = await ShellApi(FedB, 'chat', 'GET', `/entities/${viewerA}?forceRemote=1`)
		return r.status === 200 && r.json.profile?.handle === newHandle
	}, 90, 3)
	if (!ok) throw new Error('B forceRemote must observe A profile update (stale manifest cache bypassed)')
	return true
})

console.log('\n=== B receives profile_update broadcast (push, no force) ===')
await testCase('B eventually sees new handle via broadcast', async () => {
	if (!newHandle) throw new Error('A update step must run first')
	const ok = await pollUntil(async () => {
		const r = await ShellApi(FedB, 'chat', 'GET', `/entities/${viewerA}`)
		return r.status === 200 && r.json.profile?.handle === newHandle
	}, 120, 5)
	if (!ok) throw new Error('B must observe A profile update via profile_update broadcast')
	return true
})

WriteFedSummary('FED-PROFILE-UPDATE', viewerA)
completeLiveScript()
