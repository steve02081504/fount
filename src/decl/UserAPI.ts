import { prompt_struct_t, single_part_prompt_t } from "./prompt_struct";

export class UserAPI_t {
	name: string;
	avatar: string;
	description: string;
	description_markdown: string;
	version: string;
	author: string;
	homepage: string;
	tags: string[];
	// calls only on install, and if fail, all file under this persona's folder will be deleted
	Init: () => {
		success: boolean;
		message: string;
	};
	// calls on every start, pop a message if fail
	Load: () => {
		success: boolean;
		message: string;
	};
	// calls on every unload
	Unload: (reason: string) => void;
	// calls on uninstall
	Uninstall: (reason: string, from: string) => void;

	getPrompt: (prompt_struct: prompt_struct_t) => single_part_prompt_t;
}
