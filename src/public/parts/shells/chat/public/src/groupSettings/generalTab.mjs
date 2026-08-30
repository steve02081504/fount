import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../../scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { createMarkdownRichInput } from '/scripts/components/markdownRichInput.mjs'
import { putGroupMeta, putGroupSettings, removeGroup } from '../endpoints/groupCore.mjs'
import { postFederationTuning } from '../endpoints/groupFederation.mjs'
import { rotateGroupKey, submitOwnerSuccession } from '../endpoints/groupGovernance.mjs'
import { openDialogFromTemplate } from '../templates.mjs'

import { collectFederationTuningPatch } from './federationTab.mjs'
import { collectIceServersFromDom, wireIceServersEditor } from './iceTab.mjs'
import { wireInvitePanel } from './inviteTab.mjs'

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function showOwnerSuccessionModal(context) {
	if (!context.groupId) return
	const viewerPubKeyHash = context.stateJson?.viewerMemberPubKeyHash || ''
	await openDialogFromTemplate('group/modals/owner_succession', {
		viewerPubKeyHash: escapeHtml(viewerPubKeyHash),
	}, {
		activateScripts: false,
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {void}
		 */
		onReady: dialog => {
			const input = dialog.querySelector('[data-owner-pubkey-input]')
			const submitButton = dialog.querySelector('[data-owner-succ-submit]')
			/** @returns {void} */
			const closeModal = () => dialog.close()
			dialog.querySelector('[data-owner-succ-self]')?.addEventListener('click', () => {
				if (input instanceof HTMLInputElement && viewerPubKeyHash)
					input.value = viewerPubKeyHash
			})
			dialog.querySelector('[data-owner-succ-cancel]')?.addEventListener('click', closeModal)
			dialog.querySelector('[data-owner-succ-submit]')?.addEventListener('click', async () => {
				const proposedOwnerPubKeyHash = input instanceof HTMLInputElement ? input.value.trim() : ''
				if (!proposedOwnerPubKeyHash) {
					showToastI18n('warning', 'chat.group.ownerSuccession.needHash')
					return
				}
				if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true
				try {
					await submitOwnerSuccession(context.groupId, {
						proposedOwnerPubKeyHash,
						ballotId: crypto.randomUUID(),
					})
					showToastI18n('success', 'chat.group.settings.page.ownerSuccessionOk')
					closeModal()
					await context.reload(context.groupId)
				}
				catch (error) {
					showToastI18n('error', 'chat.group.settings.page.ownerSuccessionFailed', { error: error.message })
				}
				finally {
					if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false
				}
			})
		},
	})
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function saveGroupSettings(context) {
	if (!context.settingsCaps?.canEditGroupSettings) {
		showToastI18n('error', 'chat.group.settings.page.governanceDenied')
		return
	}
	await putGroupMeta(context.groupId, {
		name: document.getElementById('group-name').value.trim(),
		description: document.getElementById('group-description').value.trim(),
	})

	const joinPolicy = document.getElementById('join-policy').value
	const gossipTtl = Number.parseInt(document.getElementById('gossip-ttl').value, 10)
	await putGroupSettings(context.groupId, {
		joinPolicy,
		powDifficulty: Number.parseInt(document.getElementById('pow-difficulty').value, 10) || 4,
		streamGeneratingIdleMs: Number.parseInt(document.getElementById('stream-generating-idle-ms').value, 10) || 150000,
		autoReplyFrequency: Math.max(0, Number.parseInt(document.getElementById('auto-reply-frequency')?.value, 10) || 0),
		maxDagPayloadBytes: Number.parseInt(document.getElementById('max-dag-payload-bytes').value, 10) || 262144,
		batterySaver: !!document.getElementById('battery-saver')?.checked,
		trustedPeerSlots: Number.parseInt(document.getElementById('trusted-peer-slots')?.value, 10) || 8,
		explorePeerSlots: Number.parseInt(document.getElementById('explore-peer-slots')?.value, 10) || 4,
		maxPeers: Number.parseInt(document.getElementById('max-peers')?.value, 10) || 24,
		gossipTtl: Number.isFinite(gossipTtl) ? gossipTtl : 2,
		wantIdsBudget: Number.parseInt(document.getElementById('want-ids-budget')?.value, 10) || 16,
		hlcMaxSkewMs: Number.parseInt(document.getElementById('hlc-max-skew-ms')?.value, 10) || 3_600_000,
		streamingSfuWss: document.getElementById('streaming-sfu-wss')?.value?.trim() || null,
		messageContentRetentionMs: Number.parseInt(
			document.getElementById('message-content-retention-ms')?.value,
			10,
		) || 0,
		eventRetentionDepth: Number.parseInt(document.getElementById('event-retention-depth')?.value, 10) || 200_000,
		eventRetentionMs: Number.parseInt(document.getElementById('event-retention-ms')?.value, 10) || 0,
		compactTriggerEventDepth: Number.parseInt(document.getElementById('compact-trigger-event-depth')?.value, 10) || 100_000,
		messageRateLimitPerMin: Math.max(1, Math.min(120,
			Number.parseInt(document.getElementById('message-rate-limit-per-min')?.value, 10) || 10)),
		autoReplyTokenBucketEnabled: !!document.getElementById('auto-reply-token-bucket-enabled')?.checked,
		autoReplyTokenBurst: Math.max(1, Math.min(12,
			Number.parseInt(document.getElementById('auto-reply-token-burst')?.value, 10) || 2)),
		autoReplyTokenRefillPerMessage: Math.max(0.1, Math.min(5,
			Number.parseFloat(document.getElementById('auto-reply-token-refill')?.value) || 0.5)),
		fileCeMode: String(document.getElementById('file-ce-mode')?.value || 'convergent') === 'random'
			? 'random'
			: 'convergent',
		iceServers: collectIceServersFromDom(),
		discoveryPublic: joinPolicy === 'pow' && !!document.getElementById('discovery-public')?.checked,
		discoveryTitle: document.getElementById('discovery-title')?.value?.trim() || null,
		discoveryBlurb: document.getElementById('discovery-blurb')?.value?.trim() || null,
		autoChannelGc: !!document.getElementById('auto-channel-gc')?.checked,
		hotLatestMessageCount: Math.max(0, Number.parseInt(
			document.getElementById('hot-latest-message-count')?.value,
			10,
		) || 50),
		pinContextMessageCount: Math.max(0, Number.parseInt(
			document.getElementById('pin-context-message-count')?.value,
			10,
		) || 30),
	})

	const partitionElement = document.getElementById('federation-partition-count')
	if (partitionElement) {
		const tuningPatch = collectFederationTuningPatch()
		if (Object.keys(tuningPatch).length)
			await postFederationTuning(context.groupId, tuningPatch)
	}

	showToastI18n('success', 'chat.group.settings.page.saveSuccess')
	await context.reload(context.groupId)
}

/**
 * 按入群策略联动“公开发现”开关：仅 PoW 群可开启，切走 pow 时自动禁用并取消勾选。
 * @returns {void}
 */
function wireDiscoveryPublicSync() {
	const policySelect = document.getElementById('join-policy')
	const publicCheckbox = document.getElementById('discovery-public')
	if (!(policySelect instanceof HTMLSelectElement) || !(publicCheckbox instanceof HTMLInputElement)) return
	/** @returns {void} */
	const sync = () => {
		const isPow = policySelect.value === 'pow'
		publicCheckbox.disabled = !isPow
		if (!isPow) publicCheckbox.checked = false
		const label = publicCheckbox.closest('label')
		if (label) label.classList.toggle('opacity-60', !isPow)
	}
	policySelect.addEventListener('change', sync)
	sync()
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function deleteGroup(context) {
	if (!context.settingsCaps?.canDeleteGroup) {
		showToastI18n('error', 'chat.group.settings.page.governanceDenied')
		return
	}
	if (!confirmI18n('chat.group.settings.page.delete.confirm')) return
	await removeGroup(context.groupId)
	showToastI18n('success', 'chat.group.settings.page.delete.success')
	window.location.href = '/parts/shells:chat/hub/'
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function renderGroupSettings(context) {
	const { appendTemplate } = await import('../templates.mjs')
	const container = document.getElementById('group-settings-container')
	if (!container || !context.settingsCaps) return

	container.replaceChildren()

	if (!context.settingsCaps.isMember) {
		await appendTemplate(container, 'group/settings/settings_panel_denied', {
			messageKey: 'chat.group.settings.page.notMember',
		})
		return
	}

	if (!context.settingsCaps.canEditGroupSettings)
		await appendTemplate(container, 'group/settings/basic_panel_overview', {
			currentState: context.state,
		})

	if (context.settingsCaps.showGovernancePanel) {
		await appendTemplate(container, 'group/settings/basic_panel', {
			currentState: context.state,
			showFullSettings: context.settingsCaps.canEditGroupSettings,
			showDeleteGroup: context.settingsCaps.canDeleteGroup,
			showKeyRotate: context.settingsCaps.canKeyRotate,
			showFedTuning: context.settingsCaps.canFedTuning,
			showOwnerSuccession: context.settingsCaps.canOwnerSuccession,
		})
		const descInput = document.getElementById('group-description')
		if (descInput instanceof HTMLElement && !descInput.classList.contains('fount-markdown-rich-input'))
			createMarkdownRichInput(descInput, { enableDockedToolbar: true })
		const discoveryBlurb = document.getElementById('discovery-blurb')
		if (discoveryBlurb instanceof HTMLElement && !discoveryBlurb.classList.contains('fount-markdown-rich-input'))
			createMarkdownRichInput(discoveryBlurb, { enableDockedToolbar: true })
		await wireIceServersEditor(context)
		document.getElementById('save-group-settings')?.addEventListener('click', () => {
			void saveGroupSettings(context)
		})
		wireDiscoveryPublicSync()
		document.getElementById('group-settings-delete-group-button')?.addEventListener('click', () => {
			void deleteGroup(context)
		})
	}

	if (context.settingsCaps.canInviteMembers) {
		await appendTemplate(container, 'group/settings/invite_panel', {})
		wireInvitePanel(context)
	}

	document.getElementById('group-settings-key-rotate-button')?.addEventListener('click', async () => {
		if (!context.groupId || !confirmI18n('chat.group.settings.page.key.rotateConfirm')) return
		try {
			const result = await rotateGroupKey(context.groupId)
			showToastI18n('success', 'chat.group.settings.page.key.rotateOk')
			const generation = Number(result?.generation)
			const maxGenerations = Number(result?.maxGenerations) || 64
			if (Number.isFinite(generation) && generation >= maxGenerations - 4)
				showToastI18n('warning', 'chat.group.settings.page.gshGenerationNearLimit', {
					generation: String(generation),
					maxGenerations: String(maxGenerations),
				})
			await context.reload(context.groupId)
		}
		catch (error) {
			showToastI18n('error', 'chat.group.settings.page.key.rotateFailed', { error: error.message })
		}
	})
	document.getElementById('group-settings-owner-succession-button')?.addEventListener('click', () => {
		void showOwnerSuccessionModal(context)
	})
}
