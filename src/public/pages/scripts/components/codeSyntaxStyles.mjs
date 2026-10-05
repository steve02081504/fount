/**
 * 代码高亮与折叠控件的共享样式。独立成模块，供只导出文档字符串、
 * 不该拉起整个编辑器运行时的调用方使用。
 */
export const CODE_SYNTAX_CSS = /* css */ `
.fount-code-syntax { color: var(--color-base-content); background: var(--color-base-100); }
[color-scheme*="light"] .fount-code-syntax [style*="--shiki-light"] { color: var(--shiki-light); }
[color-scheme*="dark"] .fount-code-syntax [style*="--shiki-dark"] { color: var(--shiki-dark); }
.monaco-editor .editor-widget[aria-hidden="true"] { visibility: hidden; pointer-events: none; }
.monaco-editor .inline-folded, .fount-code-fold-toggle {
	color: var(--color-base-content); background: var(--color-base-200);
	border: var(--border) solid var(--color-base-300); border-radius: var(--radius-field);
	font: inherit; cursor: pointer; padding: 0 0.25em;
}
.fount-code-fold-toggle { margin-inline: 0.2em; vertical-align: baseline; }
.fount-code-fold-toggle::before { content: '⌄'; }
.fount-code-fold-toggle[aria-expanded="false"]::before { content: '…'; }
.fount-code-fold-body[hidden] { display: none; }
.fount-code-fold-toggle:focus-visible { outline: var(--border) solid var(--color-primary); outline-offset: 2px; }
`
