import { mutateArchiveManifest } from '../archive/index.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道
 * @param {string} utcMonth `YYYY-MM`
 * @param {string} reason 缺口原因
 * @returns {Promise<void>}
 */
export async function markArchiveMonthIncomplete(username, groupId, channelId, utcMonth, reason) {
	await mutateArchiveManifest(username, groupId, manifest => {
		if (!manifest.coverage) manifest.coverage = {}
		manifest.coverage[channelId] = { complete: false, utcMonth, reason }
		manifest.archive_coverage_complete = false
	})
}
