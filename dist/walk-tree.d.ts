import * as fs from 'fs';
import { WalkVisitorResult } from './model';
type WalkOptions = {
    shouldPrune?: (entry: fs.Dirent) => boolean;
    shouldSkipDirectory?: (dir: string) => boolean;
};
export declare function walkTree(dir: string, visitor: (fullPath: string, entry: fs.Dirent) => WalkVisitorResult, options?: WalkOptions): void;
export {};
