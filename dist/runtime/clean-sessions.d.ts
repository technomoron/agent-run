import type { ToolName } from '../model';
export declare function sessionRetentionDays(configRoot: string): number;
export type CleanupResult = {
    agent: ToolName;
    removed: number;
    errors: string[];
};
export declare function cleanSessions(configRoot: string, agents?: readonly ToolName[], all?: boolean, now?: number, retentionDays?: number): CleanupResult[];
export declare function reportCleanup(results: CleanupResult[], explicit?: boolean): void;
