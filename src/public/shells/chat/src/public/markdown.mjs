var converter = new showdown.Converter({
	strikethrough: true,
	tables: true,
	tasklists: true,
	openLinksInNewWindows: true,
	underline: true,
	simpleLineBreaks: true,
	emoji: true,
	disableForced4SpacesIndentedSublists: true,
})

export function renderMarkdown(markdown) {
	return converter.makeHtml(markdown)
}
