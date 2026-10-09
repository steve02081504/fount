// 临时绕过 denoland/deno#36992：`deno run --no-config`（`deno install` 生成的 eslint shim 就是这么跑的）
// 会把这条图里的 peer `typescript@>=4.8.4 <6.1.0` 解析成超范围的 7.0.2，于是 @typescript-eslint/typescript-estree
// 在 require 阶段就崩（TS 7 的包根只导出 version，没有编译器 API，`ts.Extension` 为 undefined）。
// 显式把 6.0.3 放进图里可让 peer 解析回满足范围的版本；issue 修好后删掉这一行即可。
import 'npm:typescript@6.0.3'
import config from 'https://cdn.jsdelivr.net/gh/steve02081504/my-eslint-config/deno.mjs'
/**
 * ESLint 配置。
 * @type {import('npm:eslint').Linter.FlatConfig[]}
 */
export default config
