/**
 * 内核模块图链接探针：作为 `deno run --preload` 注入，在用户代码执行前记录时间。
 * 仅当 `FOUNT_TEST_BENCH_PRELOAD_FILE` 设置时写文件；否则零开销。
 */
import process from 'node:process'

const file = process.env.FOUNT_TEST_BENCH_PRELOAD_FILE
if (file) {
	const { writeFileSync } = await import('node:fs')
	writeFileSync(file, JSON.stringify({ timeOrigin: performance.timeOrigin, preloadEval: performance.now() }), 'utf8')
}