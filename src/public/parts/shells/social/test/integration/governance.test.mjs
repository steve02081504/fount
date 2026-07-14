/**
 * Social 治理最小集：mute / report / contentWarning。
 */
/* global Deno */
import { placeholderEntityHash } from 'fount/scripts/test/fixtures.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { setPersonalMuted, isMutedBy } from 'npm:@steve02081504/fount-p2p/node/personal_block'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()
const TARGET = placeholderEntityHash('b')

Deno.test('mute filters feed via personal lists', async () => {
	const { username, operator } = await getSession()
	const { isAuthorFilteredByPersonalSets, loadPersonalFilterSets } = await import('npm:@steve02081504/fount-p2p/node/personal_block')
	const { canViewPost } = await import('../../src/feedVisibility.mjs')
	const { loadViewerContext } = await import('../../src/feed.mjs')

	await setPersonalMuted(operator, TARGET, true)
	const filterSets = await loadPersonalFilterSets(operator)
	assert(isAuthorFilteredByPersonalSets(filterSets, TARGET))

	const viewerContext = await loadViewerContext(username, operator)
	assertEquals(canViewPost({ entityHash: TARGET, content: { text: 'x', visibility: 'public' } }, viewerContext), false)
	await setPersonalMuted(operator, TARGET, false)
})

Deno.test('isMutedBy blocks inbox actor', async () => {
	const { operator } = await getSession()
	await setPersonalMuted(operator, TARGET, true)
	assert(await isMutedBy(operator, { entityHash: TARGET }))
	await setPersonalMuted(operator, TARGET, false)
	assertEquals(await isMutedBy(operator, { entityHash: TARGET }), false)
})

Deno.test('report signs locally and ingests on owner with sanitization', async () => {
	const { username, operator } = await getSession()
	const { submitReport, ingestInboundReport, listReceivedReports, sanitizeInboundReport } = await import('../../src/governance/report.mjs')

	const signed = await submitReport(username, {
		targetEntityHash: operator,
		targetPostId: null,
		reason: 'spam content',
		category: 'spam',
		reporterEntityHash: operator,
	})
	assert(signed.signature)

	const rejected = await sanitizeInboundReport({ ...signed, reason: '' })
	assertEquals(rejected, null)

	const ok = await ingestInboundReport(username, signed)
	assertEquals(ok, true)
	const { reports } = await listReceivedReports(username, { limit: 5 })
	assert(reports.some(row => row.reason === 'spam content'))
})

Deno.test('contentWarning persists on post content', async () => {
	const { username, operator } = await getSession()
	const append = await import('../../src/timeline/append.mjs')
	const { getTimelineMaterialized } = await import('../../src/timeline/materialize.mjs')

	const row = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: {
			text: 'hidden body',
			contentWarning: 'sensitive',
			visibility: 'public',
		},
	}, { fanout: false })

	const view = await getTimelineMaterialized(username, operator)
	const post = view.postById?.[row.id] || view.posts.find(p => p.id === row.id)
	assertEquals(post?.content?.contentWarning, 'sensitive')
})

Deno.test('social_report RPC handler ingests signed report', async () => {
	const { username, operator } = await getSession()
	const { signLocalReport, listReceivedReports } = await import('../../src/governance/report.mjs')
	const { handleSocialRpc } = await import('../../src/discover/rpc.mjs')

	const signed = await signLocalReport(username, {
		targetEntityHash: operator,
		targetPostId: null,
		reason: 'federated spam marker',
		category: 'spam',
		reporterEntityHash: operator,
	})
	const resp = await handleSocialRpc(username, { type: 'social_report', report: signed })
	assertEquals(resp?.type, 'social_report_response')
	assertEquals(resp?.ok, true)

	const { reports } = await listReceivedReports(username, { limit: 10 })
	assert(reports.some(row => row.reason === 'federated spam marker'))
})

Deno.test('resolveReport dismisses by reportRowId', async () => {
	const { username, operator } = await getSession()
	const {
		submitReport,
		ingestInboundReport,
		listReceivedReports,
		resolveReport,
		reportRowId,
	} = await import('../../src/governance/report.mjs')

	const signed = await submitReport(username, {
		targetEntityHash: operator,
		targetPostId: null,
		reason: 'noise to dismiss',
		category: 'spam',
		reporterEntityHash: operator,
	})
	assertEquals(await ingestInboundReport(username, signed), true)
	const reportId = reportRowId(signed)
	const { reports } = await listReceivedReports(username, { limit: 20 })
	assert(reports.some(row => row.id === reportId))

	const resolved = await resolveReport(username, operator, {
		reportId,
		action: 'dismiss',
	})
	assertEquals(resolved.reportId, reportId)
	assertEquals(resolved.action, 'dismiss')
	assertEquals(resolved.actorEntityHash, operator)
})
