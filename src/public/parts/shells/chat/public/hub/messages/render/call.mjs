/**
 * 【文件】public/hub/messages/render/call.mjs
 * 【职责】通话卡片 HTML。
 */
import { renderTemplateAsHtmlString } from '../../../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { avatarColor, avatarInitial, avatarTextColor } from '/parts/shells:chat/shared/hashAvatar.mjs'

/**
 * @param {object} message 消息行
 * @returns {Promise<string>} HTML
 */
export async function renderCallBlock(message) {
	const content = message?.content || {}
	const status = content.status === 'ended' ? 'ended' : 'ongoing'
	const source = status === 'ongoing' && Array.isArray(content.current) && content.current.length
		? content.current
		: Array.isArray(content.participants) ? content.participants : []
	const hashes = source.map(h => String(h || '').toLowerCase()).filter(Boolean)
	const avatarsHtml = hashes.slice(0, 12).map(hash => {
		const letter = escapeHtml(avatarInitial(hash.slice(0, 8)))
		const bg = escapeHtml(avatarColor(hash))
		const fg = escapeHtml(avatarTextColor(hash))
		return `<span class="hub-call-avatar hub-avatar-wrap" data-avatar-for="${escapeHtml(hash)}" title="${escapeHtml(hash.slice(0, 8))}" style="background:${bg};color:${fg}">${letter}</span>`
	}).join('')
	let metaHtml = ''
	if (status === 'ongoing') {
		const started = Number(content.startedAt) || 0
		const timeText = started ? new Date(started).toLocaleTimeString() : ''
		metaHtml = `<span data-i18n="chat.hub.callStartedAt" data-time="${escapeHtml(timeText)}"></span>`
			+ ` · <span data-i18n="chat.hub.callParticipants" data-n="${hashes.length}"></span>`
	}
	else {
		const durationMs = Number(content.duration) || 0
		const secs = Math.max(0, Math.round(durationMs / 1000))
		const mm = String(Math.floor(secs / 60)).padStart(2, '0')
		const ss = String(secs % 60).padStart(2, '0')
		metaHtml = `<span data-i18n="chat.hub.callDuration" data-duration="${mm}:${ss}"></span>`
			+ ` · <span data-i18n="chat.hub.callParticipants" data-n="${hashes.length}"></span>`
	}
	const joinButtonHtml = status === 'ongoing'
		? '<button type="button" class="btn btn-sm btn-primary hub-call-join-btn" data-i18n="chat.hub.callJoin"></button>'
		: ''
	return renderTemplateAsHtmlString('hub/messages/call_block', {
		callId: escapeHtml(String(content.callId || message.eventId || '')),
		status,
		titleI18n: status === 'ended' ? 'chat.hub.callEnded' : 'chat.hub.callInProgress',
		metaHtml,
		avatarsHtml: avatarsHtml || '<span class="hub-call-avatars-empty" data-i18n="chat.hub.callNoParticipants"></span>',
		joinButtonHtml,
	})
}
