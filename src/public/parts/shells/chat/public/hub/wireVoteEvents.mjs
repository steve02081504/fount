import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import {
	castChannelVote,
	createChannelVote,
} from '../src/api/groupApi.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

import { hubStore } from './core/state.mjs'
import { loadMessages } from './messages/messages.mjs'
import { getActiveThreadChannelId } from './threadDrawer.mjs'

/** @returns {void} */
export function wireVoteEvents() {
	const voteModal = /** @type {HTMLDialogElement} */ document.getElementById('hub-vote-modal')
	const voteQuestion = /** @type {HTMLInputElement} */ document.getElementById('hub-vote-question')
	const voteOptions = /** @type {HTMLTextAreaElement} */ document.getElementById('hub-vote-options')
	const voteHours = /** @type {HTMLInputElement} */ document.getElementById('hub-vote-hours')
	document.getElementById('hub-vote-button').addEventListener('click', () => {
		if (!hubStore.context.currentGroupId || !hubStore.context.currentChannelId) return
		voteQuestion.value = ''
		voteOptions.value = ''
		voteOptions.dataset.i18n = 'chat.hub.voteOptionDefault'
		voteHours.value = '24'
		voteModal.showModal()
	})
	document.getElementById('hub-vote-cancel-button').addEventListener('click', () => voteModal.close())
	document.getElementById('hub-vote-submit-button').addEventListener('click', async () => {
		if (!hubStore.context.currentGroupId || !hubStore.context.currentChannelId) return
		const question = voteQuestion.value.trim()
		if (!question) return
		const optsRaw = voteOptions.value
		const options = optsRaw.split(/[\n,，]/u).map(s => s.trim()).filter(Boolean)
		if (options.length < 2) {
			showToastI18n('error', 'chat.hub.voteMinOptions')
			return
		}
		const hoursVal = Number(voteHours.value)
		const deadlineMs = Number.isFinite(hoursVal) && hoursVal > 0 ? hoursVal * 3600 * 1000 : 0
		try {
			await createChannelVote(hubStore.context.currentGroupId, hubStore.context.currentChannelId, {
				question,
				options,
				deadlineMs: deadlineMs > 0 ? deadlineMs : undefined,
			})
			voteModal.close()
			await loadMessages()
		}
		catch (err) {
			handleUIError(err, 'chat.hub.voteCreateFailed')
		}
	})
}

/**
 * @param {object} wireMessage vote_closed WS 帧
 * @param {string} channelId 当前频道
 * @returns {void}
 */
export function handleVoteClosedWire(wireMessage, channelId) {
	const ballotId = String(wireMessage?.ballotId || '').trim()
	if (!ballotId) return
	const incomingChannelId = wireMessage.channelId
	const threadId = getActiveThreadChannelId()
	if (incomingChannelId && incomingChannelId !== channelId && incomingChannelId !== threadId)
		return
	const block = document.querySelector(`.hub-vote-block[data-ballot-id="${ballotId}"]`)
	if (!block) {
		void loadMessages()
		return
	}
	block.classList.add('hub-vote-block--closed')
	block.dataset.closed = '1'
	for (const button of block.querySelectorAll('.hub-vote-option'))
		button.disabled = true
	const tally = wireMessage.tally || {}
	for (const button of block.querySelectorAll('.hub-vote-option')) {
		const choice = button.dataset.choice
		const count = Number(tally[choice]) || 0
		const meta = button.querySelector('.hub-vote-option-meta')
		if (meta) {
			meta.dataset.count = String(count)
			const total = Object.values(tally).reduce((sum, value) => sum + Number(value || 0), 0)
			meta.dataset.pct = String(total ? Math.round(count * 100 / total) : 0)
		}
		const bar = button.querySelector('.hub-vote-option-bar')
		if (bar && meta)
			bar.style.width = `${meta.dataset.pct}%`
	}
	let closedLabel = block.querySelector('.hub-vote-closed-label')
	if (!closedLabel) {
		closedLabel = document.createElement('div')
		closedLabel.className = 'hub-vote-closed-label'
		closedLabel.dataset.i18n = 'chat.hub.voteClosed'
		block.prepend(closedLabel)
	}
}

/**
 * @param {Event} event 点击事件
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleVoteOptionClick(event) {
	const voteOptionButton = event.target.closest('.hub-vote-option')
	if (!voteOptionButton?.dataset?.ballotId || voteOptionButton?.dataset?.choice == null || !hubStore.context.currentGroupId || !hubStore.context.currentChannelId)
		return false
	if (voteOptionButton.disabled || voteOptionButton.closest('.hub-vote-block--closed'))
		return true
	await castChannelVote(hubStore.context.currentGroupId, hubStore.context.currentChannelId, voteOptionButton.dataset.ballotId, voteOptionButton.dataset.choice)
	await loadMessages()
	return true
}
