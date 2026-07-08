/**
 * 【文件】`dag/index.mjs` — 联邦 DAG 依赖注入入口。
 * 【职责】在 chat shell 启动时将本机 DAG 读写、远程入库与物化状态查询能力注册到联邦层。
 * 【原理】联邦模块通过 `initFederationDagDeps` 解耦具体存储实现；此处绑定 `getNodeHash`、远程追加与 `getStateForFederation`，使 P2P 同步路径能复用同一套 DAG 管线。
 * 【数据结构】无本地状态；注入对象含函数句柄与 `getStateForFederation` 回调。
 * 【关联】`../federation/dagDependencies.mjs`、`materialize.mjs`、`remoteIngest.mjs`、`storage.mjs`。
 */
import { readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { getNodeHash } from '../../../../../../../scripts/p2p/node/identity.mjs'
import { initFederationDagDeps } from '../federation/dagDependencies.mjs'


import { getStateForFederation } from './materialize.mjs'
import {
	appendValidatedRemoteEvent,
	ingestRemoteEvent,
} from './remoteIngest.mjs'

initFederationDagDeps({
	getNodeHash,
	readJsonl,
	appendValidatedRemoteEvent,
	ingestRemoteEvent,
	getStateForFederation,
})
