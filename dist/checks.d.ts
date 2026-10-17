import { Finding } from './model';
export declare function checkProject(projectRoot: string): Finding[];
export declare function checkSourceTree(rootPath: string): {
    entries: Array<{
        findings: Finding[];
        label: string;
    }>;
    hasErrors: boolean;
    root: string;
};
export declare function printProjectReport(projectRoot: string, findings: Finding[]): void;
export declare function printBatchReport(rootPath: string, entries: Array<{
    findings: Finding[];
    label: string;
}>): void;
export declare function hasErrors(findings: Finding[]): boolean;
