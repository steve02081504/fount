/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	createFolderEncryption,
	decryptJson,
	encryptJson,
	unlockFolderKey,
} from '../../src/passwordFolder.mjs'
import { clearUnlockTokensForTests, issueUnlockToken, resolveUnlockToken } from '../../src/unlockTokens.mjs'

Deno.test('folder password wrap/unwrap', () => {
	const created = createFolderEncryption('secret-pass')
	const key = unlockFolderKey('secret-pass', {
		salt: created.salt,
		wrapped_folder_key: created.wrapped_folder_key,
		check: created.check,
	})
	assertEquals(key.equals(created.folder_key), true)
	assertThrows(() => unlockFolderKey('wrong', {
		salt: created.salt,
		wrapped_folder_key: created.wrapped_folder_key,
		check: created.check,
	}))
})

Deno.test('encryptJson roundtrip', () => {
	const key = Buffer.alloc(32, 7)
	const envelope = encryptJson(key, { hello: 'world' })
	const plain = JSON.parse(decryptJson(key, envelope))
	assertEquals(plain.hello, 'world')
})

Deno.test('unlock token scoped and refreshable', () => {
	clearUnlockTokensForTests()
	const folderKey = Buffer.from('0123456789abcdef0123456789abcdef')
	const token = issueUnlockToken({
		folder_key: folderKey,
		cabinet_id: 'c1',
		folder_id: 'f1',
		entity_hash: 'e1',
	})
	assertEquals(resolveUnlockToken(token, { cabinet_id: 'c1', folder_id: 'f1', entity_hash: 'e1' })?.equals(folderKey), true)
	assertEquals(resolveUnlockToken(token, { cabinet_id: 'c2', folder_id: 'f1', entity_hash: 'e1' }), null)
	assertEquals(resolveUnlockToken('bad', { cabinet_id: 'c1', folder_id: 'f1', entity_hash: 'e1' }), null)
})
