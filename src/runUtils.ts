/**
 * Run management utilities for Virtual Client extension
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { sanitizeLabel } from './utils';
import { UNKNOWN_LABEL, UNKNOWN_IP, JSON_FILE_EXTENSION, LOGS_DIR_NAME, LOG_LABEL_PREFIX } from './constants';
import { ensureDirectoryExistsWithLogging } from './fileUtils';
import type { Logger } from './types';

/**
 * Extract run label from step or run object
 */
export function extractRunLabel(stepOrRun: any): string | null {
    // First check if the object has runLabel property set
    if (stepOrRun && stepOrRun.runLabel) {
        return stepOrRun.runLabel;
    }

    let runLabel = '';
    let logFileName = '';

    if (stepOrRun && stepOrRun.label && typeof stepOrRun.label === 'string' && stepOrRun.label.startsWith(LOG_LABEL_PREFIX)) {
        logFileName = stepOrRun.label.substring(LOG_LABEL_PREFIX.length);
        if (stepOrRun.parent && stepOrRun.parent.label) {
            if (stepOrRun.parent.parent && stepOrRun.parent.parent.label) {
                runLabel = stepOrRun.parent.parent.label;
            } else {
                runLabel = stepOrRun.parent.label;
            }
        }
    } else if (stepOrRun && stepOrRun.label) {
        if (stepOrRun.label === 'Logs' && stepOrRun.parent && stepOrRun.parent.label) {
            runLabel = stepOrRun.parent.label;
        } else {
            // For non-log steps, try to find run label in parent hierarchy
            let current = stepOrRun;
            while (current && current.parent) {
                if (current.parent.runLabel) {
                    runLabel = current.parent.runLabel;
                    break;
                }
                if (current.parent.label && !current.parent.label.includes('Step') && !current.parent.label.includes('Logs')) {
                    runLabel = current.parent.label;
                    break;
                }
                current = current.parent;
            }
            
            // If no run label found in parents and this looks like a run label, use it
            if (!runLabel && stepOrRun.label && !stepOrRun.label.includes('Step') && !stepOrRun.label.includes('Logs')) {
                runLabel = stepOrRun.label;
            }
        }
    }

    return runLabel || null;
}

/**
 * Generate unique run ID
 */
export function generateRunId(): string {
    return `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create timestamped filename for run persistence
 */
export function createTimestampedFilename(
    prefix: string,
    extension: string,
    machineLabel?: string,
    machineIp?: string
): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeLabel = typeof machineLabel === 'string' ? sanitizeLabel(machineLabel) : UNKNOWN_LABEL;
    const safeIp = typeof machineIp === 'string' ? machineIp : UNKNOWN_IP;
    return `${timestamp}_${safeLabel}(${safeIp})${extension}`;
}

/**
 * Save last run parameters to global state
 */
export async function saveLastRunParameters(
    context: vscode.ExtensionContext,
    parameters: any
): Promise<void> {
    // Remove sensitive or temporary data before saving
    const { remoteTargetDir, ...paramsToSave } = parameters;
    await context.globalState.update('lastParameters', paramsToSave);
}

/**
 * Load last run parameters from global state
 */
export async function loadLastRunParameters(
    context: vscode.ExtensionContext
): Promise<any> {
    return await context.globalState.get('lastParameters', {});
}

/**
 * Save scheduled run to disk
 */
export async function saveScheduledRunToDisk(
    context: vscode.ExtensionContext,
    run: any,
    logger?: Logger
): Promise<void> {
    const filename = createTimestampedFilename('', JSON_FILE_EXTENSION, run.machineLabel, run.machineIp);
    const logsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME);
    const filePath = path.join(logsDir, filename);
    
    try {
        await ensureDirectoryExistsWithLogging(logsDir, logger);
        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(filePath),
            Buffer.from(JSON.stringify(run, null, 2), 'utf8')
        );
        logger?.info?.(`Scheduled run saved to ${filePath}`);
        vscode.window.showInformationMessage(`Scheduled run saved to ${filePath}`);
    } catch (error) {
        const message = `Failed to save run: ${error instanceof Error ? error.message : error}`;
        logger?.error?.(message);
        vscode.window.showErrorMessage(message);
        throw error;
    }
}

/**
 * Get log file path for a run
 */
export function getLogFilePath(
    context: vscode.ExtensionContext,
    runLabel: string,
    logFileName?: string
): string {
    const logsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME);
    
    if (logFileName) {
        const runLogsDir = path.join(logsDir, sanitizeLabel(runLabel));
        return path.join(runLogsDir, logFileName);
    } else {
        const safeLabel = runLabel.replace(/[\\/:"*?<>|,]/g, '-');
        return path.join(logsDir, `${safeLabel}.log`);
    }
}
