/**
 * 【文件】src/chat/lib/entityId.mjs
 * 【职责】实体 ID 派生：由 nodeHash 与 part URI 计算 agent/user entityHash。
 * 【原理】SHA-256 截断 128bit；缓存常用 chars/personas 映射。
 * 【数据结构】EntityHash：32 hex chars；PartUri：如 chars/foo。
 * 【关联】lib/nodeHash、profile/agentResolve、public lib/entityId。
 */
export * from '../../../../../../../scripts/p2p/entity_id.mjs'
