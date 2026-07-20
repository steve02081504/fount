/**
 * 【文件】public/hub/messages/messageSurface.mjs
 * 【职责】主区与线程抽屉共用的消息面 paint / bind；宿主由调用方传入 container + 频道上下文。
 * 【原理】渲染单行与交互绑定与 MessagePipeline 解耦；主区 virtual list 的 onRenderComplete
 *   与线程抽屉的 pipeline 都走同一套 bind。
 */
import {
	createDocumentFragmentFromHtmlStringNoScriptActivation,
	renderTemplate,
} from '../../../../../scripts/features/template.mjs'
import { createMessagePipeline } from '../../src/MessagePipeline.mjs'
import { activeCharPartNames } from '../core/domUtils.mjs'
import { store } from '../core/state.mjs'
import { applyAvatarsTo } from '../presence.mjs'

import { bindChannelMessageActions } from './actions/handlers.mjs'
import { setChannelMessageActionsContext } from './messageActionsState.mjs'
import { bindMessageDragExport } from './messageDragExport.mjs'
import { wireMessageReactions } from './reactionWire.mjs'
import {
	localizeRenderedMessages,
	renderChannelMessageBlock,
} from './render/index.mjs'

/**
 * 组装频道消息渲染选项（主区 / 线程共用）。
 * @param {object} params 参数
 * @param {string} params.channelId 频道 ID
 * @param {Record<string, Record<string, { voters?: string[] }>>} [params.reactions] 反应聚合
 * @param {object} [params.overrides] 覆盖字段（如 alwaysVisibleActions / canCreateThreads）
 * @returns {object} 渲染选项
 */
export function buildChannelRenderOpts({ channelId, reactions = {}, overrides = {} }) {
	const pinnedEventIds = channelId && store.context.currentState?.pinsByChannel?.[channelId]
		? [...store.context.currentState.pinsByChannel[channelId]]
		: []
	return {
		reactions: reactions || {},
		viewerMemberId: store.messages.reactionRenderOpts.viewerMemberId,
		canAddReactions: store.messages.reactionRenderOpts.canAddReactions,
		viewerPubKeyHash: store.context.currentState?.viewerMemberPubKeyHash || null,
		viewerEntityHash: store.viewer.viewerEntityHash || store.viewer.operatorEntityHash || null,
		groupMembers: store.context.currentState?.members || [],
		localCharIds: activeCharPartNames(),
		canManageMessages: store.messages.reactionRenderOpts.canManageMessages,
		canPinMessages: store.messages.reactionRenderOpts.canPinMessages,
		pinnedEventIds,
		alwaysVisibleActions: false,
		canCreateThreads: false,
		...overrides,
	}
}

/**
 * 渲染单条消息 DOM（供 MessagePipeline.renderItem）。
 * @param {object} message 消息行
 * @param {number} index 列表索引
 * @param {object[]} allMessages 完整列表（取 prev / lastId）
 * @param {object} renderOpts 渲染选项
 * @returns {Promise<HTMLElement>} 消息元素
 */
export async function renderMessageRowElement(message, index, allMessages, renderOpts) {
	if (message.type === 'unread_divider')
		return renderTemplate('hub/messages/unread_divider', {})
	const prev = index > 0 ? allMessages[index - 1] : null
	const lastId = allMessages.at(-1)?.eventId
	const block = await renderChannelMessageBlock(
		message,
		prev?.type === 'unread_divider' ? null : prev?.charId ?? prev?.sender ?? null,
		prev?.type === 'unread_divider' ? 0 : prev?.timestamp || prev?.hlc?.wall || 0,
		allMessages,
		{ ...renderOpts, lastMessageEventId: lastId },
	)
	const frag = await createDocumentFragmentFromHtmlStringNoScriptActivation(block.html)
	return frag.firstElementChild
}

/**
 * 绑定消息面交互（操作栏 / 反应 / 拖拽导出 / 头像 / i18n）。
 * @param {HTMLElement} container 消息容器
 * @param {object} ctx 频道上下文
 * @param {string} ctx.groupId 群 ID
 * @param {string} ctx.channelId 频道 ID
 * @param {object[]} ctx.messages 当前可见消息
 * @param {Record<string, Record<string, { voters?: string[] }>>} [ctx.reactions] 反应
 * @param {() => Promise<void>} ctx.reload 重载回调
 * @returns {void}
 */
export function bindMessageSurface(container, {
	groupId,
	channelId,
	messages,
	reactions = {},
	reload,
}) {
	setChannelMessageActionsContext({
		groupId,
		channelId,
		messages,
		reload,
	}, container)
	bindChannelMessageActions(container)
	bindMessageDragExport(container)
	wireMessageReactions(container, {
		groupId,
		channelId,
		messages,
		reactions,
		viewerMemberId: store.messages.reactionRenderOpts.viewerMemberId,
		canManageMessages: store.messages.reactionRenderOpts.canManageMessages,
		reload,
	})
	localizeRenderedMessages(container)
	applyAvatarsTo(container)
}

/**
 * 为任意消息容器创建 MessagePipeline（主区 / 线程抽屉）。
 * @param {object} options 配置
 * @param {HTMLElement} options.container 容器
 * @param {() => object[]} options.getMessages 当前消息列表
 * @param {() => object} options.getRenderOpts 渲染选项
 * @param {() => void} options.onDecorate 渲染完成后的装饰（含 bind）
 * @param {() => Promise<number>} [options.loadMoreTop] 向上加载
 * @param {number} [options.initialIndex] 初始索引
 * @returns {ReturnType<typeof createMessagePipeline>} 管道
 */
export function createMessageSurfacePipeline({
	container,
	getMessages,
	getRenderOpts,
	onDecorate,
	loadMoreTop = null,
	initialIndex,
}) {
	return createMessagePipeline({
		container,
		loadMoreTop,
		/**
		 * @param {number} offset 起始
		 * @param {number} limit 条数
		 * @returns {{ items: object[], total: number }} 分页
		 */
		fetchData: (offset, limit) => {
			const rows = getMessages()
			if (limit === 0) return { items: [], total: rows.length }
			return {
				items: rows.slice(offset, offset + limit),
				total: rows.length,
			}
		},
		/**
		 * @param {object} message 行
		 * @param {number} index 索引
		 * @returns {Promise<HTMLElement>} 元素
		 */
		renderItem: (message, index) => renderMessageRowElement(
			message,
			index,
			getMessages(),
			getRenderOpts(),
		),
		/**
		 * @param {object} row 行
		 * @returns {string} key
		 */
		getItemKey: row => String(row.eventId || ''),
		initialIndex: initialIndex ?? Math.max(0, getMessages().length - 1),
		onRenderComplete: onDecorate,
	})
}
