/**
 * friendBindingMatches：entityHash / charname 匹配。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { friendBindingMatches } from '../../public/shared/friendBinding.mjs'

Deno.test('friendBindingMatches by entityHash or charname', () => {
	assertEquals(friendBindingMatches(null, { entityHash: 'a' }), false)
	assertEquals(friendBindingMatches({ entityHash: 'aa' }, { entityHash: 'aa' }), true)
	assertEquals(friendBindingMatches({ entityHash: 'aa' }, { entityHash: 'bb' }), false)
	assertEquals(friendBindingMatches({ charname: 'Alice' }, { charname: 'Alice' }), true)
	assertEquals(friendBindingMatches({ charname: 'Alice' }, { charname: 'Bob' }), false)
	assertEquals(friendBindingMatches({ entityHash: 'aa', charname: 'Alice' }, { charname: 'Alice' }), true)
})
