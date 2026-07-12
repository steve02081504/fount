# fount P2P Overlay 设计（去 Trystero）

## 目标

- 去掉 Trystero room / offerPool / peerId 中心模型，改为 nodeHash 中心模型。
- 一 `nodeHash` 一条逻辑链接，跨群复用物理传输。
- 发现、信令、传输、overlay 路由解耦，Nostr 降为可插拔发现源之一。
- 定向投递 / 离线继续复用现有 Mailbox，键仍是收件人 `pubKeyHash`。
- 不做向后兼容，按大爆炸迁移。

## 非目标

- 首版不要求 LAN / BT 自带独立传输，只做发现插件。
- 首版不要求 ICE restart；网络切换后允许断链重建。

## 已拍板决策

- 传输后端固定为裸 `RTCPeerConnection` + `node-datachannel`。
- `simple-peer`、werift 从主路径移除。
- Windows 生产路径固定依赖 ICE server，mDNS 策略固定为 `drop`。
- 一 nodeHash 一“逻辑链接”，物理连接断了走重发现 / 重建。
- 握手不再使用 `identity_announce` / room password 隐式授权；改为 challenge-response + DTLS 指纹绑定。
- `groupProofs` 从握手中移除，群授权后置到 `scope` 派发层。
- 群内在 P2 阶段保留一跳 gossip 补位，直到 P3 overlay 路由就位。
- kick / ban 事件自动轮换 `roomSecret`。

## 当前落地状态（2026-07-04）

- `link/`、`link_registry.mjs`、`group_link_set.mjs`、`overlay/` 已落地并接入生产路径；`ensureLinkToNode` 现为直连优先、overlay 次之、discovery 再次之。
- Chat 群联邦与 subfounts 已从 Trystero room 迁到 node/group scope；`identity_announce` 已退场，群授权改为 `group:` scope authorizer。
- Trystero 专用模块与旧 `webrtc_signal` 联邦路径已移除；AV 继续保留服务端 `av-relay`，不走本轮迁移。
- 发现层默认注册 `mdns` 与 `nostr`；Bluetooth provider 已有真实实现，但默认仅在 `FOUNT_ENABLE_BT_DISCOVERY=1` 时启用，且 Windows 默认 scan-only（可用 `FOUNT_BT_DISCOVERY_ROLE=dual` 强制双角色尝试）。
- 房主房间现在会在 `group_link_set.start()` 里主动拉起 discovery runtime，不再等首次外拨；否则“只有自己一个成员”的新群会成为暗房，后续 joiner 持有正确 `roomSecret` 也拨不进来。
- 新 discovery 栈已接回测试期 `relayOverride`（`FOUNT_TEST_RELAY_URLS`）；live 联邦双节点不再误打公网 relay。
- `link/link.mjs` 已尊重 `trickleIceOff`：测试 / Windows 路径先等 ICE gather 完整再发最终 SDP，并对重复 signal 去重、对早到 ICE 延后处理，规避 `node-datachannel` 的 `without ICE transport` / duplicate-answer 竞态。
- `group:` scope 现在放行一小撮“前成员 bootstrap 控制面” action（`fed_join_snapshot_*`、`fed_tip_*`、bootstrap/discovery relay），真正的数据/快照权限仍由各 handler 内部校验，避免“链路已通但成员尚未物化”时的冷启动死锁。
- join 流已携带 `introducerNodeHash`（邀请票 / deep link / API / live 探针），joiner 可立即外拨 introducer，减少纯 discovery 冷启动窗口。
- `p2p/live` 回归已稳定：`run.mjs` 逐文件子进程；`backpressure_smoke` 走 `createLink` 握手；`group_link_set_mock` 双侧 `start()` + 双向 link 等待。
- 迁移收尾回归：`fount test p2p server` + `shells/chat:fed_core fed_e2e_ext fed_dm` 已通过（`fed_dm` 建议在长串 fed 套件后单独重跑，避免节点/文件锁导致的假挂起）。

## 分层

1. 发现层：可插拔 provider 表，暴露 `advertise` / `subscribe` / `sendSignal` / `onSignal`。
2. 信令层：负责 offer / answer / ICE 候选投递，可经发现表或已有 mesh 邻居转发。
3. 传输层：裸 `RTCPeerConnection` 建立双 DataChannel。
4. 链接层：握手、心跳、分帧、分片、背压、glare 收敛、逻辑链接生命周期。
5. overlay 路由层：TTL 发现、源路由、直连升级、多跳中继、断路重发现。
6. 业务派发层：`node` / `group:<id>` / `overlay` / `link` 四类 scope。

## 模块地图

