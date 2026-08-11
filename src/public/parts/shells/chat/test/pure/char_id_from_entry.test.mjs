/**
 * charIdFromChatLogEntry：world greeting 不得把展示名（含 chars/undefined basename 伪影）当成 charId。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { charIdFromChatLogEntry } from '../../src/chat/lib/charIdFromEntry.mjs'

Deno.test('world greeting（无 charname）→ charId null，即使 name 为 undefined 伪影', () => {
	assertEquals(charIdFromChatLogEntry({
		role: 'char',
		name: 'undefined',
		extension: { timeSlice: { greeting_type: 'world_single', charname: undefined } },
	}), null)
	assertEquals(charIdFromChatLogEntry({
		role: 'char',
		name: 'Unknown',
		extension: { timeSlice: { greeting_type: 'world_single' } },
	}), null)
})

Deno.test('角色消息用 timeSlice.charname，不用展示 name', () => {
	assertEquals(charIdFromChatLogEntry({
		role: 'char',
		name: '写路径 Agent',
		extension: { timeSlice: { charname: 'write_path_agent' } },
	}), 'write_path_agent')
	assertEquals(charIdFromChatLogEntry({
		role: 'user',
		name: 'write_path_agent',
		extension: { timeSlice: {} },
	}), null)
})
