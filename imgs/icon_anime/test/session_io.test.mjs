/**
 * session `setIO` 返回命名空间，供 `setIO(io).intro()` 链式调用。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import * as icon from '../session.mjs'

Deno.test('setIO returns the session namespace for chaining', () => {
	assertEquals(icon.setIO({}), icon)
})
