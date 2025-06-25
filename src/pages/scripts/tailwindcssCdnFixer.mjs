// --- 1. 统一的、描述性的配置中心 ---
const classConfigs = [
	// 间距和尺寸 (使用 rem 单位)
	{
		type: 'spacing', supportsFractions: true, configs: [
			{ prefix: 'w-', property: 'width' },
			{ prefix: 'h-', property: 'height' },
			{ prefix: 'max-w-', property: 'max-width' },
			{ prefix: 'max-h-', property: 'max-height' },
			{ prefix: 'min-w-', property: 'min-width' },
			{ prefix: 'min-h-', property: 'min-height' },
			{ prefix: 'basis-', property: 'flex-basis' },
			{ prefix: 'm-', property: 'margin' },
			{ prefix: 'mt-', property: 'margin-top' },
			{ prefix: 'mr-', property: 'margin-right' },
			{ prefix: 'mb-', property: 'margin-bottom' },
			{ prefix: 'ml-', property: 'margin-left' },
			{ prefix: 'mx-', property: 'margin-left, margin-right' },
			{ prefix: 'my-', property: 'margin-top, margin-bottom' },
			{ prefix: 'p-', property: 'padding' },
			{ prefix: 'pt-', property: 'padding-top' },
			{ prefix: 'pr-', property: 'padding-right' },
			{ prefix: 'pb-', property: 'padding-bottom' },
			{ prefix: 'pl-', property: 'padding-left' },
			{ prefix: 'px-', property: 'padding-left, padding-right' },
			{ prefix: 'py-', property: 'padding-top, padding-bottom' },
			{ prefix: 'inset-', property: 'top, right, bottom, left' },
			{ prefix: 'inset-x-', property: 'left, right' },
			{ prefix: 'inset-y-', property: 'top, bottom' },
			{ prefix: 'top-', property: 'top' },
			{ prefix: 'right-', property: 'right' },
			{ prefix: 'bottom-', property: 'bottom' },
			{ prefix: 'left-', property: 'left' },
			{ prefix: 'gap-', property: 'gap' },
			{ prefix: 'gap-x-', property: 'column-gap' },
			{ prefix: 'gap-y-', property: 'row-gap' },
			{ prefix: 'indent-', property: 'text-indent' },
			{ prefix: 'scroll-m-', property: 'scroll-margin' },
			{ prefix: 'scroll-mt-', property: 'scroll-margin-top' },
			{ prefix: 'scroll-mr-', property: 'scroll-margin-right' },
			{ prefix: 'scroll-mb-', property: 'scroll-margin-bottom' },
			{ prefix: 'scroll-ml-', property: 'scroll-margin-left' },
			{ prefix: 'scroll-mx-', property: 'scroll-margin-left, scroll-margin-right' },
			{ prefix: 'scroll-my-', property: 'scroll-margin-top, scroll-margin-bottom' },
			{ prefix: 'scroll-p-', property: 'scroll-padding' },
			{ prefix: 'scroll-pt-', property: 'scroll-padding-top' },
			{ prefix: 'scroll-pr-', property: 'scroll-padding-right' },
			{ prefix: 'scroll-pb-', property: 'scroll-padding-bottom' },
			{ prefix: 'scroll-pl-', property: 'scroll-padding-left' },
			{ prefix: 'scroll-px-', property: 'scroll-padding-left, scroll-padding-right' },
			{ prefix: 'scroll-py-', property: 'scroll-padding-top, scroll-padding-bottom' },
		]
	},
	// 边框 (width 和 radius)
	{
		type: 'spacing', configs: [
			{ prefix: 'border-', property: 'border-width' },
			{ prefix: 'border-t-', property: 'border-top-width' },
			{ prefix: 'border-r-', property: 'border-right-width' },
			{ prefix: 'border-b-', property: 'border-bottom-width' },
			{ prefix: 'border-l-', property: 'border-left-width' },
			{ prefix: 'border-x-', property: 'border-left-width, border-right-width' },
			{ prefix: 'border-y-', property: 'border-top-width, border-bottom-width' },
			{ prefix: 'rounded-', property: 'border-radius' },
			{ prefix: 'rounded-t-', property: 'border-top-left-radius, border-top-right-radius' },
			{ prefix: 'rounded-r-', property: 'border-top-right-radius, border-bottom-right-radius' },
			{ prefix: 'rounded-b-', property: 'border-bottom-left-radius, border-bottom-right-radius' },
			{ prefix: 'rounded-l-', property: 'border-top-left-radius, border-bottom-left-radius' },
			{ prefix: 'rounded-tl-', property: 'border-top-left-radius' },
			{ prefix: 'rounded-tr-', property: 'border-top-right-radius' },
			{ prefix: 'rounded-br-', property: 'border-bottom-right-radius' },
			{ prefix: 'rounded-bl-', property: 'border-bottom-left-radius' },
		]
	},
	// 字体和行高
	{
		type: 'spacing', configs: [
			{ prefix: 'text-', property: 'font-size' },
			{ prefix: 'leading-', property: 'line-height' },
			{ prefix: 'tracking-', property: 'letter-spacing' },
		]
	},
	// Transform 属性 (更准确的实现)
	{
		type: 'transform', supportsFractions: true, configs: [
			{ prefix: 'scale-', transformFn: 'scale' },
			{ prefix: 'rotate-', transformFn: 'rotate', unit: 'deg' },
			{ prefix: 'translate-x-', transformFn: 'translateX' },
			{ prefix: 'translate-y-', transformFn: 'translateY' },
		]
	},
	// Filter 属性
	{
		type: 'filter', configs: [
			{ prefix: 'blur-', filterFn: 'blur', scale: 0.25, unit: 'rem' },
		]
	},
	// 特殊单位和无单位值
	{
		type: 'unitless', configs: [
			{ prefix: 'order-', property: 'order' },
			{ prefix: 'z-', property: 'z-index' },
			{ prefix: 'flex-grow-', property: 'flex-grow' },
			{ prefix: 'flex-shrink-', property: 'flex-shrink' },
			{ prefix: 'grid-cols-', property: 'grid-template-columns', template: (v) => `repeat(${v}, minmax(0, 1fr))` },
			{ prefix: 'grid-rows-', property: 'grid-template-rows', template: (v) => `repeat(${v}, minmax(0, 1fr))` },
			{ prefix: 'col-span-', property: 'grid-column', template: (v) => `span ${v} / span ${v}` },
			{ prefix: 'row-span-', property: 'grid-row', template: (v) => `span ${v} / span ${v}` },
			{ prefix: 'columns-', property: 'column-count' },
		]
	},
	// 百分比值
	{
		type: 'percentage', configs: [
			{ prefix: 'opacity-', property: 'opacity', scale: 100 },
		]
	},
	// 时间单位
	{
		type: 'time', configs: [
			{ prefix: 'duration-', property: 'transition-duration', scale: 10, unit: 'ms' },
		]
	},
	// 特殊选择器 (space 和 divide)
	{
		type: 'special_spacing', configs: [
			{ prefix: 'space-x-', property: 'margin-left' },
			{ prefix: 'space-y-', property: 'margin-top' },
		]
	},
	{
		type: 'special_divide', configs: [
			{ prefix: 'divide-x-', property: 'border-right-width' }, // 注意: 真实 Tailwind 依赖 `divide-color`
			{ prefix: 'divide-y-', property: 'border-bottom-width' }, // 这里我们简化，只设置宽度
		]
	},
	{
		type: 'variable_setter', configs: [
			{ prefix: 'ring-', variable: '--tw-ring-width', unit: 'px' },
			{ prefix: 'ring-offset-', variable: '--tw-ring-offset-width', unit: 'px' },
		]
	},
	// 宽高比
	{
		type: 'aspect_ratio', configs: [
			{ prefix: 'aspect-w-', property: '--tw-aspect-w' },
			{ prefix: 'aspect-h-', property: '--tw-aspect-h' },
		]
	}
]

