import type { RenderContext } from '../model';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { geminiAdapter } from './gemini';
import { grokAdapter } from './grok';
import { AGENT_IDS, type AgentAdapter, type AgentId } from './types';

export const agentRegistry: Record<AgentId, AgentAdapter> = {
	codex: codexAdapter,
	claude: claudeAdapter,
	gemini: geminiAdapter,
	grok: grokAdapter
};

export function getAgentAdapter(id: AgentId): AgentAdapter {
	return agentRegistry[id];
}

export function listAgentAdapters(): AgentAdapter[] {
	return AGENT_IDS.map((id) => agentRegistry[id]);
}

export function enabledAgentAdapters(context: RenderContext): AgentAdapter[] {
	return listAgentAdapters().filter((adapter) => context.tools[adapter.id]);
}
