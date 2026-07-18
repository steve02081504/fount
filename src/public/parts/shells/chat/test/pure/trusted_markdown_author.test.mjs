/**
 * 可信 Markdown 作者判定：本人 / 本机 char 实体 / 声明的主人 / 信任表。
 * 远端自声明 ownerEntityHash 不升档。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

const {
	isSelfOrLocalAgentEntity,
	isViewerDeclaredOwner,
	isTrustedMarkdownAuthor,
} = await import('../../public/src/trustedAuthors.mjs')

const SELF = 'a'.repeat(128)
const AGENT = 'b'.repeat(128)
const MASTER = 'c'.repeat(128)
const STRANGER = 'd'.repeat(128)
const NODE = 'e'.repeat(64)

Deno.test('isSelfOrLocalAgentEntity: self only', () => {
	assertEquals(isSelfOrLocalAgentEntity(SELF, { selfEntityHash: SELF }), true)
	assertEquals(isSelfOrLocalAgentEntity(STRANGER, { selfEntityHash: SELF }), false)
})

Deno.test('isSelfOrLocalAgentEntity: remote owner claim does not count', () => {
	assertEquals(isSelfOrLocalAgentEntity(AGENT, {
		selfEntityHash: SELF,
		authorOwnerEntityHash: SELF,
	}), false)
})

Deno.test('isSelfOrLocalAgentEntity: local node prefix', () => {
	const local = `${NODE}${'f'.repeat(64)}`
	assertEquals(isSelfOrLocalAgentEntity(local, { nodeHash: NODE }), true)
	assertEquals(isSelfOrLocalAgentEntity(STRANGER, { nodeHash: NODE }), false)
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

Deno.test('spoofed ownerEntityHash does not elevate via self/master gates', () => {
	assertEquals(isSelfOrLocalAgentEntity(STRANGER, {
		selfEntityHash: SELF,
		authorOwnerEntityHash: SELF,
	}), false)
	assertEquals(isViewerDeclaredOwner(STRANGER, {
		viewerOwnerEntityHash: MASTER,
	}), false)
})
