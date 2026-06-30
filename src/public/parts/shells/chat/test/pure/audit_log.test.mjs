/**
 * auditLog 单测。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/chat/test/audit_log.test.mjs
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { AUDIT_LOG_EVENT_TYPES } from '../../src/chat/auditLog.mjs'

Deno.test('AUDIT_LOG_EVENT_TYPES includes governance and moderation events', () => {
	assert(AUDIT_LOG_EVENT_TYPES.has('member_ban'))
	assert(AUDIT_LOG_EVENT_TYPES.has('role_assign'))
	assert(AUDIT_LOG_EVENT_TYPES.has('message_delete'))
	assert(AUDIT_LOG_EVENT_TYPES.has('file_upload'))
	assertEquals(AUDIT_LOG_EVENT_TYPES.has('message'), false)
})
