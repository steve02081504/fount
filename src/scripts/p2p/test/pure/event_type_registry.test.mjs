/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	clearEventTypeRegistry,
	getGovernanceAuthzTypes,
	getPermissionAnchorTypes,
	mergedEventTypeDefs,
	registerEventTypeDefs,
	typesWithFlag,
	unregisterEventTypeDefs,
} from '../../event_type_registry.mjs'

Deno.test('mergedEventTypeDefs merges owners with later owner overriding', () => {
	clearEventTypeRegistry()
	registerEventTypeDefs('a', {
		message: { gcExclude: true },
		slash: { governance: true },
	})
	registerEventTypeDefs('b', {
		message: { permissionAnchor: true },
	})
	try {
		assertEquals(mergedEventTypeDefs(), {
			message: { permissionAnchor: true },
			slash: { governance: true },
		})
	}
	finally {
		clearEventTypeRegistry()
	}
})

Deno.test('typesWithFlag aggregates flags across merged defs', () => {
	clearEventTypeRegistry()
	registerEventTypeDefs('a', {
		slash: { governance: true },
		invite: { permissionAnchor: true },
	})
	try {
		assertEquals([...getGovernanceAuthzTypes()], ['slash'])
		assertEquals([...getPermissionAnchorTypes()], ['invite'])
		assertEquals([...typesWithFlag('gcExclude')], [])
	}
	finally {
		clearEventTypeRegistry()
	}
})

Deno.test('unregisterEventTypeDefs removes owner defs', () => {
	clearEventTypeRegistry()
	registerEventTypeDefs('a', { message: { gcExclude: true } })
	unregisterEventTypeDefs('a')
	assertEquals(mergedEventTypeDefs(), {})
})
