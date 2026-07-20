/**
 * profile banner 字段往返。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const { ensureServer, username } = createIntegrationBoot({
	username: 'profile-banner-user',
	minP2pNode: true,
})

Deno.test('updateProfile stores and clears top-level banner', async () => {
	await ensureServer()
	const { resolveOperatorEntityHashForUser } = await import('../../src/entity/identity.mjs')
	const { getProfile, updateProfile } = await import('../../src/entity/profile.mjs')
	const { profileBannerFileUrl } = await import('../../src/entity/filesUrl.mjs')

	const entityHash = await resolveOperatorEntityHashForUser(username)
	const bannerUrl = profileBannerFileUrl(entityHash)

	const withBanner = await updateProfile(username, entityHash, {
		banner: bannerUrl,
		localized: {
			'zh-CN': {
				name: '横幅用户',
				tags: ['测试'],
				links: [{ name: '站', url: 'https://example.test' }],
			},
		},
	})
	assertEquals(withBanner.banner, bannerUrl)
	assertEquals(withBanner.tags, ['测试'])
	assertEquals(withBanner.links[0]?.url, 'https://example.test')

	const cleared = await updateProfile(username, entityHash, {
		banner: '',
		localized: {
			'zh-CN': {
				name: '横幅用户',
				tags: [],
				links: [],
			},
		},
	})
	assertEquals(cleared.banner, '')
	assertEquals(cleared.tags, [])
	assertEquals(cleared.links, [])

	const reread = await getProfile(entityHash, username)
	assertEquals(reread.banner, '')
	assertEquals(reread.tags, [])
})