function generateRule(config, rawValue, type, metadata = {}) {
	const className = `${config.prefix}${String(rawValue).replace('/', '\\/').replace('.', '_')}`
	const escapedClassName = `${config.prefix}\\[${rawValue.toString().replace('%', '\\%')}\\]` // For arbitrary values
	let value
	const properties = config.property ? config.property.split(',').map(p => p.trim()) : []
	let selectorTemplate = (cn) => `.${cn}`
	let cssDeclarations = ''

	switch (type) {
		case 'spacing':
			value = typeof rawValue === 'number' ? `${rawValue / 4}rem` : rawValue
			cssDeclarations = properties.map(p => `${p}: ${value};`).join(' ')
			break
		case 'unitless':
			value = rawValue
			const template = config.template || ((v) => v)
			cssDeclarations = properties.map(p => `${p}: ${template(value)};`).join(' ')
			break
		case 'percentage':
			value = typeof rawValue === 'number' ? `${rawValue / (metadata.scale || 100)}` : rawValue
			cssDeclarations = properties.map(p => `${p}: ${value};`).join(' ')
			break
		case 'time':
			value = typeof rawValue === 'number' ? `${rawValue * (metadata.scale || 1)}${metadata.unit || 'ms'}` : rawValue
			cssDeclarations = properties.map(p => `${p}: ${value};`).join(' ')
			break
		case 'transform':
			const unit = metadata.unit || ''
			const scale = metadata.scale || (config.transformFn === 'scale' ? 100 : 4)
			const transformValue = typeof rawValue === 'number' ? config.transformFn === 'scale' ? rawValue / scale : rawValue : rawValue.replace(/rem|px|%|deg/, '')

			value = typeof rawValue === 'string' && (rawValue.endsWith('%') || rawValue.endsWith('rem') || rawValue.endsWith('px'))
				? `${config.transformFn}(${rawValue})`
				: `${config.transformFn}(${transformValue}${unit})`
			// 注意: 真实的 Tailwind 使用 CSS 变量来组合多个 transform
			cssDeclarations = `transform: ${value};`
			break
		case 'filter':
			const filterUnit = metadata.unit || 'px'
			const filterScale = metadata.scale || 1
			value = typeof rawValue === 'number' ? `${config.filterFn}(${rawValue * filterScale}${filterUnit})` : `${config.filterFn}(${rawValue})`
			// 注意: 真实的 Tailwind 使用 CSS 变量来组合多个 filter
			cssDeclarations = `filter: ${value};`
			break
		case 'special_spacing':
			selectorTemplate = (cn) => `.${cn} > :not([hidden]) ~ :not([hidden])`
			value = typeof rawValue === 'number' ? `${rawValue / 4}rem` : rawValue
			cssDeclarations = `${config.property}: ${value};`
			break
		case 'special_divide':
			selectorTemplate = (cn) => `.${cn} > :not([hidden]) ~ :not([hidden])`
			value = typeof rawValue === 'number' ? `${rawValue}px` : rawValue // divide 通常用 px
			// 简化版：我们只设置宽度，并假设边框样式和颜色由其他类定义
			cssDeclarations = `${config.property}: ${value};`
			break
		case 'variable_setter':
			value = typeof rawValue === 'number' ? `${rawValue}${metadata.unit || 'px'}` : rawValue
			cssDeclarations = `${config.variable}: ${value};`
			break
		case 'aspect_ratio':
			value = rawValue
			cssDeclarations = `${config.property}: ${value};`
			break
		default:
			return ''
	}

	if (typeof rawValue === 'number')
		return `${selectorTemplate(className)} { ${cssDeclarations} }`

	// 处理方括号任意值
	return `${selectorTemplate(escapedClassName)} { ${cssDeclarations} }`
}

