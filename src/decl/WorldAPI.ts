import { chatReply_t, chatReplyRequest_t } from "../public/shells/chat/decl/chatLog";
import { locale_t } from "./basedefs";
import { prompt_struct_t, single_part_prompt_t } from "./prompt_struct";

export class WorldAPI_t {
	info: Record<locale_t, {
		name: string;
		avatar: string;
		description: string;
		description_markdown: string;
		version: string;
		author: string;
		homepage: string;
		issuepage: string;
		tags: string[];
	}>;
	// calls only on install, and if fail, all file under this persona's folder will be deleted
	Init: () => void;
	// calls on every start, pop a message if fail
	Load: () => void;
	// calls on every unload
	Unload: (reason: string) => void;
	// calls on uninstall
	Uninstall: (reason: string, from: string) => void;

	interfacies: {
		chat: {
			GetGreetings: (arg: chatReplyRequest_t) => Promise<chatReply_t[]>
			GetGroupGreetings: (arg: chatReplyRequest_t) => Promise<chatReply_t[]>
			GetPrompt: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
		}
	};
}
