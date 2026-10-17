import type { AgentId, AgentRuntime } from './types';
import type { WrapperArgs } from '../model';
export declare function assertRuntimeFile(tool: AgentId, filePath: string, profileDir: string): void;
export declare function withPostflight(runtime: AgentRuntime, wrapperArgs: WrapperArgs): (code: number) => number;
