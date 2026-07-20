/**
 * 【文件】src/chat/lib/hexRoute.mjs
 * 【职责】十六进制路由段解析：事件 ID、hash 路径在 URL/API 间的编解码。
 * 【原理】normalizeHex64/128，校验长度，供 endpoints 与 WS RPC 共用。
 * 【数据结构】HexRouteParams：id、channelId、optionalBranch。
 * 【关联】lib/paths、endpoints、ws/groupWsRpc。
 */
/** Express 路由路径段：64 位小写 hex 事件 id（无 `^$` 锚点）。 */
export const EVENT_ID_ROUTE_SEGMENT = '[0-9a-f]{64}'