### 删除

- `src/npm:@steve02081504/fount-p2p/signaling_room.mjs`
- `src/npm:@steve02081504/fount-p2p/trystero_session.mjs`
- `src/npm:@steve02081504/fount-p2p/trystero_wire_action.mjs`
- `src/npm:@steve02081504/fount-p2p/identity_announce.mjs`
- `src/public/parts/shells/chat/src/chat/federation/room.mjs`
- `src/public/parts/shells/chat/src/chat/federation/federationSlot.mjs`
- `src/public/parts/shells/chat/src/chat/federation/partitions.mjs`
- `src/public/parts/shells/chat/src/chat/federation/partitionBridge.mjs`
- join 串行队列 / rebind generation 一整套 Trystero 特化逻辑

### 新增

- `src/scripts/p2p/link/`
- `src/scripts/p2p/discovery/`
- `src/scripts/p2p/overlay/`
- `src/npm:@steve02081504/fount-p2p/transport/link_registry.mjs`
- `src/npm:@steve02081504/fount-p2p/transport/group_link_set.mjs`

### 保留但换后端

- `src/npm:@steve02081504/fount-p2p/trust_graph/send.mjs`
- `src/npm:@steve02081504/fount-p2p/transport/rtc_connection_budget.mjs`
- `src/scripts/p2p/mailbox/**`
- `src/scripts/p2p/part_wire*.mjs`
- `src/scripts/p2p/files/chunk_fetch*.mjs`
- `src/npm:@steve02081504/fount-p2p/node/network.mjs`

## 线协议

### 通道

- 每条物理连接由发起方先建两条 ordered/reliable 的 DataChannel：
  - `control`
  - `bulk`
- 路由控制、握手、心跳、优先级 <= 3 的消息走 `control`。
- 大消息和低优先级 / 大吞吐消息走 `bulk`。

### 分片帧

单帧二进制格式：

`ver(1B=1) || msgId(16B) || seq(4B BE) || total(4B BE) || chunk`

约束：

- 单帧最大 payload：15360B
- 单消息最大重组大小：8MiB
- 每 peer 最大未完成消息：32
- 未完成消息超时：30s
- 已完成 msgId 去重 LRU：4096

### Envelope

重组后 payload 为 UTF-8 JSON：

```json
{ "scope": "link" | "node" | "group:<groupId>" | "overlay", "action": "...", "payload": {} }
```

- `link`：握手、心跳，只在 link 层消费。
- `node`：定向业务消息，替代现有 user room action。
- `group:<id>`：群联邦消息，派发前强制过成员授权。
- `overlay`：路由发现、中继、错误控制。

### 握手

控制通道 open 后 10s 内完成，超时即断开。

1. 双方各发 `hello`
   - `{ v, nodeHash, nodePubKey, nonce }`
2. 收到对方 `hello` 后各发 `auth`
   - `sig = sign("fount-link-v1\0" + peerNonce + "\0" + localDtlsFingerprint + "\0" + localNodeHash)`
   - **顺序无关**：`hello`/`auth` 分属 control 通道上的两帧，双向同时建连时对端可能先收到 `auth` 后收到 `hello`（发起方 `localDescription` 早就绪，收到本方 `hello` 即回 `auth`，而其自身 `hello` 要等 data channel open 才发）。收到早到的 `auth` 必须**暂存**，待 `hello` 到达后补校验，绝不能丢弃——否则应答方 `remoteAuthVerified` 永为 false，握手超时坍塌，联邦 `members>=2` 永不满足。
3. 验证规则
   - `pubKeyHash(nodePubKey) === nodeHash`
   - 签名通过
   - 签名里的 DTLS 指纹必须等于本连接 `remoteDescription.sdp` 解析出的远端指纹
4. 握手完成前，除 `link` scope 外其它消息一律丢弃

这一步是硬性的 channel binding，防止中继节点替换 SDP 后做应用层 MITM。

### glare 收敛

- 链接键为 `nodeHash`
- 双方同时建连时：
  - 若 `selfNodeHash > peerNodeHash`，关闭“自己发起”的那条
  - 否则不动作
- 竞态窗口靠 msgId 幂等去重

### 心跳

- 每 15s 在 `control` 发一次 `ping`
- 45s 无任何入站则判死
- 判死后关闭物理连接并通知 registry 做逻辑断链

### 会合 topic

- node topic = `sha256Hex('fount-rdv-node:' + nodeHash)`
- group topic = `sha256Hex('fount-rdv-group:' + roomSecret)`

### advertise

advertise 统一格式：

```json
{ "nodeHash": "...", "nodePubKey": "...", "ts": 0, "sig": "..." }
```

