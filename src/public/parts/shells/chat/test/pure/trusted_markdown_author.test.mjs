/**
 * 可信 Markdown 作者判定：本人 / 所属 agent / 声明的主人 / 信任表。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

const {
	isSelfOrOwnedAgentEntity,
	isViewerDeclaredOwner,
	isTrustedMarkdownAuthor,
} = await import('../../public/src/trustedAuthors.mjs')

const SELF = 'a'.repeat(128)
const AGENT = 'b'.repeat(128)
const MASTER = 'c'.repeat(128)
const STRANGER = 'd'.repeat(128)
const NODE = 'e'.repeat(64)

Deno.test('isSelfOrOwnedAgentEntity: self and owned agent', () => {
	assertEquals(isSelfOrOwnedAgentEntity(SELF, { selfEntityHash: SELF }), true)
	assertEquals(isSelfOrOwnedAgentEntity(AGENT, {
		selfEntityHash: SELF,
		authorOwnerEntityHash: SELF,
	}), true)
	assertEquals(isSelfOrOwnedAgentEntity(STRANGER, { selfEntityHash: SELF }), false)
})

Deno.test('isSelfOrOwnedAgentEntity: local node prefix', () => {
	const local = `${NODE}${'f'.repeat(64)}`
	assertEquals(isSelfOrOwnedAgentEntity(local, { nodeHash: NODE }), true)
	assertEquals(isSelfOrOwnedAgentEntity(STRANGER, { nodeHash: NODE }), false)
})

Deno.test('isViewerDeclaredOwner: author is viewer master', () => {
	assertEquals(isViewerDeclaredOwner(MASTER, { viewerOwnerEntityHash: MASTER }), true)
	assertEquals(isViewerDeclaredOwner('signer-key', {
		viewerOwnerEntityHash: MASTER,
		authorEntityHash: MASTER,
	}), true)
	assertEquals(isViewerDeclaredOwner(STRANGER, { viewerOwnerEntityHash: MASTER }), false)
	assertEquals(isViewerDeclaredOwner(MASTER, {}), false)
})

Deno.test('isTrustedMarkdownAuthor: declared master without trust list', async () => {
	assertEquals(await isTrustedMarkdownAuthor(MASTER, {
		selfEntityHash: SELF,
		viewerOwnerEntityHash: MASTER,
	}), true)
	assertEquals(await isTrustedMarkdownAuthor(STRANGER, {
		selfEntityHash: SELF,
		viewerOwnerEntityHash: MASTER,
		authorEntityHash: MASTER,
	}), true)
})
