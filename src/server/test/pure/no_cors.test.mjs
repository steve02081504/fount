/**
 * no-cors 请求头装配纯函数测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { buildUpstreamHeaders, isNoCorsPath } from '../../no_cors.mjs'

Deno.test('isNoCorsPath only matches exact route', () => {
	assertEquals(isNoCorsPath('/api/no-cors'), true)
	assertEquals(isNoCorsPath('/api/no-cors/'), false)
	assertEquals(isNoCorsPath('/api/ping'), false)
})

Deno.test('buildUpstreamHeaders forwards Range and No-Cors-* injects Cookie/Authorization', () => {
	const headers = buildUpstreamHeaders(/** @type {any} */{
		headers: {
			range: 'bytes=0-99',
			'content-type': 'application/octet-stream',
			cookie: 'fount_session=secret',
			'fount-apikey': 'leak',
			authorization: 'Bearer fount-token',
			'no-cors-cookie': 'a=1; b=2',
			'no-cors-authorization': 'Bearer upstream',
			'no-cors-x-custom': 'yes',
			'x-random': 'nope',
			host: 'localhost:9999',
			connection: 'keep-alive',
		},
	})
	assertEquals(headers.get('range'), 'bytes=0-99')
	assertEquals(headers.get('content-type'), 'application/octet-stream')
	assertEquals(headers.get('cookie'), 'a=1; b=2')
	assertEquals(headers.get('authorization'), 'Bearer upstream')
	assertEquals(headers.get('x-custom'), 'yes')
	assertEquals(headers.get('host'), null)
	assertEquals(headers.has('fount-apikey'), false)
	assertEquals(headers.has('connection'), false)
	assertEquals(headers.has('x-random'), false)
})
