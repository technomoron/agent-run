import type { Finding, RenderedProfile, RenderTrace, ToolName } from './model';
export declare function renderProfile(projectRoot: string, agentDir: string, checkOnly?: boolean, targetTool?: ToolName | null, trace?: RenderTrace, options?: {
    configRoot?: string;
    profile?: string;
}): RenderedProfile;
export declare function syncAgentProfile(projectRoot: string, agentDir: string, options?: {
    configRoot?: string;
    profile?: string;
}): RenderedProfile;
export declare function syncRenderedProfile(rendered: RenderedProfile): RenderedProfile;
export declare function checkRenderedProfile(projectRoot: string, agentDir: string): Finding[];
