/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { extractMentionEntityHashes as extractBackend } from '../../mentions.mjs'
import { extractMentionEntityHashes as extractPages } from '../../../../public/pages/scripts/p2p/mentions.mjs'

const ENTITY = 'a'.repeat(128)
const TEXT = `hello @${ENTITY} world`

Deno.test('mentions backend re-exports pages implementation', () => {
	assertEquals(extractBackend(TEXT), extractPages(TEXT))
	assertEquals(extractBackend(TEXT), [ENTITY])
})
