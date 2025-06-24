export type timeStamp_t = number;
export type locale_t = string;
export type role_t = 'user' | 'char' | 'system' | 'world' | 'tool';
export type info_t = Record<locale_t, {
	name: string;
	avatar: string;
	description: string;
	description_markdown: string;
	version: string;
	author: string;
	home_page: string;
	issue_page: string;
	tags: string[];
}>
