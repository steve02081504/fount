/**
 * 【文件】public/src/api/groupApi.mjs
 * 【职责】群/DM 前端 API 统一导出入口（barrel）：Hub、设置、深链等只需 import 本文件。
 * 【原理】按域拆分到 groupClient/Core/Channel/Dm/Bookmarks/Ban/Governance/Federation/federationSettings，此处仅 re-export，无运行时逻辑。
 * 【数据结构】导出 groupFetch/groupPath/groupRequest 与各域 async 函数集合。
 * 【关联】Hub、groupSettings、deepLinkConsume、dmLink 等；实现分散在 api/*.mjs。
 */
export { groupFetch, groupPath, groupRequest } from './groupClient.mjs'

/**
 * 群生命周期、成员、邀请与文件等核心 API。
 */
export {
	createGroup,
	fetchGroupAuditLog,
	getGroupChatConfig,
	getMembersPage,
	getGroupList,
	getGroupState,
	getStreamingChannelAuth,
	joinGroup,
	leaveGroups,
	createGroupInvite,
	deleteGroupFile,
	updateFileSystemFolder,
} from './groupCore.mjs'

/**
 * 频道消息、投票、时间线与频道管理 API。
 */
export {
	castChannelVote,
	createChannel,
	createChannelThread,
	createChannelVote,
	deleteChannelMessage,
	editChannelMessage,
	getChannelMessages,
	getPinContextMessages,
	getStreamBufferChunks,
	getChatTimeline,
	modifyChannelTimeline,
	pinMessage,
	unpinMessage,
	requestChannelHistoryFromPeers,
	sendGroupMessage,
	setChannelMessageFeedback,
	triggerChannelReply,
	updateChannel,
	deleteChannel,
	setDefaultChannel,
	updateChannelListItems,
} from './groupChannel.mjs'

/**
 * 按公钥创建私聊（DM）API。
 */
export { createDirectMessageByPubKeys } from './groupDm.mjs'

/**
 * 聊天书签读写 API。
 */
export {
	addChatBookmark,
	getChatBookmarks,
	removeChatBookmark,
	saveChatBookmarks,
} from './groupBookmarks.mjs'

/**
 * 带范围的成员封禁 API。
 */
export { banMemberWithScope } from './groupBan.mjs'

/**
 * 群治理：分叉、声誉、密钥轮换与封禁解除等 API。
 */
export {
	blockUser,
	blockOpposingForkBranch,
	forkGroupAsNew,
	getGroupReputation,
	mergeDagTips,
	postReputationReset,
	postReputationSlash,
	rotateGroupKey,
	setGovernanceBranch,
	submitOwnerSuccession,
	unbanMember,
} from './groupGovernance.mjs'

/**
 * 联邦同步、拉取事件与房间密钥轮换 API。
 */
export {
	federationCatchUp,
	postFederationTuning,
	pullGroupEvents,
	rebindFederationRoom,
	repairJoinSnapshot,
	rotateFederationRoomSecret,
} from './groupFederation.mjs'

/**
 * 联邦全局设置读写 API。
 */
export {
	getFederationSettings,
	putFederationSettings,
} from './federationSettings.mjs'
