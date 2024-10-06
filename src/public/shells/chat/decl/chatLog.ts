import { timeStamp_t } from '../../../../decl/basedefs.ts';
import { charAPI_t } from '../../../../decl/charAPI.ts';
import { WorldAPI_t } from '../../../../decl/WorldAPI.ts';
import { UserAPI_t } from '../../../../decl/UserAPI.ts';

export class chatLogEntry_t {
	charName: string;
	avatar: string;
	timeStamp: timeStamp_t;
	role: string;
	content: string;
	extension: {
		timeSlice: {
			chars: Map<string, charAPI_t>;
			summary: string;
			world: WorldAPI_t;
			player: UserAPI_t;
		}
	};
}
export type chatLog_t = chatLogEntry_t[];
