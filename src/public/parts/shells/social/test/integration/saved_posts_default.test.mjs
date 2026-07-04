/**
 * 收藏夹默认结构单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { loadSavedPosts } from '../../src/savedPosts.mjs'

Deno.test('loadSavedPosts returns empty structure when file missing', async () => {
	const data = await loadSavedPosts('__social_saved_posts_missing_user__')
	assertEquals(data.folders, {})
	assertEquals(data.unfiled, [])
})
