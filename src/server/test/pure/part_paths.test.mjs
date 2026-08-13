/**
 * part 路径 ↔ `/parts/…` URL 纯转换单元测试。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	PART_PUBLIC_DIR,
	parsePartsUrlPath,
	partpathToUrlPartKey,
	partpathToUrlPrefix,
	partPublicRelToBrowserPath,
	urlPartKeyToPartpath,
} from '../../../scripts/part_paths.mjs'

Deno.test('partpathToUrlPartKey maps shells/chat', () => {
	assertEquals(partpathToUrlPartKey('shells/chat'), 'shells:chat')
})

Deno.test('partpathToUrlPrefix maps shells/chat', () => {
	assertEquals(partpathToUrlPrefix('shells/chat'), '/parts/shells:chat')
})

Deno.test('urlPartKeyToPartpath roundtrips colon key', () => {
	assertEquals(urlPartKeyToPartpath('shells:chat'), 'shells/chat')
})

Deno.test('partPublicRelToBrowserPath maps public hub file', () => {
	assertEquals(
		partPublicRelToBrowserPath('shells/chat/public/hub/x.mjs'),
		'/parts/shells:chat/hub/x.mjs',
	)
})

Deno.test('parsePartsUrlPath roundtrips public hub URL', () => {
	assertEquals(parsePartsUrlPath('/parts/shells:chat/hub/x.mjs'), {
		partpath: 'shells/chat',
		filepath: 'hub/x.mjs',
	})
})

Deno.test('PART_PUBLIC_DIR is public', () => {
	assertEquals(PART_PUBLIC_DIR, 'public')
})
