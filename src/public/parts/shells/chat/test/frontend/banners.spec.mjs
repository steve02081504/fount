import { test, expect } from './fixtures.mjs'

test('sync status belongs to the selected group and disappears on friends and private chat surfaces', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { store, setState } = await import('/parts/shells:chat/hub/core/state.mjs')
		const { wireHubBannerBindings } = await import('/parts/shells:chat/hub/core/bindings.mjs')
		const { setSyncBanner } = await import('/parts/shells:chat/hub/banners.mjs')
		document.body.innerHTML = '<div id="sync-banner" hidden><span id="sync-banner-text"></span></div>'
		wireHubBannerBindings()
		setState('context.currentMode', 'groups')
		setState('context.currentGroupId', 'group-a')
		setSyncBanner(true, { i18nKey: 'chat.hub.sync.noPeers' })
		const visibleInGroup = !document.getElementById('sync-banner').hidden
		setState('context.currentMode', 'friends')
		const hiddenInFriends = document.getElementById('sync-banner').hidden
		setState('context.currentGroupId', 'private-group')
		const hiddenInPrivateChat = document.getElementById('sync-banner').hidden
		setState('context.currentMode', 'inbox')
		const hiddenInInbox = document.getElementById('sync-banner').hidden
		setState('context.currentMode', 'discovery')
		const hiddenInDiscovery = document.getElementById('sync-banner').hidden
		setState('context.currentMode', 'groups')
		setState('context.currentGroupId', 'group-b')
		const hiddenInOtherGroup = document.getElementById('sync-banner').hidden
		setState('context.currentGroupId', 'group-a')
		return { visibleInGroup, hiddenInFriends, hiddenInPrivateChat, hiddenInInbox, hiddenInDiscovery, hiddenInOtherGroup, hiddenOnReturn: document.getElementById('sync-banner').hidden, mode: store.context.currentMode }
	})
	expect(result).toEqual({ visibleInGroup: true, hiddenInFriends: true, hiddenInPrivateChat: true, hiddenInInbox: true, hiddenInDiscovery: true, hiddenInOtherGroup: true, hiddenOnReturn: true, mode: 'groups' })
})

test('late catch-up does not replace another group sync status', async ({ modulePage }) => {
	const page = modulePage.page
	let release
	const gate = new Promise(resolve => { release = resolve })
	const requested = page.waitForRequest(request => request.url().endsWith('/groups/group-a/federation/catchup'))
	await page.route('**/groups/group-a/federation/catchup', async route => {
		await gate
		await route.fulfill({ json: { federationActive: true, peerRosterSize: 0 } })
	})
	try {
		await modulePage.run(async () => {
			const { setState } = await import('/parts/shells:chat/hub/core/state.mjs')
			const { syncGroupFromNetwork } = await import('/parts/shells:chat/hub/sidebar/groupMembership.mjs')
			document.body.innerHTML = '<div id="sync-banner" hidden><span id="sync-banner-text"></span></div>'
			setState('context.currentMode', 'groups')
			setState('context.currentGroupId', 'group-a')
			globalThis.__pendingSync = syncGroupFromNetwork('group-a')
		})
		await requested
		await modulePage.run(async () => {
			const { setState } = await import('/parts/shells:chat/hub/core/state.mjs')
			const { setSyncBanner } = await import('/parts/shells:chat/hub/banners.mjs')
			setState('context.currentGroupId', 'group-b')
			setSyncBanner(true, { i18nKey: 'chat.hub.sync.rateLimited' })
		})
		release()
		const status = await modulePage.run(async () => {
			await globalThis.__pendingSync
			const { store } = await import('/parts/shells:chat/hub/core/state.mjs')
			return store.federation.syncBanner.i18nKey
		})
		expect(status).toBe('chat.hub.sync.rateLimited')
	}
	finally { release() }
})

