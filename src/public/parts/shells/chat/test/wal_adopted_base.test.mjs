/**
 * WAL 对采纳态 base checkpoint + 不完整 DAG 的放行测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { verifyEventsSnapshotWAL } from '../src/chat/dag/wal.mjs'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const SIG = 'f'.repeat(128)

/**
 * @param {string} anchorId checkpoint 锚点事件 id
 * @returns {object} 最小 signed base checkpoint 桩
 */
function signedBaseCheckpoint(anchorId) {
	return {
		checkpoint_event_id: anchorId,
		checkpoint_signature: SIG,
		members_record: { members: {} },
		dag_tip_ids: [anchorId],
	}
}

Deno.test('verifyEventsSnapshotWAL: adopted base with anchor absent from events', async () => {
	const result = await verifyEventsSnapshotWAL('u', 'g', signedBaseCheckpoint(A), [
		{ id: B, prev_event_ids: [A] },
	])
	assertEquals(result.ok, true)
	assertEquals(result.forceFullReplay, undefined)
})

Deno.test('verifyEventsSnapshotWAL: adopted base with dangling parents passes', async () => {
	const result = await verifyEventsSnapshotWAL('u', 'g', signedBaseCheckpoint(A), [
		{ id: A, prev_event_ids: [] },
		{ id: C, prev_event_ids: [B] },
	])
	assertEquals(result.ok, true)
	assertEquals(result.forceFullReplay, undefined)
})

Deno.test('verifyEventsSnapshotWAL: adopted base with anchor pulled back but no longer a tip stays protected', async () => {
	// 锚点 A 已被 gossip 拉回且 DAG 自洽（无悬挂父），但本地又长出 B（A 不再是叶）。
	// 这是 catch-up 常态：基态仍权威，禁止 forceFullReplay（否则滤没基态成员）。
	const result = await verifyEventsSnapshotWAL('u', 'g', signedBaseCheckpoint(A), [
		{ id: A, prev_event_ids: [] },
		{ id: B, prev_event_ids: [A] },
	])
	assertEquals(result.ok, true)
	assertEquals(result.forceFullReplay, undefined)
})

Deno.test('verifyEventsSnapshotWAL: adopted base with dag_tip_ids mismatch stays protected', async () => {
	// checkpoint.dag_tip_ids=[A] 但本地叶为 [B,C]：未对齐属正常中间态，仍受基态保护。
	const checkpoint = signedBaseCheckpoint(A)
	const result = await verifyEventsSnapshotWAL('u', 'g', checkpoint, [
		{ id: A, prev_event_ids: [] },
		{ id: B, prev_event_ids: [A] },
		{ id: C, prev_event_ids: [A] },
	])
	assertEquals(result.ok, true)
	assertEquals(result.forceFullReplay, undefined)
})

Deno.test('verifyEventsSnapshotWAL: adopted base aligned with local tips runs normal verification', async () => {
	// supersede 退出：本地叶集合与 dag_tip_ids 完全对齐（锚点即唯一叶）→ 真正追平，
	// 不再走基态保护而走常规校验；此处常规校验也通过 → ok 且不 forceFullReplay。
	const result = await verifyEventsSnapshotWAL('u', 'g', signedBaseCheckpoint(A), [
		{ id: A, prev_event_ids: [] },
	])
	assertEquals(result.ok, true)
	assertEquals(result.forceFullReplay, undefined)
})

Deno.test('verifyEventsSnapshotWAL: unsigned checkpoint with stale anchor forces replay', async () => {
	// 未签名 checkpoint 不享受采纳基态保护：本地 DAG 完整，强制全量重放是安全且正确的修复。
	const result = await verifyEventsSnapshotWAL('u', 'g', {
		checkpoint_event_id: A,
		dag_tip_ids: [A],
	}, [
		{ id: A, prev_event_ids: [] },
		{ id: B, prev_event_ids: [A] },
	])
	assertEquals(result.ok, false)
	assertEquals(result.forceFullReplay, true)
})

Deno.test('verifyEventsSnapshotWAL: unsigned checkpoint aligned with local tips passes', async () => {
	const result = await verifyEventsSnapshotWAL('u', 'g', {
		checkpoint_event_id: A,
		dag_tip_ids: [A],
	}, [
		{ id: A, prev_event_ids: [] },
	])
	assertEquals(result.ok, true)
	assertEquals(result.forceFullReplay, undefined)
})
