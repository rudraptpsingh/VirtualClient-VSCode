/**
 * Log file tree building utilities
 */
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { ScheduledRunStep } from './ScheduledRunsProvider';
import { LOG_LABEL_PREFIX, LOGS_ZIP, LOGS_TAR } from './constants';

/**
 * Recursively build log file tree structure
 */
export async function buildLogFileTree(
    baseDir: string,
    parentStep: ScheduledRunStep,
    runLabel: string,
    relativePath: string = ''
): Promise<ScheduledRunStep[]> {
    const entries = await fsPromises.readdir(baseDir, { withFileTypes: true });
    
    const stepsPromises = entries.map(async (entry) => {
        // Skip archive files
        if (entry.name === LOGS_ZIP || entry.name === LOGS_TAR) { 
            return null; 
        }
        
        const fullPath = path.join(baseDir, entry.name);
        const entryRelPath = relativePath ? path.posix.join(relativePath, entry.name) : entry.name;
        
        if (entry.isDirectory()) {
            const folderStep = new ScheduledRunStep(entry.name, 'success', undefined);
            (folderStep as any).parent = parentStep;
            (folderStep as any).runLabel = runLabel;
            folderStep.substeps = await buildLogFileTree(fullPath, folderStep, runLabel, entryRelPath);
            return folderStep;
        } else if (entry.isFile()) {
            const logStep = new ScheduledRunStep(`${LOG_LABEL_PREFIX}${entry.name}`, 'success', undefined);
            (logStep as any).parent = parentStep;
            (logStep as any).runLabel = runLabel;
            (logStep as any).relativePath = entryRelPath;
            return logStep;
        }
        
        return null;
    });
    
    const steps = (await Promise.all(stepsPromises)).filter(s => s !== null) as ScheduledRunStep[];
    return steps;
}
