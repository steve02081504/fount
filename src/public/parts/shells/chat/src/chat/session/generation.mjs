/**
 * 【文件】generation.mjs — 会话生成相关 API 聚合再导出
 * 【职责】作为对外稳定入口，集中导出 getChatRequest、addChatLogEntry/addChatLogEntryImport、时间线 API 与 triggerCharReply，避免调用方直接依赖多个子模块路径。
 * 【原理】纯 barrel 模块，无运行时逻辑；各符号实现在 chatRequest、chatLogAppend、timeLine、triggerReply。
 * 【数据结构】无本地状态。
 * 【关联】endpoints、messages（间接 addChatLogEntry）、hub 前端 API 层。
 */
export { getChatRequest } from './chatRequest.mjs'
/**
 * 追加聊天日志条目（含导入路径）。
 */
export { addChatLogEntry, addChatLogEntryImport } from './chatLogAppend.mjs'
/**
 * 修改时间线与获取时间线游标。
 */
export { modifyTimeLine, getChatTimelineCursor } from './timeLine.mjs'
/**
 * 触发指定角色在群内的回复生成。
 */
export { triggerCharReply } from './triggerReply.mjs'
