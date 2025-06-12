/**
 * Run management utilities for Virtual Client extension
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { sanitizeLabel } from './utils';
import { UNKNOWN_LABEL, UNKNOWN_IP, JSON_FILE_EXTENSION, LOGS_DIR_NAME, LOG_LABEL_PREFIX, TEMPLATES_DIR_NAME } from './constants';
import { ensureDirectoryExistsWithLogging } from './fileUtils';
import type { Logger } from './types';
import { TemplateManager, RunTemplate, TemplateCategory } from './templateManager';

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

/**
 * Create a template from current run parameters
 */
export async function createTemplateFromParameters(
    context: vscode.ExtensionContext,
    templateManager: TemplateManager,
    name: string,
    description: string,
    category: TemplateCategory,
    parameters: any,
    tags?: string[]
): Promise<RunTemplate | undefined> {
    try {
        // Convert run parameters to template parameters format
        const templateParams = {
            packagePath: parameters.packagePath,
            profile: parameters.profile,
            system: parameters.system,
            timeout: parameters.timeout,
            iterations: parameters.iterations,
            exitWait: parameters.exitWait,
            dependencies: parameters.dependencies,
            parameters: parameters.parameters,
            proxyApi: parameters.proxyApi,
            packageStore: parameters.packageStore,
            eventHub: parameters.eventHub,
            experimentId: parameters.experimentId,
            clientId: parameters.clientId,
            metadata: parameters.metadata,
            port: parameters.port,
            ipAddress: parameters.ipAddress,
            contentStore: parameters.contentStore,
            contentPath: parameters.contentPath,
            layoutPath: parameters.layoutPath,
            packageDir: parameters.packageDir,
            stateDir: parameters.stateDir,
            logDir: parameters.logDir,
            logRetention: parameters.logRetention,
            seed: parameters.seed,
            scenarios: parameters.scenarios,
            logger: parameters.logger,
            wait: parameters.wait,
            logToFile: parameters.logToFile,
            clean: parameters.clean,
            debug: parameters.debug,
            failFast: parameters.failFast,
            logLevel: parameters.logLevel,
            additionalArgs: parameters.additionalArgs
        };        const template = await templateManager.saveTemplate(
            name,
            description,
            templateParams,
            category,
            tags
        );

        return template;
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create template: ${error instanceof Error ? error.message : error}`);
        return undefined;
    }
}

/**
 * Apply template parameters to form data
 */
export function applyTemplateToParameters(template: RunTemplate): any {
    return {
        // Don't include machine IP or package path from template as these are machine-specific
        profile: template.parameters.profile,
        system: template.parameters.system || '',
        timeout: template.parameters.timeout || 10,
        iterations: template.parameters.iterations || 1,
        exitWait: template.parameters.exitWait || 2,
        dependencies: template.parameters.dependencies || '',
        parameters: template.parameters.parameters || '',
        proxyApi: template.parameters.proxyApi || '',
        packageStore: template.parameters.packageStore || '',
        eventHub: template.parameters.eventHub || '',
        experimentId: template.parameters.experimentId || '',
        clientId: template.parameters.clientId || '',
        metadata: template.parameters.metadata || '',
        port: template.parameters.port || '',
        ipAddress: template.parameters.ipAddress || '',
        contentStore: template.parameters.contentStore || '',
        contentPath: template.parameters.contentPath || '',
        layoutPath: template.parameters.layoutPath || '',
        packageDir: template.parameters.packageDir || '',
        stateDir: template.parameters.stateDir || '',
        logDir: template.parameters.logDir || '',
        logRetention: template.parameters.logRetention || '',
        seed: template.parameters.seed || '',
        scenarios: template.parameters.scenarios || '',
        logger: template.parameters.logger || '',
        wait: template.parameters.wait || '',
        logToFile: template.parameters.logToFile || false,
        clean: template.parameters.clean || false,
        debug: template.parameters.debug || false,
        failFast: template.parameters.failFast || false,
        logLevel: template.parameters.logLevel || '',
        additionalArgs: template.parameters.additionalArgs || ''
    };
}

/**
 * Get predefined templates for quick start
 */
export function getPredefinedTemplates(): Partial<RunTemplate>[] {
    return [
        {
            name: 'CPU Performance Benchmark',
            description: 'Standard CPU performance testing with OpenSSL benchmark',
            category: TemplateCategory.Performance,
            parameters: {
                profile: 'PERF-CPU-OPENSSL.json',
                timeout: 30,
                iterations: 3,
                logLevel: 'Information',
                logToFile: true,
                parameters: 'PackageName=openssl'
            }
        },
        {
            name: 'Memory Stress Test',
            description: 'Memory allocation and stress testing',
            category: TemplateCategory.Stress,
            parameters: {
                profile: 'PERF-MEMORY.json',
                timeout: 60,
                iterations: 1,
                logLevel: 'Information',
                logToFile: true,
                debug: true
            }
        },
        {
            name: 'Network Performance Test',
            description: 'Network throughput and latency testing',
            category: TemplateCategory.Networking,
            parameters: {
                profile: 'PERF-NETWORK.json',
                timeout: 45,
                iterations: 2,
                logLevel: 'Information',
                logToFile: true,
                parameters: 'TestDuration=300'
            }
        },
        {
            name: 'Storage I/O Benchmark',
            description: 'Disk I/O performance testing with FIO',
            category: TemplateCategory.Storage,
            parameters: {
                profile: 'PERF-IO-FIO.json',
                timeout: 120,
                iterations: 1,
                logLevel: 'Information',
                logToFile: true,
                parameters: 'DiskFill=true;FileSize=1GB'
            }
        },
        {
            name: 'Security Baseline',
            description: 'Security configuration and vulnerability assessment',
            category: TemplateCategory.Security,
            parameters: {
                profile: 'SECURITY-BASELINE.json',
                timeout: 90,
                iterations: 1,
                logLevel: 'Debug',
                logToFile: true,
                debug: true
            }
        }
    ];
}
