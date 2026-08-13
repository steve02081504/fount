/**
 * part 路径 ↔ `/parts/…` URL 纯转换（SSOT 实现在 pages/scripts/lib，供 Deno 再导出）。
 */
export {
	PART_PUBLIC_DIR,
	partpathToUrlPartKey,
	partpathToUrlPrefix,
	urlPartKeyToPartpath,
	parsePartsUrlPath,
	partPublicRelToBrowserPath,
} from '../public/pages/scripts/lib/partPaths.mjs'
