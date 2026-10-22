import { ToolName } from './model';
export declare function findRealBinary(tool: ToolName, searchPath?: string): string;
export declare function execCommand(command: string, args: string[], env?: Record<string, string | undefined>, cwd?: string, onExit?: (code: number) => number | Promise<number>): void;
export declare function openEditor(filePath: string): void;
export declare function parseEditorCommand(commandLine: string): string[];
