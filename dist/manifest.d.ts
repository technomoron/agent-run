import { AgentRunManifest, NormalizedManifest, RenderTrace } from './model';
export declare function isProfileConfigured(agentDir: string): boolean;
export declare function createProfileMarker(agentDir: string): void;
export declare function ensureRootDefaultsFile(configRoot: string): void;
export declare function createDefaultLocalFile(agentDir: string): string;
export declare function convertLegacyProfileIfNeeded(agentDir: string): void;
export declare function loadManifest(configRoot: string, agentDir: string, profile: string, trace?: RenderTrace): AgentRunManifest;
export declare function normalizeManifest(manifest: AgentRunManifest, profile: string): NormalizedManifest;
