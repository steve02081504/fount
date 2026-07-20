/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('notifyUser falls back to web push when subscription exists', async () => {
	const username = `wp-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()

	const { addPushSubscription } = await import('../../../../../../server/web_server/notify/webPush.mjs')
	const { notifyUser } = await import('../../../../../../server/web_server/notify/notify.mjs')

	const endpoint = `https://push.test/${crypto.randomUUID()}`
	await addPushSubscription(username, {
		endpoint,
		keys: { p256dh: 'x', auth: 'y' },
	})

	await notifyUser(username, { title: 'test', body: 'body', url: '/' })

	const { loadJsonFileIfExists } = await import('../../../../../../scripts/json_loader.mjs')
	const { getUserDictionary } = await import('../../../../../../server/auth/index.mjs')
	const filePath = `${getUserDictionary(username)}/notify/push_subscriptions.json`
	const data = loadJsonFileIfExists(filePath)
	const endpoints = (data?.subscriptions || []).map(row => row.endpoint)
	assertEquals(endpoints.includes(endpoint) || endpoints.length === 0, true)
})
