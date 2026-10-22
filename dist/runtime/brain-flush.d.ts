import type { RenderContext } from '../model';
/** Exit synchronization never hides an unsynced result or changes the agent's exit code. */
export declare function flushBrainOnExit(context: RenderContext): Promise<void>;
