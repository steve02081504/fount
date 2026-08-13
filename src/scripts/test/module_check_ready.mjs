/**
 * 模组检查窗口结束信号：模块图已物化、JS 开始执行。
 * 由 env.mjs 导入，或经 deno `--preload` 注入到不 import env 的 `deno test`/`run` 子进程。
 */
import process from 'node:process'

import { signalModuleCheckReady } from './hub/clients/module_check.mjs'

const ticket = process.env.FOUNT_TEST_MODULE_CHECK_TICKET
if (ticket) await signalModuleCheckReady(ticket)
