function generateTailwindNumericCSS() {
	const cssRules = []

	// 支持整数值的类 (更全面的列表)
	const integerClasses = {
		'w-': 'width',
		'h-': 'height',
		'max-w-': 'max-width',
		'max-h-': 'max-height',
		'min-w-': 'min-width',
		'min-h-': 'min-height',
		'basis-': 'flex-basis',
		'grid-cols-': 'grid-template-columns',
		'grid-rows-': 'grid-template-rows',
		'col-span-': 'grid-column',
		'row-span-': 'grid-row',
		'order-': 'order',
		'z-': 'z-index',
		'm-': 'margin',
		'mt-': 'margin-top',
		'mr-': 'margin-right',
		'mb-': 'margin-bottom',
		'ml-': 'margin-left',
		'mx-': 'margin-left, margin-right',
		'my-': 'margin-top, margin-bottom',
		'p-': 'padding',
		'pt-': 'padding-top',
		'pr-': 'padding-right',
		'pb-': 'padding-bottom',
		'pl-': 'padding-left',
		'px-': 'padding-left, padding-right',
		'py-': 'padding-top, padding-bottom',
		'text-': 'font-size', // 注意：实际 Tailwind text- 类有更复杂的比例
		'leading-': 'line-height', // 注意：实际 Tailwind leading- 类有预设值
		'border-': 'border-width',
		'border-t-': 'border-top-width',
		'border-r-': 'border-right-width',
		'border-b-': 'border-bottom-width',
		'border-l-': 'border-left-width',
		'border-x-': 'border-left-width, border-right-width',
		'border-y-': 'border-top-width, border-bottom-width',
		'rounded-': 'border-radius',
		'rounded-t-': 'border-top-left-radius, border-top-right-radius',
		'rounded-r-': 'border-top-right-radius, border-bottom-right-radius',
		'rounded-b-': 'border-bottom-left-radius, border-bottom-right-radius',
		'rounded-l-': 'border-top-left-radius, border-bottom-left-radius',
		'rounded-tl-': 'border-top-left-radius',
		'rounded-tr-': 'border-top-right-radius',
		'rounded-br-': 'border-bottom-right-radius',
		'rounded-bl-': 'border-bottom-left-radius',
		'opacity-': 'opacity',
		'flex-grow-': 'flex-grow',
		'flex-shrink-': 'flex-shrink',
		'duration-': 'transition-duration',
		'scale-': 'transform: scale',
		'rotate-': 'transform: rotate',
		'translate-x-': 'transform: translateX',
		'translate-y-': 'transform: translateY',
		'shadow-': 'box-shadow', // 注意：简化阴影效果
		'blur-': 'filter: blur', // 注意：简化模糊效果
		'gap-': 'gap',
		'gap-x-': 'column-gap',
		'gap-y-': 'row-gap',
		'space-x-': 'margin-left', // 注意：space-x-* 类实际更复杂，这里简化为 margin-left
		'space-y-': 'margin-top',  // 注意：space-y-* 类实际更复杂，这里简化为 margin-top
		'inset-': 'top, right, bottom, left',
		'inset-x-': 'left, right',
		'inset-y-': 'top, bottom',
		'top-': 'top',
		'right-': 'right',
		'bottom-': 'bottom',
		'left-': 'left',
		'indent-': 'text-indent',
		'tracking-': 'letter-spacing',
		'divide-x-': 'border-right-width', // 注意：divide-x-* 类实际更复杂，这里简化为 border-right-width
		'divide-y-': 'border-bottom-width', // 注意：divide-y-* 类实际更复杂，这里简化为 border-bottom-width
		'ring-offset-': 'ring-offset-width',
		'ring-': 'ring-width',
		'aspect-w-': 'aspect-ratio',
		'aspect-h-': '', // aspect-h 通常和 aspect-w 一起使用
		'scroll-m-': 'scroll-margin',
		'scroll-mt-': 'scroll-margin-top',
		'scroll-mr-': 'scroll-margin-right',
		'scroll-mb-': 'scroll-margin-bottom',
		'scroll-ml-': 'scroll-margin-left',
		'scroll-mx-': 'scroll-margin-left, scroll-margin-right',
		'scroll-my-': 'scroll-margin-top, scroll-margin-bottom',
		'scroll-p-': 'scroll-padding',
		'scroll-pt-': 'scroll-padding-top',
		'scroll-pr-': 'scroll-padding-right',
		'scroll-pb-': 'scroll-padding-bottom',
		'scroll-pl-': 'scroll-padding-left',
		'scroll-px-': 'scroll-padding-left, scroll-padding-right',
		'scroll-py-': 'scroll-padding-top, scroll-padding-bottom',
		'columns-': 'column-count',
		// ... 可以继续添加更多支持整数值的类，参考 Tailwind CSS 文档
	}

	for (const prefix in integerClasses) {
		const property = integerClasses[prefix]
		for (let i = 1; i <= 100; i++) {
			const className = `${prefix}${i}`
			let value

			if (property === 'font-size')
				value = `${i / 4}rem` // 简化 text- 类字体大小计算
			else if (property === 'line-height')
				value = `${i / 4}rem` // 简化 leading- 类行高计算
			else if (property.startsWith('margin') || property.startsWith('padding') || property === 'width' || property === 'height' || property === 'flex-basis' || property.startsWith('border-width') || property.startsWith('border-radius') || property.startsWith('inset') || property.startsWith('top') || property.startsWith('right') || property.startsWith('bottom') || property.startsWith('left') || property === 'text-indent' || property.startsWith('scroll-margin') || property.startsWith('scroll-padding') || property === 'ring-offset-width' || property === 'ring-width' || property === 'gap' || property === 'column-gap' || property === 'row-gap')
				value = `${i / 4}rem` // 大部分布局和间距相关的类使用 0.25rem 的倍数
			else if (property === 'z-index' || property === 'order' || property === 'flex-grow' || property === 'flex-shrink' || property === 'column-count' || property === 'aspect-ratio')
				value = `${i}` // z-index, order, flex-grow, flex-shrink, column-count, aspect-ratio 直接使用数字
			else if (property === 'opacity')
				value = `${i / 100}` // opacity 是 0-1 之间的值
			else if (property === 'transition-duration')
				value = `${i * 10}ms` // duration 单位是毫秒，步进 10ms
			else if (property.startsWith('transform: scale'))
				value = `${i / 100}` // scale 比例
			else if (property.startsWith('transform: rotate'))
				value = `${i}deg` // rotate 角度
			else if (property.startsWith('transform: translateX') || property.startsWith('transform: translateY'))
				value = `${i / 4}rem` // translate 单位 rem
			else if (property === 'grid-template-columns' || property === 'grid-template-rows')
				value = `repeat(${i}, minmax(0, 1fr))` // 简单的 grid-cols/rows 定义
			else if (property === 'grid-column' || property === 'grid-row')
				value = `span ${i} / span ${i}` // col-span 和 row-span
			else if (property === 'box-shadow')
				value = `0 0 ${i / 4}rem rgba(0, 0, 0, 0.1)` // 简化阴影
			else if (property === 'filter: blur')
				value = `${i / 4}rem` // 简化模糊
			else if (property === 'letter-spacing')
				value = `${i / 10}rem` // 简化字距，假设步进 0.1rem

			else if (property === 'margin-left' || property === 'margin-top' || property === 'border-right-width' || property === 'border-bottom-width')  // space-x, space-y, divide-x, divide-y 简化处理
				value = `${i / 4}rem`

			else
				value = `${i / 4}rem` // 默认使用 rem 单位


			let cssProperty = property
			if (property.includes(',')) {
				const properties = property.split(',').map(p => p.trim())
				value = properties.map(p => `${p}: ${value};`).join(' ')
				cssProperty = '' // 避免重复定义 property
			} else
				cssProperty = `${property}: ${value};`


			cssRules.push(`.${className} { ${cssProperty} }`)
		}
	}

	const fractionClasses = {
		'w-': 'width',
		'h-': 'height',
		'basis-': 'flex-basis',
		'translate-x-': 'transform: translateX',
		'translate-y-': 'transform: translateY',
		'aspect-w-': 'aspect-ratio', // aspect-w 用于分数
		'aspect-h-': 'aspect-ratio' // aspect-h 用于分数，通常和 aspect-w 一起, use same property for simplicity
		// ... 可以继续添加更多支持分数的类，参考 Tailwind CSS 文档
	}

	// 生成分数值规则 (分子 1-20, 分母 1-20)  Increased numerator range to 20 for aspect ratio flexibility
	for (const prefix in fractionClasses) {
		const property = fractionClasses[prefix]
		for (let numerator = 1; numerator <= 20; numerator++)  // Increased numerator range
			for (let denominator = 1; denominator <= 20; denominator++) {
				if (numerator >= denominator && !prefix.startsWith('aspect-')) continue // 避免生成 >=1 的分数，除非是 aspect-ratio

				// Skip aspect-h-n/d classes, as aspect-ratio is already set by aspect-w
				if (prefix === 'aspect-h-') continue

				const className = `${prefix}${numerator}/${denominator}`
				let value

				if (property === 'width' || property === 'height' || property === 'flex-basis')
					value = `${(numerator / denominator) * 100}%`
				else if (property.startsWith('transform: translateX') || property.startsWith('transform: translateY'))
					value = `${(numerator / denominator) * 100}%` // translate 使用百分比
				else if (property === 'aspect-ratio')
					value = `${numerator} / ${denominator}` // aspect-ratio 使用比例值

				else
					value = `${(numerator / denominator) * 100}%` // 默认百分比


				let cssProperty = property
				if (property.includes(',')) {
					const properties = property.split(',').map(p => p.trim())
					value = properties.map(p => `${p}: ${value};`).join(' ')
					cssProperty = '' // 避免重复定义 property
				} else
					cssProperty = `${property}: ${value};`


				cssRules.push(`.${className} { ${cssProperty} }`)
			}

	}

	// Aspect Ratio Square
	cssRules.push('.aspect-square { aspect-ratio: 1 / 1; }')


	return cssRules.join('\n')
}

export function fixTailwindcssCDN() {
	const generatedCSS = generateTailwindNumericCSS()

	// 将生成的 CSS 写入到 style 标签中
	const styleElement = document.createElement('style')
	styleElement.textContent = generatedCSS
	document.head.prepend(styleElement)
}
