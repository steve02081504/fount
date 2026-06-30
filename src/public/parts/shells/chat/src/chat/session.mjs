/**
 * 【文件】src/chat/session.mjs
 * 【职责】chat 会话子系统的聚合入口：初始化内存 groupMetadatas、绑定进程卸载钩子，并导出本地 Char/World RPC 分发器工厂。
 * 【原理】模块加载时调用 initializeGroupMetadatas 与 bindSessionUnloadHooks（传入 deleteGroup/isVividGroup）；RPC 由 rpcDispatcher 工厂注入 getActiveGroupRuntime 与 getChatRequest，供 groupWsHub 在 WS 上代理远程角色/世界调用；不在此文件实现具体消息或生成逻辑。
 * 【数据结构】groupMetadatas Map（groupId → chatMetadata_t）、tryInvokeLocalCharRpc / tryInvokeLocalWorldRpc 函数引用。
 * 【关联】被 chat/stream/groupWsHub、联邦 RPC 路径 import；re-export rpcDispatcher 与 session/wsLifecycle、session/crud、session/generation。
 */
/** @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { createCharRpcDispatcher, createWorldRpcDispatcher } from './rpcDispatcher.mjs'
import { deleteGroup } from './session/crud.mjs'
import { getChatRequest } from './session/generation.mjs'
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
