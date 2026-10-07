/* global Deno */
import { assertEquals, assertThrows } from 'jsr:@std/assert'

import { formatChatDmShareUrl, formatDmRunUri, wrapProtocolHttpsUrl } from '../../../chat/public/shared/runUri.mjs'
import { parseInvitationLink } from '../../public/shared/invitationLink.mjs'

const nodeHash = 'a'.repeat(64)
const entityHash = nodeHash + 'b'.repeat(64)

Deno.test('invitation accepts copied localhost, remote, relative and protocol contact links', () => {
	for (const link of [
		`http://localhost:8931/parts/shells:chat/hub/?contact=${entityHash}`,
		`https://example.com/parts/shells:chat/hub/?contact=${entityHash}`,
		`/parts/shells:chat/hub/?contact=${entityHash}`,
		`fount://page/parts/shells:chat/hub/?contact=${entityHash}`,
		formatChatDmShareUrl(entityHash),
	]) assertEquals(parseInvitationLink(` ${link} `), { entityHash, nodeHash })
})

Deno.test('invitation preserves signed DM proof and inviter identity', () => {
	const input = { pubKeyHex: 'c'.repeat(64), nonceBase64Url: 'd'.repeat(24), introSignatureHex: 'e'.repeat(128), nodeHash }
	const uri = formatDmRunUri(input)
	for (const link of [uri, wrapProtocolHttpsUrl(uri)]) {
		const parsed = parseInvitationLink(link)
		assertEquals(parsed.pubKeyHex, input.pubKeyHex)
		assertEquals(parsed.nonce, input.nonceBase64Url)
		assertEquals(parsed.introSignatureHex, input.introSignatureHex)
		assertEquals(parsed.nodeHash, nodeHash)
	}
})

Deno.test('invitation rejects malformed identities and unrelated pages', () => {
	for (const link of [
		'', `http://localhost:8931/parts/shells:chat/hub/?contact=${nodeHash}`,
		`https://example.com/?contact=${entityHash}`,
		wrapProtocolHttpsUrl('fount://run/shells:chat/dm;bad;bad;bad'),
		'javascript:alert(1)',
	]) assertThrows(() => parseInvitationLink(link))
})
