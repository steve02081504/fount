/**
 * 群预览卡片纯组装（无 I/O，供 buildGroupPreview 与单测复用）。
 */

/**
 * 由已解析的数据源组装群预览卡片。
 * @param {object} opts 输入
 * @param {string} opts.groupId 群 ID
 * @param {object | null} [opts.state] 物化 state
 * @param {{ title?: string, blurb?: string } | null} [opts.discoveryEntry] discovery 条目
 * @param {{ title?: string, blurb?: string } | null} [opts.remote] 联邦卡片
 * @param {string | null} [opts.memberKey] 成员密钥（有则为成员）
 * @returns {object} 群预览卡片
 */
export function assembleGroupPreviewCard({ groupId, state = null, discoveryEntry = null, remote = null, memberKey = null }) {
	const isMember = Boolean(memberKey)
	const joinPolicy = state?.groupSettings?.joinPolicy || 'invite-only'
	const discoveryPublic = Boolean(state?.groupSettings?.discoveryPublic)

	let title = state?.groupMeta?.name || state?.groupSettings?.discoveryTitle || ''
	let blurb = state?.groupMeta?.description || state?.groupSettings?.discoveryBlurb || ''
	let found = Boolean(title || blurb)

	if (!found && discoveryEntry) {
		title = discoveryEntry.title || title
		blurb = discoveryEntry.blurb || blurb
		found = true
	}

	if (!found && remote) {
		title = remote.title || title
		blurb = remote.blurb || blurb
		found = true
	}

	const canJoin = !isMember && (discoveryPublic || joinPolicy === 'open' || joinPolicy === 'pow')

	return {
		groupId,
		title: title || groupId,
		blurb: blurb || '',
		icon: null,
		joinPolicy,
		isMember,
		canJoin,
		hubUrl: `/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:default`,
		found,
	}
}
