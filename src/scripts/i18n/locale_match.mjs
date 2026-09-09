/**
 * 区域设置匹配纯函数（零依赖）：SSOT 实现在 pages/scripts/i18n（前后端共用），Deno 侧经此再导出。
 */
export {
	FALLBACK_LOCALE,
	getBestLocale,
	matchLocale,
	pickLocalizedSlice,
} from '../../public/pages/scripts/i18n/locale_match.mjs'
