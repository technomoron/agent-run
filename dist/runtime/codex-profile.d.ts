import type { RenderContext } from '../model';
export declare function codexSharedHome(context: Pick<RenderContext, 'configRoot'>): string;
export declare function codexProfileName(context: Pick<RenderContext, 'profileDir'>): string;
export declare function codexProfileSkills(context: Pick<RenderContext, 'configRoot' | 'profileDir'>): string;
export declare function renderCodexProfile(context: RenderContext, base: string, instructions: string): string;
export declare function refreshCodexProfileSkills(context: RenderContext): void;
export declare function writeCodexProfileFile(file: string, content: string): void;
export declare function withCodexProfileLock<T>(context: RenderContext, run: () => T): T;
export declare function migrateCodexSessions(legacyHome: string, sharedHome: string): void;
