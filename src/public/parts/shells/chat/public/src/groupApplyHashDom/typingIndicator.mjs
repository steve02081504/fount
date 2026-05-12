import { geti18n, setLocalizeLogic } from '../../../../../../scripts/i18n.mjs'

/**
 * 群组打字指示器：远端列表、节流广播、i18n 刷新。
 * @param {{ groupId: string, channelId: string, wsClientId: string }} args 群组与当前频道、WS 身份
 * @returns {{
 *   typingUsers: Map<string, ReturnType<typeof setTimeout>>,
 *   TYPING_TIMEOUT: number,
 *   updateTypingDisplay: () => void,
 *   sendTypingBroadcast: () => void,
 * }} 打字状态与更新/广播函数
 */
export function createGroupTypingIndicator({ groupId, channelId, wsClientId }) {
	const typingIndicatorEl = document.getElementById('group-typing-indicator')
	/** @type {Map<string, ReturnType<typeof setTimeout>>} */
	const typingUsers = new Map()
	const TYPING_TIMEOUT = 3200

	let lastTypingPost = 0

	/**
	 *
	 */
	function updateTypingDisplay() {
		if (!typingIndicatorEl) return
		if (typingUsers.size === 0) {
			typingIndicatorEl.classList.add('hidden')
			typingIndicatorEl.textContent = ''
			return
		}
		const names = [...typingUsers.keys()]
		let text
		if (names.length === 1)
			text = geti18n('chat.group.remoteTyping', { name: names[0] })
		else if (names.length === 2)
			text = geti18n('chat.group.remoteTypingTwo', { name1: names[0], name2: names[1] })
		else
			text = geti18n('chat.group.remoteTypingMany', { name: names[0], count: names.length - 1 })
		typingIndicatorEl.textContent = text
		typingIndicatorEl.classList.remove('hidden')
	}

	if (typingIndicatorEl)
		setLocalizeLogic(typingIndicatorEl, updateTypingDisplay)

	/**
	 *
	 */
	function sendTypingBroadcast() {
		const now = Date.now()
		if (now - lastTypingPost < 2200) return
		lastTypingPost = now
		fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/broadcast`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				payload: {
					type: 'typing',
					channelId,
					sender: 'local_user',
					clientId: wsClientId,
				},
			}),
		}).catch(e => {
			console.error('sendTypingBroadcast failed:', e)
		})
	}

	return { typingUsers, TYPING_TIMEOUT, updateTypingDisplay, sendTypingBroadcast }
}
