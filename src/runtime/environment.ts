import * as path from 'path';
import type { RenderContext } from '../model';

export function buildAgentEnvironment(context: RenderContext): Record<string, string | undefined> {
	const realPath = process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH ?? '';
	return {
		...process.env,
		AGENT_DIR: context.paths.liveDir,
		AGENT_PROFILE_DIR: context.profileDir,
		AGENT_RUN_PROJECT_ROOT: context.projectRoot,
		AGENT_PROJECT_MEMORY_DIR: context.paths.projectMemoryDir,
		AGENT_GLOBAL_MEMORY_DIR: context.paths.globalMemoryDir,
		AGENT_RUN_REAL_PATH: realPath,
		PATH: `${context.paths.binDir}${path.delimiter}${realPath}`
	};
}