其中：

`sig = sign("fount-advert-v1\0" + topic + "\0" + ts + "\0" + nodeHash)`

过滤条件：

- 验签成功
- `pubKeyHash(nodePubKey) === nodeHash`
- `ts` 距当前不超过 10 分钟

默认刷新间隔：5 分钟。

### 信令加密

- node topic 信令密钥：`kdf(sha256(nodeHash), 'signal', topic)`
- group topic 信令密钥：`kdf(roomSecret, 'signal', topic)`

这一步只用于减少 relay 可见性；node topic 本身公开可算，不承担强认证。

## 触达阶梯

```text
1. 已有到目标 nodeHash 的直连逻辑链接 -> 直接发
2. overlay 路由发现（TTL=3）
   -> 能直连则优先沿路径送信令升级
   -> 不能直连则按源路径中继
3. 无路由时走 discovery provider 表，找目标 node / 群入口成员
4. 仍不可达则转 Mailbox
```

## 安全要求

### 1. 信令中继不可信

- 应用层身份必须绑定到 DTLS 指纹
- route 响应必须由目标节点签名
- advertise 必须先验签，不能直接烧 ICE / DTLS 成本

### 2. 业务 scope 必须显式授权

- `group:<id>` 的任意入站都要查 DAG 成员表
- 中继帧也要校验来源 scope 是否允许
- 不再依赖 room password 的隐式隔离

### 3. 不惩罚转发者

沿用 `src/scripts/p2p/AGENTS.md` 约束：

- 可罚“自己签名作恶的节点”
- 不罚“只是转发了坏消息的节点”

### 4. 内存 / 带宽上界必须固定

- 分片、去重、route req、群 gossip 均要 LRU / rate limit
- 网络边界上的垃圾数据直接丢弃，不做温柔修复

## 阶段

### P0：link 层

- `src/npm:@steve02081504/fount-p2p/link/frame.mjs`
- `src/npm:@steve02081504/fount-p2p/link/handshake.mjs`
- `src/npm:@steve02081504/fount-p2p/link/sdp_fingerprint.mjs`
- `src/npm:@steve02081504/fount-p2p/link/channel_mux.mjs`
- `src/npm:@steve02081504/fount-p2p/link/rtc.mjs`
- `src/npm:@steve02081504/fount-p2p/link/link.mjs`

验收：

- 分片编解码 pure 测试
- 握手验签 pure 测试
- glare 判定 pure 测试
- 本机双 peer live smoke：2MiB 传输 + 背压事件

### P1：link_registry + discovery

- `src/npm:@steve02081504/fount-p2p/transport/link_registry.mjs`
- `src/npm:@steve02081504/fount-p2p/discovery/index.mjs`
- `src/npm:@steve02081504/fount-p2p/discovery/nostr.mjs`

验收：

- mock provider 下双向同时拨号收敛到一条链接
- 假 advertise 被签名过滤
- 真 nostr 打通一次 nodeHash 直连

### P2：群会合 + 业务换后端

- `group_link_set.mjs` 接管群活跃成员链接集
- `sendToNode` / `fanoutToTopNodes` / `deliverToUserRoomPeers` 改到 node scope
- Chat 注册 `group:` scope authorizer
- kick / ban 自动轮换 `roomSecret`
- 删 Trystero 相关模块与依赖

验收：

- `fount test p2p:sim shells/chat:integration server:live`
- 两实例群消息
- Mailbox 离线投递
- EVFS chunk 拉取

### P3：overlay 路由

`overlay` scope：

- `route_req`
- `route_resp`
- `relay`

规则：

- TTL 默认 3
- 路径长度上限 6
- `route_req` 每邻居 30/min
- 发现成功后优先尝试直连升级，失败才长期中继

验收：

- 五节点链式拓扑发现 / 中继 / 直连升级 / 断路重发现
- 伪造 `route_resp` 必须被丢弃

### P4：外围

- mDNS / BT discovery plugin
- AV
- subfounts

## 测试口径

每阶段至少执行：

- `fount test p2p`
- `fount test shells/chat:integration`
- `fount test server:live`

对于 live probe：

- 用 Deno `.mjs`
- 显式 close DataChannel 与 PeerConnection
- 避免 PowerShell 探针

## POC 结论摘要

来自 `debug_logs/p2p_overlay_simple_peer_feasibility_report.md`：

- `simple-peer` 不值得继续投入
- `node-datachannel` 可用，背压事件可用
- werift 在当前 Deno / Windows 栈上不够稳定
- ICE restart 在目标后端不可用，应按断链重建设计
