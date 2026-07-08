/**
 * 【文件】src/chat/session.mjs
 * 【职责】chat 会话子系统 barrel：进程级初始化、联邦 Char/World RPC 分发，并 re-export session/ 常用入口。
 * 【原理】模块加载时调用 initializeGroupMetadatas 与 bindSessionUnloadHooks；RPC 工厂注入 getActiveGroupRuntime / getChatRequest。
 * 【关联】被 chat/ws/groupWsHub、联邦 RPC 路径 import；具体实现见 session/ 目录。
 */
/** @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { createCharRpcDispatcher, createWorldRpcDispatcher } from './federation/rpcDispatcher.mjs'
import { getChatRequest } from './session/chatRequest.mjs'
import { deleteGroup } from './session/crud.mjs'
import { getActiveGroupRuntime, isLocallyOwnedGroup, isVividGroup } from './session/persistence.mjs'
import { bindSessionUnloadHooks, initializeGroupMetadatas } from './session/wsLifecycle.mjs'

initializeGroupMetadatas()

bindSessionUnloadHooks({ deleteGroup, isVividGroup, isLocallyOwnedGroup })

/**
 * 在本地群运行时尝试分发 Char RPC（供联邦 `char_rpc` 入站回调）。
 */
export const tryInvokeLocalCharRpc = createCharRpcDispatcher(getActiveGroupRuntime, getChatRequest)
/**
 * 在本地群运行时尝试分发 World RPC（供联邦 `char_rpc` 入站回调）。
 */
export const tryInvokeLocalWorldRpc = createWorldRpcDispatcher(getChatRequest)

/**
 *
 */
export { deleteGroup, newGroup, getInitialData } from './session/crud.mjs'
/**
 *
 */
export { getChatRequest } from './session/chatRequest.mjs'
/**
 *
 */
export { triggerCharReply } from './session/triggerReply.mjs'
/**
 *
 */
export { modifyTimeLine } from './session/timeLine.mjs'
/**
 *
 */
export {
	getActiveGroupRuntime,
	isLocallyOwnedGroup,
	isVividGroup,
} from './session/persistence.mjs'
/**
 *
 */
export { getGroupRuntime } from './session/runtime.mjs'
/**
 *
 */
export {
	bindSessionUnloadHooks,
	groupMetadatas,
	initializeGroupMetadatas,
	purgeGroupSession,
} from './session/wsLifecycle.mjs'
/**
 *
 */
export { getMaterializedSession } from './session/dagSession.mjs'
