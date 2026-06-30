/**
 * 【文件】public/hub/federation/forkActions.mjs
 * 【职责】DAG 分叉治理 UI：绑定顶栏分叉按钮，执行分支、合并、封锁对立叉与刷新分叉横幅。
 * 【原理】监听 `#hub-fork-branch-button` 等控件，配合 `banners.refreshDagForkBanner` 提示当前治理状态；分叉/合并成功后调用 `loadMessages` 重建频道视图以反映新 DAG 尖。
 * 【数据结构】hubStore 当前群/频道上下文与 WS 连接状态；见模块内变量 JSDoc。
 * 【关联】../../../../../scripts/i18n、../../../../../scripts/toast、../../src/api/groupApi、../banners、../core/state、../messages/messages。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../scripts/i18n/index.mjs'
import {
	blockOpposingForkBranch,
	forkGroupAsNew,
	getGroupState,
	mergeDagTips,
	setGovernanceBranch,
} from '../../src/api/groupApi.mjs'
import { refreshDagForkBanner, selectedForkTipId } from '../banners.mjs'
import { hubStore, setHubState } from '../core/state.mjs'
import { loadMessages } from '../messages/messages.mjs'

/**
 * 绑定 Hub 顶栏 DAG 分叉/合并/封锁等治理按钮事件。
 * @returns {void}
 */
export function wireForkActions() {
	document.getElementById('hub-fork-branch-button')?.addEventListener('click', async () => {
		if (!hubStore.currentGroupId) return
		const branchButton = document.getElementById('hub-fork-branch-button')
		if (branchButton) branchButton.disabled = true
		try {
			await setGovernanceBranch(hubStore.currentGroupId, selectedForkTipId())
			setHubState('currentState', await getGroupState(hubStore.currentGroupId))
			await loadMessages()
			await refreshDagForkBanner()
			showToastI18n('success', 'chat.hub.applyBranchOk')
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.applyBranchFailed', { error: error.message })
		}
		finally {
			if (branchButton) branchButton.disabled = false
		}
	})

	document.getElementById('hub-fork-auto-branch-button')?.addEventListener('click', async () => {
		if (!hubStore.currentGroupId) return
		const autoBranchButton = document.getElementById('hub-fork-auto-branch-button')
		if (autoBranchButton) autoBranchButton.disabled = true
		try {
			await setGovernanceBranch(hubStore.currentGroupId, null)
			setHubState('currentState', await getGroupState(hubStore.currentGroupId))
			await loadMessages()
			await refreshDagForkBanner()
			showToastI18n('success', 'chat.hub.autoBranchOk')
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.autoBranchFailed', { error: error.message })
		}
		finally {
			if (autoBranchButton) autoBranchButton.disabled = false
		}
	})

	const forkSplitModal = document.getElementById('hub-fork-split-modal')
	const forkSplitName = document.getElementById('hub-fork-split-name')
	document.getElementById('hub-fork-split-button')?.addEventListener('click', () => {
		if (!hubStore.currentGroupId || !(forkSplitModal instanceof HTMLDialogElement)) return
		if (forkSplitName instanceof HTMLInputElement)
			forkSplitName.value = `${hubStore.currentState?.groupMeta?.name || hubStore.currentGroupId} (fork)`
		forkSplitModal.showModal()
	})
	document.getElementById('hub-fork-split-cancel-button')?.addEventListener('click', () => forkSplitModal?.close())
	document.getElementById('hub-fork-split-submit-button')?.addEventListener('click', async () => {
		if (!hubStore.currentGroupId) return
		const submitButton = document.getElementById('hub-fork-split-submit-button')
		if (submitButton) submitButton.disabled = true
		try {
			const name = forkSplitName instanceof HTMLInputElement ? forkSplitName.value.trim() : ''
			const data = await forkGroupAsNew(hubStore.currentGroupId, {
				name: name || undefined,
				tipId: selectedForkTipId(),
			})
			forkSplitModal?.close()
			location.hash = `group:${data.groupId}:${data.defaultChannelId || 'default'}`
			location.reload()
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.forkSplitFailed', { error: error.message })
		}
		finally {
			if (submitButton) submitButton.disabled = false
		}
	})

	document.getElementById('hub-fork-block-opposing-button')?.addEventListener('click', async () => {
		if (!hubStore.currentGroupId) return
		const accepted = selectedForkTipId()
		if (!accepted) return
		if (!confirmI18n('chat.hub.blockOpposingConfirm')) return
		const blockOpposingButton = document.getElementById('hub-fork-block-opposing-button')
		if (blockOpposingButton) blockOpposingButton.disabled = true
		try {
			const { blocked } = await blockOpposingForkBranch(hubStore.currentGroupId, accepted)
			await loadMessages()
			setHubState('currentState', await getGroupState(hubStore.currentGroupId))
			await refreshDagForkBanner()
			showToastI18n('success', 'chat.hub.blockOpposingOk', { count: blocked.length })
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.blockOpposingFailed', { error: error.message })
		}
		finally {
			if (blockOpposingButton) blockOpposingButton.disabled = false
		}
	})

	document.getElementById('hub-fork-merge-button')?.addEventListener('click', async () => {
		if (!hubStore.currentGroupId) return
		const mergeButton = document.getElementById('hub-fork-merge-button')
		if (mergeButton) mergeButton.disabled = true
		try {
			await mergeDagTips(hubStore.currentGroupId)
			await loadMessages()
			setHubState('currentState', await getGroupState(hubStore.currentGroupId))
			await refreshDagForkBanner()
			showToastI18n('success', 'chat.hub.mergeDagOk')
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.mergeDagFailed', { error: error?.message || String(error) })
		}
		finally {
			if (mergeButton) mergeButton.disabled = false
		}
	})
}
