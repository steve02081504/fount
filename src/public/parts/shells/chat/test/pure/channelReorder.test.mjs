/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	buildMoveLinks,
	computeMoveOperation,
	DROP_PLACEMENT,
	findParentChannelId,
	isInSubtree,
} from '../../public/shared/channelReorder.mjs'

const ROOT = 'root'

/**
 * 构造一个频道树：root 下 [catA, catB, ch]，catA 下 [catA1]。
 * @returns {Record<string, { type: string, name: string, links: string[] }>} 频道表
 */
function makeChannels() {
	return {
		[ROOT]: { type: 'category', name: '', links: ['catA', 'catB', 'ch'] },
		catA: { type: 'category', name: '媒体', links: ['catA1'] },
		catA1: { type: 'text', name: '子频道', links: [] },
		catB: { type: 'category', name: '杂谈', links: [] },
		ch: { type: 'text', name: 'general', links: [] },
	}
}

Deno.test('findParentChannelId resolves from links; falls back to root', () => {
	const channels = makeChannels()
	assertEquals(findParentChannelId(channels, ROOT, 'catB'), ROOT)
	assertEquals(findParentChannelId(channels, ROOT, 'catA1'), 'catA')
	assertEquals(findParentChannelId(channels, ROOT, 'unknown'), ROOT)
})

Deno.test('isInSubtree checks nested membership incl self', () => {
	const channels = makeChannels()
	assertEquals(isInSubtree(channels, 'catA', 'catA'), true)
	assertEquals(isInSubtree(channels, 'catA', 'catA1'), true)
	assertEquals(isInSubtree(channels, 'catA', 'catB'), false)
})

Deno.test('move INTO target category prepends to its links', () => {
	const channels = makeChannels()
	const op = computeMoveOperation(channels, ROOT, 'catB', 'catA', DROP_PLACEMENT.INTO)
	assertEquals(op, { sourceParentId: ROOT, targetParentId: 'catA', targetIndex: 0, placement: 'into' })
	const { sourceLinks, targetLinks } = buildMoveLinks(channels, op, 'catB')
	assertEquals(sourceLinks, ['catA', 'ch'])
	assertEquals(targetLinks, ['catB', 'catA1'])
})

Deno.test('move BEFORE sibling targets parent index', () => {
	const channels = makeChannels()
	// 把 catA 放到 ch 之前（root 下索引 2 → 移到 2 位置前，即 ch 的位置）
	const op = computeMoveOperation(channels, ROOT, 'catA', 'ch', DROP_PLACEMENT.BEFORE)
	assertEquals(op.sourceParentId, ROOT)
	assertEquals(op.targetParentId, ROOT)
	assertEquals(op.targetIndex, 2)
	const { targetLinks } = buildMoveLinks(channels, op, 'catA')
	assertEquals(targetLinks, ['catB', 'catA', 'ch'])
})

Deno.test('move AFTER sibling targets index+1', () => {
	const channels = makeChannels()
	const op = computeMoveOperation(channels, ROOT, 'catA', 'catB', DROP_PLACEMENT.AFTER)
	assertEquals(op.targetParentId, ROOT)
	assertEquals(op.targetIndex, 2)
	const { targetLinks } = buildMoveLinks(channels, op, 'catA')
	assertEquals(targetLinks, ['catB', 'catA', 'ch'])
})

Deno.test('move nested channel out of its parent updates both links', () => {
	const channels = makeChannels()
	const op = computeMoveOperation(channels, ROOT, 'catA1', 'ch', DROP_PLACEMENT.AFTER)
	assertEquals(op.sourceParentId, 'catA')
	assertEquals(op.targetParentId, ROOT)
	assertEquals(op.targetIndex, 3)
	const { sourceLinks, targetLinks } = buildMoveLinks(channels, op, 'catA1')
	assertEquals(sourceLinks, [])
	assertEquals(targetLinks, ['catA', 'catB', 'ch', 'catA1'])
})

Deno.test('move to root when target is null', () => {
	const channels = makeChannels()
	const op = computeMoveOperation(channels, ROOT, 'catA1', null, DROP_PLACEMENT.ROOT)
	assertEquals(op, { sourceParentId: 'catA', targetParentId: ROOT, targetIndex: 0, placement: 'root' })
})

Deno.test('rejects self-move and move into own subtree', () => {
	const channels = makeChannels()
	assertEquals(computeMoveOperation(channels, ROOT, 'catA', 'catA', DROP_PLACEMENT.INTO), null)
	assertEquals(computeMoveOperation(channels, ROOT, 'catA', 'catA1', DROP_PLACEMENT.INTO), null)
	// 把 catA 移到其自身子树内的频道之前 → 环
	assertEquals(computeMoveOperation(channels, ROOT, 'catA', 'catA1', DROP_PLACEMENT.BEFORE), null)
})

Deno.test('reject moving root container', () => {
	const channels = makeChannels()
	// 移动根容器本身到 catA 之前：sourceParentId=root，targetParentId=root，成环拒绝。
	assertEquals(computeMoveOperation(channels, ROOT, ROOT, 'catA', DROP_PLACEMENT.BEFORE), null)
})
