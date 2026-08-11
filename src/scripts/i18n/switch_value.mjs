/**
 * 后端入口：与前端同构的 switch 叶子解析（单一实现见 pages）。
 */
export {
	areLocaleLeafKindsCompatible,
	isSwitchValue,
	resolveSwitchCase,
} from '../../public/pages/scripts/i18n/switch_value.mjs'