test('late DAG tips cannot revive the fork banner after leaving the group', async ({ modulePage }) => {
	const page = modulePage.page
	let release
	const gate = new Promise(resolve => { release = resolve })
	const requested = page.waitForRequest(request => request.url().includes('/groups/group-a/dag/tips'))
	await page.route('**/groups/group-a/dag/tips*', async route => {
		await gate
		await route.fulfill({ json: { tips: ['a'.repeat(64), 'b'.repeat(64)] } })
	})
	try {
		await modulePage.run(async () => {
			const { setState } = await import('/parts/shells:chat/hub/core/state.mjs')
			const { refreshDagForkBanner } = await import('/parts/shells:chat/hub/banners.mjs')
			document.body.innerHTML = '<div id="fork-banner" hidden><span id="fork-banner-text"></span></div>'
			setState('context.currentMode', 'groups')
			setState('context.currentGroupId', 'group-a')
			setState('context.currentState', { isMember: true })
			globalThis.__pendingFork = refreshDagForkBanner()
		})
		await requested
		await modulePage.run(async () => {
			const { setState } = await import('/parts/shells:chat/hub/core/state.mjs')
			const { refreshDagForkBanner } = await import('/parts/shells:chat/hub/banners.mjs')
			setState('context.currentMode', 'friends')
			setState('context.currentGroupId', null)
			await refreshDagForkBanner()
		})
		release()
		const result = await modulePage.run(async () => {
			await globalThis.__pendingFork
			const { store } = await import('/parts/shells:chat/hub/core/state.mjs')
			return { hidden: document.getElementById('fork-banner').hidden, tips: store.federation.dagTips }
		})
		expect(result).toEqual({ hidden: true, tips: [] })
	}
	finally { release() }
})

test('overlapping catch-ups keep the latest result even when the older request finishes last', async ({ modulePage }) => {
	const page = modulePage.page
	let release
	let requests = 0
	const gate = new Promise(resolve => { release = resolve })
	const requested = page.waitForRequest(request => request.url().endsWith('/groups/group-a/federation/catchup'))
	await page.route('**/groups/group-a/federation/catchup', async route => {
		const first = ++requests === 1
		if (first) await gate
		await route.fulfill({ json: { federationActive: true, peerRosterSize: first ? 0 : 1 } })
	})
	try {
		await modulePage.run(async () => {
			const { setState } = await import('/parts/shells:chat/hub/core/state.mjs')
			const { syncGroupFromNetwork } = await import('/parts/shells:chat/hub/sidebar/groupMembership.mjs')
			setState('context.currentMode', 'groups')
			setState('context.currentGroupId', 'group-a')
			globalThis.__pendingSync = syncGroupFromNetwork('group-a')
		})
		await requested
		await modulePage.run(async () => {
			const { syncGroupFromNetwork } = await import('/parts/shells:chat/hub/sidebar/groupMembership.mjs')
			await syncGroupFromNetwork('group-a')
		})
		release()
		const visible = await modulePage.run(async () => {
			await globalThis.__pendingSync
			const { store } = await import('/parts/shells:chat/hub/core/state.mjs')
			return store.federation.syncBanner.visible
		})
		expect(requests).toBe(2)
		expect(visible).toBe(false)
	}
	finally { release() }
})

test('returning to the same group does not adopt a state response from its previous visit', async ({ modulePage }) => {
	const page = modulePage.page
	let release
	const gate = new Promise(resolve => { release = resolve })
	const requested = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/groups/group-a/state'))
	await page.route('**/groups/group-a/state*', async route => {
		await gate
		await route.fulfill({ json: { meta: { groupMeta: { name: 'stale group state' } }, viewer: {}, federation: {} } })
	})
	try {
		await modulePage.run(async () => {
			const { setState } = await import('/parts/shells:chat/hub/core/state.mjs')
			const { refreshGroupState } = await import('/parts/shells:chat/hub/stream/stateRefresh.mjs')
			setState('context.currentMode', 'groups')
			setState('context.currentGroupId', 'group-a')
			globalThis.__pendingState = refreshGroupState('group-a')
		})
		await requested
		await modulePage.run(async () => {
			const { setState } = await import('/parts/shells:chat/hub/core/state.mjs')
			setState('context.currentGroupId', 'group-b')
			setState('context.currentGroupId', 'group-a')
			setState('context.currentState', { groupMeta: { name: 'current group state' } })
		})
		release()
		const result = await modulePage.run(async () => {
			const adopted = await globalThis.__pendingState
			const { store } = await import('/parts/shells:chat/hub/core/state.mjs')
			return { adopted, name: store.context.currentState.groupMeta.name }
		})
		expect(result).toEqual({ adopted: null, name: 'current group state' })
	}
	finally { release() }
})
