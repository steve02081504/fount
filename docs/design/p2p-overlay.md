# fount P2P Overlay 架构

更新：`2026-07-12`

> 核心实现在 npm 包 [@steve02081504/fount-p2p](https://github.com/steve02081504/fount-p2p) 与 monorepo `src/scripts/p2p/`。本文描述**架构目标、分层与线协议**；实施状态以代码与 `fount test p2p` / `shells/chat:fed_*` 为准。

## 目标

- **nodeHash 中心**：一 `nodeHash` 一条逻辑链接，跨群复用物理传输。
- **分层解耦**：发现、信令、传输、overlay 路由、业务派发各自独立。
- **Nostr 可插拔**：降为发现源之一，与 mDNS / BT 并列。
- **Mailbox 复用**：定向投递 / 离线继续复用现有 Mailbox，键仍是收件人 `pubKeyHash`。
- **握手显式授权**：challenge-response + DTLS 指纹绑定，不以房间口令隐式授权。

## 非目标

- 首版不要求 LAN / BT 自带独立传输（BT 为发现插件，默认关）。
- 首版不要求 ICE restart；网络切换后允许断链重建。
- AV 继续保留服务端 `av-relay`，不走 node-datachannel 主路径。

## 已拍板决策

| 决策 | 内容 |
| --- | --- |
| 传输后端 | 裸 `RTCPeerConnection` + `node-datachannel`；`simple-peer`、werift 已移除 |
| Windows ICE | 生产路径固定依赖 ICE server；mDNS 策略 `drop` |
| 逻辑链接 | 一 nodeHash 一链接；物理断了走重发现 / 重建 |
| 握手授权 | challenge-response + DTLS 指纹绑定；不再用 `identity_announce` / room password 隐式授权 |
| 群授权 | `groupProofs` 从握手中移除；群授权后置到 `group:` scope authorizer |
| Gossip | 群内在 overlay 就位前保留一跳 gossip 补位 |
| 轮换 | kick / ban 事件自动轮换 `roomSecret` |

## 落地概况

**P0–P2 已完成**（link 层、link_registry、discovery、group_link_set、Chat 联邦）。**P3 overlay 路由**已在 `link_registry.mjs` 接入（`createOverlayRouter`，直连失败时 relay）。**P4 外围**（mDNS/BT discovery、subfounts 全量对齐）部分完成。

要点：

- `ensureLinkToNode`：直连优先 → overlay relay → discovery → Mailbox。
- Chat 群联邦经 `createGroupLinkSet`（`room.mjs`）；`FederationSlot` / `partitionBridge` 等为 chat 侧出站抽象，底层走 node/group scope envelope。
- 发现层默认 `mdns` + `nostr`；BT 需 `FOUNT_ENABLE_BT_DISCOVERY=1`。
- 房主在 `group_link_set.start()` 主动拉起 discovery，避免「只有自己一个成员」的暗房。
- `group:` scope 放行少量前成员 bootstrap 控制面 action，数据权限仍由各 handler 校验。
- join 流携带 `introducerNodeHash`，减少纯 discovery 冷启动窗口。

回归口径：`fount test p2p` + `shells/chat:fed_core fed_e2e_extended fed_dm`（`fed_dm` 长串后建议单独重跑）。

## 分层

```text
发现层 → 信令层 → 传输层 → 链接层 → overlay 路由层 → 业务派发层
```

1. **发现层**：可插拔 provider（`mdns` / `nostr` / `bt`），暴露 `advertise` / `subscribe` / `sendSignal` / `onSignal`。
2. **信令层**：offer / answer / ICE 候选投递，可经发现表或 mesh 邻居转发。
3. **传输层**：裸 `RTCPeerConnection` 建立双 DataChannel（`control` + `bulk`）。
4. **链接层**：握手、心跳、分帧、分片、背压、glare 收敛、逻辑链接生命周期。
5. **overlay 路由层**：TTL 发现、源路由、直连升级、多跳中继、断路重发现。
6. **业务派发层**：`node` / `group:<id>` / `overlay` / `link` 四类 scope。

## 模块职责

| 区域 | 路径 | 职责 |
| --- | --- | --- |
| Link 协议 | `src/scripts/p2p/link/` | 分帧、握手、SDP 指纹、channel mux、RTC 封装 |
| 链接注册表 | `src/scripts/p2p/link_registry.mjs` | discovery 编排、直连、overlay relay、Mailbox 回退 |
| 群链接集 | `src/scripts/p2p/group_link_set.mjs` | 群活跃成员链接集、roomSecret、discovery 生命周期 |
| Overlay | `src/scripts/p2p/overlay/index.mjs` | `route_req` / `route_resp` / `relay` 多跳路由 |
| 发现 | `src/scripts/p2p/discovery/` | provider 注册与调度 |
| Mailbox | `src/scripts/p2p/mailbox/` | 离线定向投递 |
| TrustGraph | `src/scripts/p2p/trust_graph_send.mjs` 等 | 探索 fanout、信誉 |
| Chat 联邦 | `shells/chat/src/chat/federation/` | `group:` scope authorizer、DAG sync、partition 抽象 |
| Server 胶水 | `src/server/p2p_server/` | Node 启动、HTTP `/api/p2p/*` |
| 类型 | `src/decl/p2pAPI.ts` | fount 侧 P2P API 声明 |

npm 包侧：`transport/link_registry.mjs`、`transport/group_link_set.mjs`、`trust_graph/send.mjs`、`node/network.mjs` 等（详见 `src/server/p2p_server/AGENTS.md`）。

## 线协议

### 通道

每条物理连接由发起方先建两条 ordered/reliable 的 DataChannel：

- **`control`**：路由控制、握手、心跳、优先级 ≤ 3 的消息。
- **`bulk`**：大消息和低优先级 / 大吞吐消息。

### 分片帧

单帧二进制格式：

`ver(1B=1) || msgId(16B) || seq(4B BE) || total(4B BE) || chunk`

约束：单帧 payload 15360B；单消息最大 8MiB；每 peer 最多 32 条未完成消息；超时 30s；已完成 msgId LRU 4096。

### Envelope

重组后 payload 为 UTF-8 JSON：

```json
{ "scope": "link" | "node" | "group:<groupId>" | "overlay", "action": "...", "payload": {} }
```

| scope | 用途 |
| --- | --- |
| `link` | 握手、心跳；只在 link 层消费 |
| `node` | 定向业务消息 |
| `group:<id>` | 群联邦消息；派发前强制过成员授权 |
| `overlay` | 路由发现、中继、错误控制 |

### 握手

控制通道 open 后 10s 内完成，超时断开。

1. 双方各发 `hello`：`{ v, nodeHash, nodePubKey, nonce }`
2. 收到对方 `hello` 后各发 `auth`：`sig = sign("fount-link-v1\0" + peerNonce + "\0" + localDtlsFingerprint + "\0" + localNodeHash)`
3. **顺序无关**：早到的 `auth` 必须暂存，待 `hello` 到达后补校验——否则应答方 `remoteAuthVerified` 永为 false。
4. 验证：`pubKeyHash(nodePubKey) === nodeHash`、签名通过、DTLS 指纹与 `remoteDescription.sdp` 一致。
5. 握手完成前，除 `link` scope 外其它消息一律丢弃。

这是硬性 channel binding，防止中继节点替换 SDP 后做应用层 MITM。

### glare 收敛

链接键为 `nodeHash`。双方同时建连时：若 `selfNodeHash > peerNodeHash`，关闭「自己发起」的那条；否则不动作。竞态窗口靠 msgId 幂等去重。

### 心跳

每 15s 在 `control` 发 `ping`；45s 无入站判死；关闭物理连接并通知 registry 做逻辑断链。

### 会合 topic

- node topic = `sha256Hex('fount-rdv-node:' + nodeHash)`
- group topic = `sha256Hex('fount-rdv-group:' + roomSecret)`

### advertise

```json
{ "nodeHash": "...", "nodePubKey": "...", "ts": 0, "sig": "..." }
```

`sig = sign("fount-advert-v1\0" + topic + "\0" + ts + "\0" + nodeHash)`。过滤：验签成功、`pubKeyHash(nodePubKey) === nodeHash`、`ts` 不超过 10 分钟。默认刷新间隔 5 分钟。

### 信令加密

- node topic：`kdf(sha256(nodeHash), 'signal', topic)`
- group topic：`kdf(roomSecret, 'signal', topic)`

只用于减少 relay 可见性；node topic 本身公开可算，不承担强认证。

## 触达阶梯

```text
1. 已有到目标 nodeHash 的直连逻辑链接 → 直接发
2. overlay 路由发现（TTL=3）→ 能直连则升级，否则按源路径中继
3. 无路由 → discovery provider 表
4. 仍不可达 → Mailbox
```

## 安全要求

### 信令中继不可信

- 应用层身份必须绑定到 DTLS 指纹。
- `route_resp` 必须由目标节点签名。
- advertise 必须先验签，不能直接烧 ICE / DTLS 成本。

### 业务 scope 必须显式授权

- `group:<id>` 任意入站查 DAG 成员表。
- 中继帧校验来源 scope 是否允许。
- 不再依赖 room password 隐式隔离。

### 不惩罚转发者

- 可罚「自己签名作恶的节点」。
- 不罚「只是转发了坏消息的节点」。

### 内存 / 带宽上界固定

分片、去重、route req、群 gossip 均要 LRU / rate limit。网络边界垃圾数据直接丢弃，不做温柔修复。

## overlay 路由规则（P3）

`overlay` scope action：`route_req`、`route_resp`、`relay`。

- TTL 默认 3；路径长度上限 6。
- `route_req` 每邻居 30/min。
- 发现成功后优先直连升级，失败才长期中继。
- 伪造 `route_resp` 必须丢弃。

## 测试口径

每阶段至少：

- `fount test p2p`
- `fount test shells/chat:integration`（含 `fed_*`）
- `fount test server:live`（live probe 用 Deno `.mjs`，显式 close DataChannel 与 PeerConnection）

Windows 本地验证优先 `fount test --no-parallel`，避免 `node_modules` 并发争用。

## 技术选型备忘

- `simple-peer` 不值得继续投入；`node-datachannel` 可用，背压事件可用。
- werift 在 Deno / Windows 栈上不够稳定。
- ICE restart 在目标后端不可用，按断链重建设计。
