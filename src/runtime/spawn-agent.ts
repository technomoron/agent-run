import type { SpawnSpec } from '../agents/types';
import { execCommand } from '../process';

export function spawnAgent(spec: SpawnSpec): void {
	execCommand(spec.command, spec.args, spec.env, spec.cwd, spec.onExit);
}
