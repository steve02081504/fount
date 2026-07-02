# API 洁癖大扫除 — 统一术语表

## 身份/哈希族

| 名称 | 含义 |
|------|------|
| `nodeHash` | 节点身份哈希（64 hex） |
| `entityHash` | 实体身份哈希（128-bit），**只走 recovery 锚定派生** |
| `pubKeyHash` | 某把具体公钥的哈希（成员密钥、消息 sender） |
| `recoveryPubKeyHex` | recovery 公钥（稳定身份锚） |
| `activePubKeyHex` | 活跃 operator 公钥（联邦 wire 签名用） |

**禁止**：`identityPubKeyHex` 别名、`userEntityHashFromPubKeyHex` legacy 路径

## 拉黑三层

| 名称 | 层 | 说明 |
|------|-----|------|
| `denylist` | P2P 基础设施 | 原 blocklist，scope: subject/entity/node |
| `hide` | 个人本地 | 纯本地，不联邦 |
| `block` | Social 联邦 | 公开时间线事件，真相源 |

## 密钥轮换三种

| 名称 | 对象 |
|------|------|
| `file_master_key_rotate` | 群文件主密钥 GSH，HTTP `…/file-key-rotate` |
| `channel_key_rotate` | 频道 E2E K_ch |
| （operator active key） | operator 活跃钥轮换，非 chat 域 |

## HTTP 约定

- 成功 2xx 返回资源本体或有意义对象，禁止空 `{}` 与同义冗余
- 错误统一 `httpError`
- JSON 字段全 camelCase
- 路由注册字面量转义 `shells\:chat`

## 执行原则

- 禁止兼容开洞、fallback、legacy 分支
- 测试断言旧契约则改测试，禁止产品代码开洞
- 每阶段 eslint + 分域冒烟测试
