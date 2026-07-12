/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	encodeEntityHash,
	isEntityHash128,
	parseEntityHash,
} from '../../entity_id_parse.mjs'
import {
	encodeEntityHash as encodePages,
	isEntityHash128 as isEntityHash128Pages,
	parseEntityHash as parsePages,
} from '../../../../public/pages/scripts/p2p/entity_id_parse.mjs'
import { extractMentionEntityHashes } from '../../../../public/pages/scripts/p2p/mentions.mjs'

const NODE = 'b'.repeat(64)
const SUBJECT = 'c'.repeat(64)
const ENTITY = NODE + SUBJECT

Deno.test('entity_id_parse package mirrors pages implementation', () => {
	assertEquals(isEntityHash128(ENTITY), isEntityHash128Pages(ENTITY))
	assertEquals(parseEntityHash(ENTITY), parsePages(ENTITY))
	assertEquals(encodeEntityHash(NODE, SUBJECT), encodePages(NODE, SUBJECT))
})

Deno.test('pages mentions extract @entityHash', () => {
	const text = `hello @${ENTITY} world`
	assertEquals(extractMentionEntityHashes(text), [ENTITY])
})
