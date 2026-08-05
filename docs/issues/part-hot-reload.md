# 部件热重载限制

> 日常开发只需知道：改后端 / 部件代码 → `fount reboot`；前端 → 刷浏览器。下面是「为什么」和「上游什么时候可能变」，不必默认阅读。

## 现状

`reloadPart()`（`src/server/parts_loader.mjs`）目前是整进程重启：真卸载 / 再加载路径被注释掉，因为 Deno 没有可用的单模块 eviction / 重编译原语。

- 跟踪：[fount#11](https://github.com/steve02081504/fount/issues/11)
- 上游表态（2026-08）：[denoland/deno#36408](https://github.com/denoland/deno/issues/36408) 关为 not planned——「接下来 3 个月不会做」。约 **2026-11** 再查。
- 能力仍挂在 [denoland/deno#27820](https://github.com/denoland/deno/issues/27820)、[denoland/deno#25780](https://github.com/denoland/deno/issues/25780)；Node 对照 [nodejs/node#61767](https://github.com/nodejs/node/pull/61767)（`module.clearCache`，停滞）。

## 不要做的事

- 不要用 `import(url + '?v=' + n)` 绕。part 是文件夹：`main.mjs` 用静态相对路径 import helper，打在入口上的 query 打不中内部依赖；且每次 bust 在 module map 里留一条永不复用的条目。
- 不要再去 V8 开 issue。阻塞不在 V8。

## 技术结论（已核实）

- `v8::Module` 是普通堆对象；root 是 embedder 的 `v8::Global`（`deno_core` module map 的 `handles` / `handles_inverted`）。「V8 里模块是 GC root、永不回收」不成立。同形泄漏在 Node 已修：[nodejs/node#33439](https://github.com/nodejs/node/issues/33439) → [nodejs/node#48510](https://github.com/nodejs/node/pull/48510)。
- [denoland/deno#34944](https://github.com/denoland/deno/pull/34944) 的路径在原理上可行：从 `by_name` 去掉条目 → 下次 `import()` 重编译。文件夹型 part 需要**目录前缀** eviction（点淘汰不够）。
- eviction 只让旧模块 *原则上* 可回收。重载循环里通常仍活着：实例化模块强引用依赖；持有 v1 的 exports / 闭包钉住整棵子图；`--inspect` 另有独立留存。原语落地后，`unloadPartBase` / `reloadPart` 必须丢掉对旧 part 的**所有**引用。

## 原语落地后要改什么

1. 补完 `reloadPart`：`unloadPartBase` → eviction（含 part 目录传递闭包）→ `loadPartBase`。
2. `restartor` 降级为故障恢复，不再是常规代码更新路径；`autoupdate.mjs` 的纯 `.mjs` 更新去掉重启。
3. `fount reboot` 降级为排障命令；本文件与根 `AGENTS.md` 的 Restart 行同步改写。
