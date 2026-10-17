import type { RenderContext } from '../model';
import { type AgentAdapter, type AgentId } from './types';
export declare const agentRegistry: Record<AgentId, AgentAdapter>;
export declare function getAgentAdapter(id: AgentId): AgentAdapter;
export declare function listAgentAdapters(): AgentAdapter[];
export declare function enabledAgentAdapters(context: RenderContext): AgentAdapter[];
