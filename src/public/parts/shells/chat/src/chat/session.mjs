/**
 * 【文件】src/chat/session.mjs
 * 【职责】chat 会话子系统进程级初始化与联邦 Char/World RPC 分发。
 * 【原理】模块加载时调用 initializeGroupMetadatas 与 bindSessionUnloadHooks；RPC 工厂注入 getActiveGroupRuntime / getChatRequest。
 * 【关联】被 chat/ws/groupWsHub、联邦 RPC 路径 import；具体会话 API 见 session/ 子目录。
 */
/** @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { createCharRpcDispatcher, createWorldRpcDispatcher } from './federation/rpcDispatcher.mjs'
import { getChatRequest } from './session/chatRequest.mjs'
import { deleteGroup } from './session/groupLifecycle.mjs'
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