function generateTailwindNumericCSS() {
	const cssRules = []
	const maxInteger = 100
	const arbitraryValues = ['10px', '2rem', '50%']

	for (const group of classConfigs) {
		const { type, configs, ...metadata } = group

		for (const config of configs) {
			// 生成整数值规则 (1-100)
			for (let i = 1; i <= maxInteger; i++)
				cssRules.push(generateRule(config, i, type, metadata))


			// 生成方括号任意值规则
			for (const arbitraryValue of arbitraryValues)
				// 仅为有意义的类型生成任意值
				if (['spacing', 'percentage', 'time', 'transform', 'filter', 'special_spacing', 'special_divide', 'variable_setter'].includes(type))
					cssRules.push(generateRule(config, arbitraryValue, type, metadata))



			// 生成分数值规则 (如果支持)
			if (metadata.supportsFractions)
				for (let num = 1; num < 12; num++)
					for (let den = 2; den <= 12; den++) {
						if (num >= den) continue

						const className = `${config.prefix}${num}\\/${den}`
						let cssDeclarations = ''

						// 根据类型分别处理分数值的 CSS 生成
						if (type === 'transform') {
							// 对 transform 类型进行特殊处理
							let value
							if (config.transformFn === 'scale')
								// 对于 scale, 分数应转换为小数, e.g., scale(0.5)
								value = num / den
							else
								// 对于 translate, 分数应转换为百分比, e.g., translateX(50%)
								value = `${(num / den) * 100}%`

							cssDeclarations = `transform: ${config.transformFn}(${value});`

						} else if (config.property) {
							// 对 spacing 等其他有 property 属性的类型进行处理
							// 默认将分数转换为百分比, e.g., w-1/2 -> width: 50%
							const value = `${(num / den) * 100}%`
							cssDeclarations = config.property
								.split(',')
								.map(p => `${p.trim()}: ${value};`)
								.join(' ')
						}

						if (cssDeclarations)
							cssRules.push(`.${className} { ${cssDeclarations} }`)

					}


		}
	}

	// 单独处理 aspect-ratio 的组合规则
	cssRules.push(`
.aspect-video { --tw-aspect-w: 16; --tw-aspect-h: 9; aspect-ratio: var(--tw-aspect-w) / var(--tw-aspect-h); }
.aspect-auto { aspect-ratio: auto; }
.aspect-square { aspect-ratio: 1 / 1; }
[class*="aspect-w-"] { aspect-ratio: var(--tw-aspect-w) / var(--tw-aspect-h, 1); }
[class*="aspect-h-"] { aspect-ratio: var(--tw-aspect-w, 1) / var(--tw-aspect-h); }
`)

	// 添加 Ring 的基础规则
	/*
	  注意：这是一个简化的实现。
	  真实的 Tailwind 使用了更复杂的变量组合（--tw-shadow, --tw-ring-inset 等）。
	  要看到效果，一个元素需要同时拥有 .ring 和一个颜色类（如 .ring-blue-500），
	  而我们的脚本目前不生成颜色类，所以我们在这里提供一个默认颜色。
	*/
	cssRules.push(`
.ring {
	/* 定义默认变量值 */
	--tw-ring-offset-width: 0px;
	--tw-ring-width: 0px;
	--tw-ring-color: rgb(59 130 246 / 0.5); /* 默认类似 ring-blue-500/50 */
	--tw-ring-offset-color: #fff; /* 默认类似 bg-white */

	/* 应用多层 box-shadow */
	box-shadow:
		0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color),
		0 0 0 calc(var(--tw-ring-width) + var(--tw-ring-offset-width)) var(--tw-ring-color);
}
`)

	return cssRules.filter(Boolean).join('\n')
}


export function fixTailwindcssCDN() {
	const generatedCSS = generateTailwindNumericCSS()

	// 将生成的 CSS 写入到 style 标签中
	const styleElement = document.createElement('style')
	styleElement.textContent = generatedCSS
	document.head.prepend(styleElement)
}
