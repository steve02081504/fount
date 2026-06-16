/**
 * EVFS chunk + manifest 单元测试（Deno）。
 */
/* global Deno */
import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { groupEntityHash, isGroupEntityHash, GROUP_SENTINEL_NODE_HASH } from '../entity/group_entity.mjs'
import { assertSafeEvfsLogicalPath } from '../evfs_logical_path.mjs'
import { encryptPlaintextToParts, buildFileManifest } from '../files/assemble.mjs'
import { normalizeFileManifest } from '../files/manifest.mjs'
import { assembleManifestPlaintext } from '../files/transfer_key.mjs'

const TEST_ENTITY = `${'a'.repeat(64)}${'b'.repeat(64)}`
const TEST_GROUP = 'test-group-uuid'

Deno.test('groupEntityHash uses sentinel node', () => {
	const eh = groupEntityHash(TEST_GROUP)
	assertEquals(eh.slice(0, 64), GROUP_SENTINEL_NODE_HASH)
	assertEquals(isGroupEntityHash(eh), true)
})

Deno.test('convergent encrypt-decrypt roundtrip via manifest', async () => {
	const plain = new TextEncoder().encode('hello evfs')
	const enc = encryptPlaintextToParts(plain, 'convergent')
	const manifest = buildFileManifest({
		ownerEntityHash: TEST_ENTITY,
		logicalPath: 'shells/chat/attachments/test',
		plaintext: plain,
		mimeType: 'text/plain',
		ceMode: 'convergent',
	})
	const assembled = await assembleManifestPlaintext(manifest, enc.parts.map(part => part.raw), {})
	assertEquals(assembled?.toString(), 'hello evfs')
})

Deno.test('normalizeFileManifest rejects invalid parts', () => {
	assertEquals(normalizeFileManifest({ ownerEntityHash: 'bad', logicalPath: 'x', parts: [] }), null)
})

Deno.test('assertSafeEvfsLogicalPath rejects traversal', () => {
	assertEquals(assertSafeEvfsLogicalPath('shells/chat/foo'), 'shells/chat/foo')
	assertThrows(() => assertSafeEvfsLogicalPath('../etc/passwd'), Error)
	assertThrows(() => assertSafeEvfsLogicalPath('foo/../../bar'), Error)
	assertThrows(() => assertSafeEvfsLogicalPath(''), Error)
})

Deno.test('parseEvfsRef rejects malformed refs', async () => {
	const { parseEvfsRef, formatEvfsRef } = await import('../entity/files/evfs_ref.mjs')
	assertEquals(parseEvfsRef('evfs:abc'), null)
	assertEquals(parseEvfsRef('evfs://'), null)
	const ref = formatEvfsRef(TEST_ENTITY, 'shells/chat/x')
	assertEquals(parseEvfsRef(ref)?.entityHash, TEST_ENTITY)
})

Deno.test('manifest acl registry is fail-closed', async () => {
	const { checkManifestAcl } = await import('../entity/files/manifest_acl_registry.mjs')
	assertEquals(await checkManifestAcl('vault-wrap', { replicaUsername: 'u', ownerEntityHash: 'x', manifest: {} }), false)
	assertEquals(await checkManifestAcl('file-master-key-wrap', { replicaUsername: 'u', ownerEntityHash: 'x', manifest: {} }), false)
})

Deno.test('nodeHashFromSeed is stable', async () => {
	const { nodeHashFromSeed } = await import('../entity/node_hash.mjs')
	const seed = 'a'.repeat(64)
	assertEquals(nodeHashFromSeed(seed), nodeHashFromSeed(seed))
	assertEquals(nodeHashFromSeed(seed) !== nodeHashFromSeed('b'.repeat(64)), true)
})
