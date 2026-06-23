/**
 * TrustGraph 注册表单元测试（Deno）。
 */
/* global Deno */
import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	clearTrustGraphProvider,
	DEFAULT_TRUST_GRAPH_OWNER,
	registerTrustGraphProvider,
	requireTrustGraphProvider,
} from '../trust_graph_registry.mjs'

const TEST_USER = '__p2p_trust_graph_test__'

/**
 * 返回空信任图。
 * @returns {Promise<Map<string, never>>} empty trust graph
 */
async function buildMergedGraph() {
	return new Map()
}

/**
 * 返回空节点列表。
 * @returns {Promise<never[]>} no nodes
 */
async function pickTopNodes() {
	return []
}

/**
 * 返回发送结果。
 * @returns {Promise<boolean>} send result
 */
async function sendToNode() {
	return false
}

/**
 * 返回扇出数量。
 * @returns {Promise<number>} fanout count
 */
async function fanoutToTopNodes() {
	return 0
}

Deno.test('trust graph registry register and require', async () => {
	clearTrustGraphProvider()
	assertThrows(() => requireTrustGraphProvider('test'), Error, 'registerTrustGraphProvider')
	registerTrustGraphProvider('test', { buildMergedGraph, pickTopNodes, sendToNode, fanoutToTopNodes })
	assertEquals(await requireTrustGraphProvider('test').fanoutToTopNodes(TEST_USER, 'part_invoke', {}, 1), 0)
	clearTrustGraphProvider()
})

Deno.test('default owner id is not chat', () => {
	assertEquals(DEFAULT_TRUST_GRAPH_OWNER, 'default')
})
