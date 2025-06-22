// Node core modules
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// NPM packages
import * as ssh2 from 'ssh2';
import * as unzipper from 'unzipper';

// Local files
import { getAddMachineWebviewContent, getRunVirtualClientWebviewContent, showRunDetailsWebview } from './webviewContent';
import { VirtualClientTreeViewProvider } from './VirtualClientTreeViewProvider';
import { MachineCredentials } from './types';
import { ScheduledRunsProvider, ScheduledRunItem, ScheduledRunStep } from './ScheduledRunsProvider';
import { MachinesProvider, MachineItem } from './machinesProvider';
import { TemplateManager } from './templateManager';
import { getEnhancedRunVirtualClientWebviewContent } from './templateWebview';
import { 
    shQuote, 
    sanitizeLabel, 
    sftpMkdirRecursive, 
    sftpDownloadFile, 
    detectRemotePlatform,
    extractZip
} from './utils';

// Utility imports
import { 
    LOGS_DIR_NAME, 
    LOG_FILE_EXTENSION, 
    JSON_FILE_EXTENSION,
    REMOVE_ALL_LABEL,
    REMOVE_LABEL,
    LOG_LABEL_PREFIX,
    LOGS_ZIP,
    LOGS_TAR,
    LOGS_SUBDIR,
    UNKNOWN_LABEL,
    UNKNOWN_IP,
    WINDOWS_DEFAULT_REMOTE_DIR,
    LINUX_DEFAULT_REMOTE_DIR
} from './constants';
import { 
    isWindowsPlatform, 
    getRemotePath, 
    getDefaultRemoteTargetDir,
    getToolExecutableName,
    parseCommandLineArgs,
    buildVirtualClientCommand
} from './platformUtils';
import { 
    updateStepStatus,
    updateSubstepStatus,
    markStepAsError,
    markSubstepAsError,
    updateParentStepIfComplete,
    createRunSteps
} from './stepUtils';
import { 
    checkFileExists,
    validateFileExists,
    openFileInEditor,
    ensureDirectoryExistsWithLogging,
    deletePathRecursively,
    createSafeFileName,
    validatePackagePath
} from './fileUtils';
import { 
    isTestEnvironment,
    showConfirmationDialog,
    showErrorMessage,
    formatErrorMessage,
    getExtensionConfig
} from './envUtils';
import { 
    executeSSHCommand,
    executeSSHCommandWithStreaming,
    setupSSHConnection,
    setupSFTP,
    checkRemoteFileExists
} from './sshUtils';
import { 
    createRunLogger,
    renderProgressBar,
    logUploadProgress
} from './loggingUtils';
import { 
    extractRunLabel,
    generateRunId,
    createTimestampedFilename,
    saveLastRunParameters,
    loadLastRunParameters,
    saveScheduledRunToDisk,
    getLogFilePath
} from './runUtils';
import {
    createArchiveCommand,
    executeArchiveCommand,
    downloadAndExtractLogs,
    cleanupRemoteArchive,
    getRemoteArchivePaths,
    transferLogs
} from './archiveUtils';
import { buildLogFileTree } from './logTreeUtils';

// Global providers
export let scheduledRunsProvider: ScheduledRunsProvider;
let treeViewProvider: VirtualClientTreeViewProvider | undefined;
let machinesProvider: MachinesProvider;
let templateManager: TemplateManager;

// Resource management interface
interface ResourceManager {
    panel?: vscode.WebviewPanel;
    conn?: ssh2.Client;
    sftp?: ssh2.SFTPWrapper;
    readStream?: fs.ReadStream;
    writeStream?: fs.WriteStream;
    
    cleanup(): void;
}

class RunResourceManager implements ResourceManager {
    panel?: vscode.WebviewPanel;
    conn?: ssh2.Client;
    sftp?: ssh2.SFTPWrapper;
    readStream?: fs.ReadStream;
    writeStream?: fs.WriteStream;

    cleanup(): void {
        if (this.readStream) {
            try { this.readStream.destroy(); } catch {}
            this.readStream = undefined;
        }
        if (this.writeStream) {
            try { this.writeStream.destroy(); } catch {}
            this.writeStream = undefined;
        }
        if (this.sftp) {
            try { this.sftp.end(); } catch {}
            this.sftp = undefined;
        }
        if (this.conn) {
            try { this.conn.end(); } catch {}
            this.conn = undefined;
        }
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }
}

// Interface for webview messages
interface AddMachineMessage {
    command: 'add' | 'cancel';
    label?: string;
    ip?: string;
    username?: string;
    password?: string;
    platform?: string;
}

interface RunStep {
    label: string;
    status: 'pending' | 'running' | 'success' | 'error';
    detail?: string;
}

/**
 * Loads scheduled runs from the logs directory.
 * @param context The extension context.
 * @returns Array of scheduled run objects.
 */
export async function loadScheduledRuns(context: vscode.ExtensionContext): Promise<any[]> {
    try {
        const logsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME);
        const files = (await fsPromises.readdir(logsDir)).filter(f => f.endsWith(JSON_FILE_EXTENSION));
        const runsData = await Promise.all(files.map(async f => {
            const filePath = path.join(logsDir, f);
            try {
                const content = await fsPromises.readFile(filePath, 'utf-8');
                return JSON.parse(content);
            } catch (error) {
                vscode.window.showWarningMessage(`Failed to read or parse scheduled run file ${filePath}: ${error instanceof Error ? error.message : error}`);
                return null;
            }
        }));
        return runsData.filter(run => run !== null);
    } catch (error) {
        vscode.window.showWarningMessage('Failed to load scheduled runs: ' + (error instanceof Error ? error.message : error));
        return [];
    }
}

/**
 * Saves a scheduled run to the logs directory.
 * @param context The extension context.
 * @param run The run object to save.
 */
export async function saveScheduledRun(context: vscode.ExtensionContext, run: any): Promise<void> {
    await saveScheduledRunToDisk(context, run);
}

/**
 * Clears all files from the logs directory.
 * @param context The extension context.
 */
export async function clearLogsFolder(context: vscode.ExtensionContext): Promise<void> {
    try {
        const logsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME);
        await fsPromises.access(logsDir);
        const files = await fsPromises.readdir(logsDir);
        for (const f of files) {
            try {
                await fsPromises.unlink(path.join(logsDir, f));
            } catch (unlinkError) {
                vscode.window.showWarningMessage(`Failed to delete log file ${f}: ${unlinkError instanceof Error ? unlinkError.message : unlinkError}`);
            }
        }
        vscode.window.showInformationMessage('Scheduled run history files cleared from logs directory.');
    } catch (error) {
        vscode.window.showInformationMessage('Log folder for scheduled runs either does not exist or could not be cleared: ' + (error instanceof Error ? error.message : error));
    }
}

// Add a global cancel flag and a map to track running connections by run label
const runCancelFlags: { [label: string]: boolean } = {};
const runConnections: { [label: string]: ssh2.Client } = {};

// Add at the top, after imports
let defaultRemoteTargetDir: string | undefined;

/**
 * Activates the extension, registers providers and commands, and initializes state.
 * @param context The extension context.
 */
export async function activate(context: vscode.ExtensionContext) {    try {        // Initialize providers
        scheduledRunsProvider = new ScheduledRunsProvider(context);
        machinesProvider = new MachinesProvider(context);
        templateManager = new TemplateManager(context);
        
        // Initialize template manager
        await templateManager.initialize();
        
        // Load any existing scheduled runs
        const existingRuns = await loadScheduledRuns(context);
        for (const run of existingRuns) {
            const steps = run.steps.map((step: { label: string, status: 'pending' | 'running' | 'success' | 'error', detail?: string }) => new ScheduledRunStep(step.label, step.status, step.detail));
            scheduledRunsProvider.addRun(
                run.machineIp,
                run.packagePath,
                run.platform,
                run.profile,
                run.system,
                run.timeout,
                run.exitWait,
                run.proxyApi,
                run.packageStore,
                run.eventHub,
                run.experimentId,
                run.clientId,
                run.metadata,
                run.parameters,
                run.port,
                run.ipAddress,
                run.logToFile,
                run.clean,
                run.debug,
                run.dependencies || '',
                run.iterations || 1,
                run.logLevel || '',
                run.failFast || false,
                steps,
                run.timestamp ? new Date(run.timestamp) : undefined
            );
        }
        
        // Initialize tree view provider after machines provider
        treeViewProvider = new VirtualClientTreeViewProvider(context, [], scheduledRunsProvider);

        // Register tree view providers
        vscode.window.registerTreeDataProvider('virtualClientView', treeViewProvider);
        vscode.window.registerTreeDataProvider('machinesView', machinesProvider);

        // Register commands
        const disposables = [
            vscode.commands.registerCommand('machines.addMachine', () => handleAddMachine(context, machinesProvider)),
            vscode.commands.registerCommand('virtual-client.runVirtualClientWebview', () => handleRunVirtualClient(context)),
            vscode.commands.registerCommand('virtual-client.showRunDetails', (runItem: ScheduledRunItem) => handleShowRunDetails(context, runItem)),
            vscode.commands.registerCommand('machines.deleteMachine', (item: MachineItem) => handleDeleteMachine(context, item)),
            vscode.commands.registerCommand('virtual-client.streamLogs', async (item: ScheduledRunItem) => {
                if (item) {
                    await handleStreamLogs(context, item, scheduledRunsProvider);
                }
            }),
            vscode.commands.registerCommand('virtual-client.rerun', async (item: ScheduledRunItem) => {
                if (item) {
                    await handleRerun(context, item);
                }
            }),
            vscode.commands.registerCommand('virtual-client.showLogFiles', () => handleShowLogFiles(context)),            vscode.commands.registerCommand('virtual-client.openLogFile', async (stepOrRun: any) => {
                const runLabel = extractRunLabel(stepOrRun);
                if (!runLabel) {
                    vscode.window.showErrorMessage('Could not determine run label for log file.');
                    return;
                }
                
                // If opening a specific log file
                let logFileName = '';
                if (stepOrRun && stepOrRun.label && typeof stepOrRun.label === 'string' && stepOrRun.label.startsWith(LOG_LABEL_PREFIX)) {
                    logFileName = stepOrRun.label.substring(LOG_LABEL_PREFIX.length);
                }
                
                const logFilePath = getLogFilePath(context, runLabel, logFileName);
                if (stepOrRun.relativePath && logFileName) {
                    // Use relative path if present
                    const logsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME, sanitizeLabel(runLabel));
                    const relativePath = path.join(logsDir, ...stepOrRun.relativePath.split('/'));
                    await openFileInEditor(relativePath);
                } else {
                    await openFileInEditor(logFilePath);
                }
            }),
            vscode.commands.registerCommand('virtual-client.cancelRun', async (runLabel: string) => {
                runCancelFlags[runLabel] = true;
                if (runConnections[runLabel]) {
                    runConnections[runLabel].end();
                    delete runConnections[runLabel];
                }
                vscode.window.showInformationMessage(`Cancelled run: ${runLabel}`);
            }),            // New command to clear all scheduled runs and logs
            vscode.commands.registerCommand('virtual-client.removeAllScheduledRuns', async () => {
                const confirm = await showConfirmationDialog(
                    'Are you sure you want to remove all scheduled runs and logs? This cannot be undone.',
                    REMOVE_ALL_LABEL
                );
                
                if (confirm === REMOVE_ALL_LABEL) {
                    // Clear runs from provider using a method if available, otherwise reset and update
                    if (scheduledRunsProvider) {
                        if (typeof scheduledRunsProvider.clear === 'function') {
                            scheduledRunsProvider.clear();
                        } else if ((scheduledRunsProvider as any).runs) {
                            (scheduledRunsProvider as any).runs.length = 0;
                            scheduledRunsProvider.update();
                        }
                    }
                    // Refresh the tree view if available
                    if (treeViewProvider && typeof treeViewProvider.refresh === 'function') {
                        treeViewProvider.refresh();
                    }
                    
                    let failedDeletes: string[] = [];
                    // Delete all log files and subdirectories from logs directory only
                    const logsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME);
                    await deletePathRecursively(logsDir, failedDeletes);
                    if (failedDeletes.length > 0) {
                        vscode.window.showWarningMessage('Some log files or directories could not be deleted: ' + failedDeletes.join(', '));
                    }
                    vscode.window.showInformationMessage('All scheduled runs and logs have been cleared.');
                }
            }),            vscode.commands.registerCommand('virtual-client.openExtensionLogFile', async (runItem: ScheduledRunItem) => {
                if (!runItem || !runItem.label) {
                    vscode.window.showErrorMessage('Could not determine run label for extension log file.');
                    return;
                }
                const logFilePath = getLogFilePath(context, runItem.label);
                await openFileInEditor(logFilePath);
            }),            vscode.commands.registerCommand('virtual-client.downloadLogsZip', async (step: any) => {
                // Find the run label
                const runLabel = extractRunLabel(step);
                if (!runLabel) {
                    vscode.window.showErrorMessage('Could not determine run label for logs archive download.');
                    return;
                }
                
                const logsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME, sanitizeLabel(runLabel));
                const zipPath = path.join(logsDir, LOGS_ZIP);
                const tarPath = path.join(logsDir, LOGS_TAR);
                
                let archivePath = '';
                let archiveType = '';
                
                if (await checkFileExists(zipPath)) {
                    archivePath = zipPath;
                    archiveType = 'zip';
                } else if (await checkFileExists(tarPath)) {
                    archivePath = tarPath;
                    archiveType = 'tar.gz';
                } else {
                    vscode.window.showErrorMessage(`Neither ${LOGS_ZIP} nor ${LOGS_TAR} found or accessible in: ${logsDir}`);
                    return;
                }
                
                const defaultFileName = archiveType === 'zip' ? LOGS_ZIP : LOGS_TAR;
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(os.homedir(), defaultFileName)),
                    saveLabel: `Save logs.${archiveType} as...`
                });
                if (!uri) { return; }
                await fsPromises.copyFile(archivePath, uri.fsPath);
                vscode.window.showInformationMessage(`logs.${archiveType} saved to ${uri.fsPath}`);
            }),
            vscode.commands.registerCommand('virtual-client.refreshMachineStatus', async () => {
                if (machinesProvider && typeof machinesProvider.refreshConnectionStatus === 'function') {
                    await machinesProvider.refreshConnectionStatus();
                    vscode.window.showInformationMessage('Machine status refreshed.');
                } else {
                    vscode.window.showWarningMessage('Machines provider not available.');
                }
            }),            vscode.commands.registerCommand('virtual-client.removeScheduledRun', async (item: ScheduledRunItem) => {
                if (!item || !item.runId) {
                    vscode.window.showErrorMessage('Could not determine run to remove.');
                    return;
                }
                
                const confirm = await showConfirmationDialog(
                    `Are you sure you want to remove the scheduled run for ${item.label}?`,
                    REMOVE_LABEL
                );
                
                if (confirm === REMOVE_LABEL) {
                    scheduledRunsProvider.removeRun(item.runId);
                    vscode.window.showInformationMessage(`Scheduled run for ${item.label} has been removed.`);
                }            }),
            
            // Template management commands
            vscode.commands.registerCommand('virtual-client.saveTemplate', async (templateData: any) => {
                try {
                    const template = await templateManager.saveTemplate(
                        templateData.name,
                        templateData.description,
                        templateData.parameters,
                        templateData.category,
                        templateData.tags
                    );
                    vscode.window.showInformationMessage(`Template "${template.name}" saved successfully.`);
                    return template;
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to save template: ${error instanceof Error ? error.message : error}`);
                }
            }),
            
            vscode.commands.registerCommand('virtual-client.loadTemplate', async (templateId: string) => {
                try {
                    const template = await templateManager.loadTemplate(templateId);
                    if (template) {
                        return template;
                    } else {
                        vscode.window.showErrorMessage('Template not found.');
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to load template: ${error instanceof Error ? error.message : error}`);
                }
            }),
              vscode.commands.registerCommand('virtual-client.deleteTemplate', async (templateId: string) => {
                try {
                    const success = await templateManager.deleteTemplate(templateId);
                    if (success) {
                        vscode.window.showInformationMessage('Template deleted successfully.');
                    } else {
                        vscode.window.showWarningMessage('Template not found or could not be deleted.');
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to delete template: ${error instanceof Error ? error.message : error}`);
                }}),
            
            vscode.commands.registerCommand('virtual-client.exportTemplates', async () => {
                try {
                    const allTemplates = templateManager.getAllTemplates();
                    if (allTemplates.length === 0) {
                        vscode.window.showInformationMessage('No templates available to export.');
                        return;
                    }
                    
                    const uri = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file(path.join(os.homedir(), 'vc-templates.json')),
                        saveLabel: 'Export Templates',
                        filters: {
                            'JSON Files': ['json']
                        }
                    });
                    
                    if (uri) {
                        const templateIds = allTemplates.map(t => t.id);
                        await templateManager.exportTemplates(templateIds, uri.fsPath);
                        vscode.window.showInformationMessage(`Templates exported to ${uri.fsPath}`);
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to export templates: ${error instanceof Error ? error.message : error}`);
                }
            }),
            
            vscode.commands.registerCommand('virtual-client.importTemplates', async () => {
                try {
                    const uri = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: false,
                        openLabel: 'Import Templates',
                        filters: {
                            'JSON Files': ['json']
                        }
                    });
                    
                    if (uri && uri[0]) {
                        const imported = await templateManager.importTemplates(uri[0].fsPath);
                        vscode.window.showInformationMessage(`Imported ${imported} template(s) successfully.`);
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to import templates: ${error instanceof Error ? error.message : error}`);
                }
            }),
        ];

        context.subscriptions.push(...disposables);

        // Disable telemetry
        const telemetryConfig = vscode.workspace.getConfiguration('telemetry');
        telemetryConfig.update('enableTelemetry', false, vscode.ConfigurationTarget.Global);

        // Load default remote target dir from globalState or set platform defaults
        const userDefault = context.globalState.get<string>('defaultRemoteTargetDir');
        if (userDefault) {
            defaultRemoteTargetDir = userDefault;
        } else {
            // Set a sensible default for the current platform
            if (process.platform === 'win32') {
                defaultRemoteTargetDir = WINDOWS_DEFAULT_REMOTE_DIR;
            } else {
                defaultRemoteTargetDir = `${LINUX_DEFAULT_REMOTE_DIR}/${os.userInfo().username}/VirtualClientScheduler`;
            }
        }

        console.log('Extension "virtual-client" is now active!');
    } catch (error) {
        console.error('Failed to activate extension:', error);
        vscode.window.showErrorMessage('Failed to activate Virtual Client extension. Please check the logs for details.');
    }
}

/**
 * Deactivates the extension and cleans up global resources.
 */
export function deactivate() {
    // Clean up global resources
}

// Command handlers
async function handleAddMachine(context: vscode.ExtensionContext, machinesProvider: MachinesProvider) {
    const resources = new RunResourceManager();
    
    resources.panel = vscode.window.createWebviewPanel(
        'addMachine',
        'Add New Machine',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    resources.panel.webview.html = getAddMachineWebviewContent();

    // Handle messages from the webview
    resources.panel.webview.onDidReceiveMessage(
        async (message: AddMachineMessage | any) => {
            try {
                if (message.command === 'add') {
                    const { label, ip, username, password, platform } = message;
                    if (!label || !ip || !username || !password || !platform) {
                        vscode.window.showErrorMessage('All fields, including platform, are required to add a machine.');
                        return;
                    }
                    // Save the machine with the user-selected platform
                    await machinesProvider.addMachine(label, ip, username, password, platform);
                    // Also update the global state for this machine with the platform
                    let machines = context.globalState.get<any[]>('machines', []);
                    machines = machines.map((m: MachineItem) => m.ip === ip ? { ...m, platform } : m);
                    await context.globalState.update('machines', machines);
                    await machinesProvider.refreshConnectionStatusForMachine(ip); // Only refresh the new machine
                    resources.panel?.dispose();
                } else if (message.command === 'cancel') {
                    resources.panel?.dispose();
                } else if (message.command === 'detectPlatform') {
                    // Use provided ip, username, password to SSH and detect platform
                    const { ip, username, password } = message;
                    if (!ip || !username || !password) {
                        resources.panel?.webview.postMessage({ command: 'platformDetected', platform: '' });
                        return;
                    }
                    const platform = await detectRemotePlatform(ip, { username, password });
                    resources.panel?.webview.postMessage({ command: 'platformDetected', platform });
                    if (ip) {
                        await machinesProvider.refreshConnectionStatusForMachine(ip); // Only refresh the detected machine
                    }
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to add machine: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        },
        undefined,
        context.subscriptions
    );

    // Clean up resources when panel is closed
    resources.panel.onDidDispose(() => {
        resources.cleanup();
    });
}

export async function handleRunVirtualClient(context: vscode.ExtensionContext) {
    const resources = new RunResourceManager();
    
    // Get all machines from the provider
    const machines = await machinesProvider.getChildren();    const machineItems = machines.map((m: MachineItem) => ({
        label: m.label,
        ip: m.ip
    }));
    
    // Load last parameters
    const lastParameters = await loadLastRunParameters(context);

    const steps = createRunSteps();
    const webviewSteps = steps.map(step => ({
        label: step.label as string,
        status: step.status,
        detail: step.detail
    }));

    resources.panel = vscode.window.createWebviewPanel(
        'runVirtualClient',
        'Run Virtual Client',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))],
            retainContextWhenHidden: true
        }    );
    
    // Set content security policy
    const templates = templateManager.getAllTemplates();
    resources.panel.webview.html = getEnhancedRunVirtualClientWebviewContent(machineItems, lastParameters, webviewSteps, resources.panel.webview, templates);

    resources.panel.webview.onDidReceiveMessage(async (message: any) => {
        if (message.command === 'detectPlatform') {
            try {
                const machineIp = message.machineIp;
                const machine = await machinesProvider.getMachineByIp(machineIp);
                if (!machine) {
                    resources.panel?.webview.postMessage({ command: 'platformDetected', platform: '' });
                    return;
                }
                const credentials = await machinesProvider.getMachineCredentials(machineIp);
                if (!credentials) {
                    resources.panel?.webview.postMessage({ command: 'platformDetected', platform: '' });
                    return;
                }
                const platform = await detectRemotePlatform(machineIp, credentials);
                resources.panel?.webview.postMessage({ command: 'platformDetected', platform });
            } catch {
                resources.panel?.webview.postMessage({ command: 'platformDetected', platform: '' });
            }
            return;
        }
        
        // Template handling
        if (message.command === 'getTemplates') {
            const templates = templateManager.getAllTemplates();
            resources.panel?.webview.postMessage({ 
                command: 'templatesLoaded', 
                templates 
            });
            return;
        }
        
        if (message.command === 'loadTemplate') {
            try {
                const template = await templateManager.loadTemplate(message.templateId);
                if (template) {
                    resources.panel?.webview.postMessage({ 
                        command: 'templateLoaded', 
                        template 
                    });
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to load template: ${error instanceof Error ? error.message : error}`);
            }
            return;
        }        if (message.command === 'saveTemplate') {
            try {
                console.log('Extension received saveTemplate command with data:', message.templateData);
                const template = await templateManager.saveTemplate(
                    message.templateData.name,
                    message.templateData.description,
                    message.templateData.parameters,
                    message.templateData.category,
                    message.templateData.tags
                );                
                console.log('Template saved successfully:', template);
                // Send updated templates list after saving
                const templates = templateManager.getAllTemplates();
                resources.panel?.webview.postMessage({ 
                    command: 'templateSaved', 
                    template 
                });
                resources.panel?.webview.postMessage({ 
                    command: 'templatesLoaded', 
                    templates 
                });
            } catch (error) {
                console.error('Save template error:', error);
                vscode.window.showErrorMessage(`Failed to save template: ${error instanceof Error ? error.message : error}`);
            }
            return;        }
        
        if (message.command === 'deleteTemplate') {
            try {
                console.log(`Extension received deleteTemplate command with ID: ${message.templateId}`);
                const success = await templateManager.deleteTemplate(message.templateId);
                console.log(`Template deletion result: ${success}`);
                if (success) {
                    // Send updated templates list after deletion
                    const templates = templateManager.getAllTemplates();
                    console.log(`Sending templateDeleted message to webview`);
                    resources.panel?.webview.postMessage({ 
                        command: 'templateDeleted' 
                    });
                    resources.panel?.webview.postMessage({ 
                        command: 'templatesLoaded', 
                        templates 
                    });
                    vscode.window.showInformationMessage('Template deleted successfully.');
                } else {
                    console.warn(`Template deletion failed - template not found`);
                    vscode.window.showErrorMessage('Template not found or could not be deleted.');
                }
            } catch (error) {
                console.error(`Template deletion error: ${error}`);
                vscode.window.showErrorMessage(`Failed to delete template: ${error instanceof Error ? error.message : error}`);
            }
            return;}
        
        if (message.command === 'exportTemplates') {
            await vscode.commands.executeCommand('virtual-client.exportTemplates');
            return;
        }
        
        if (message.command === 'importTemplates') {
            await vscode.commands.executeCommand('virtual-client.importTemplates');
            // Refresh templates in webview
            const templates = templateManager.getAllTemplates();
            resources.panel?.webview.postMessage({ 
                command: 'templatesLoaded', 
                templates 
            });
            return;
        }
          if (message.command === 'showMessage') {
            vscode.window.showInformationMessage(message.text);
            return;
        }
        
        if (message.command === 'cleanRemotePackages') {
            try {
                const machine = await machinesProvider.getMachineByIp(message.machineIp);
                if (!machine) {
                    throw new Error('Machine not found');
                }
                
                await handleCleanRemotePackages(context, machine, resources.panel);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                resources.panel?.webview.postMessage({
                    command: 'cleanRemotePackagesComplete',
                    success: false,
                    error: errorMessage
                });
            }
            return;
        }
        
        if (message.command !== 'run') {
            return;
        }
        // --- LOG FILE VARS ---
        let logStream: fs.WriteStream | undefined;
        let outputChannel: vscode.OutputChannel | undefined;
        let logger: import('./types').Logger | undefined;
        // --- END LOG FILE VARS ---
        try {
            const machine = await machinesProvider.getMachineByIp(message.machineIp);
            if (!machine) {
                throw new Error('Machine not found');
            }
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Running Virtual Client on ${machine.label} (${machine.ip})`,
                cancellable: true
            }, async (progress, token) => {
                if (token) {
                    token.onCancellationRequested(() => {
                        if (runItem && runItem.label) {
                            runCancelFlags[runItem.label] = true;
                            vscode.window.showWarningMessage('Run cancellation requested.');
                        }
                        resources.cleanup();
                        logStream?.end();
                    });
                }
                progress.report({ message: 'Initializing run...' });
                // Validate user-supplied paths and parameters
                if (!message.packagePath || typeof message.packagePath !== 'string' || !message.packagePath.trim()) {
                    vscode.window.showErrorMessage('Local package path is required.');
                    throw new Error('Local package path is required.');
                }
                if (!message.machineIp || typeof message.machineIp !== 'string' || !message.machineIp.trim()) {
                    vscode.window.showErrorMessage('Machine IP is required.');
                    throw new Error('Machine IP is required.');
                }
                const platform = machine.platform;
                if (!platform || platform.trim() === '') {
                    vscode.window.showErrorMessage('Platform is not set for the selected machine.');
                    throw new Error('Platform is not set for the selected machine.');
                }
                const isWindows = isWindowsPlatform(platform);
                const credentials = await machinesProvider.getMachineCredentials(message.machineIp);
                if (!credentials) {
                    throw new Error('Machine credentials not found');
                }
                // Set the remote target directory automatically
                let remoteTargetDir: string;
                if (defaultRemoteTargetDir) {
                    if (isWindows) {
                        remoteTargetDir = defaultRemoteTargetDir;
                    } else {
                        // If user set a default, but we're on Linux, ensure it's a POSIX path
                        // If the defaultRemoteTargetDir is a Windows path, convert to POSIX
                        if (defaultRemoteTargetDir.startsWith('C:') || defaultRemoteTargetDir.startsWith('\\')) {
                            const remoteUser = credentials.username || 'vclientuser';
                            remoteTargetDir = getDefaultRemoteTargetDir(platform, remoteUser);
                        } else {
                            remoteTargetDir = defaultRemoteTargetDir;
                        }
                    }
                } else {
                    const remoteUser = credentials.username || 'vclientuser';
                    remoteTargetDir = getDefaultRemoteTargetDir(platform, remoteUser);
                }                // Update global state with last parameters (do not include remoteTargetDir)
                await saveLastRunParameters(context, message);
                // Create a new run item
                const runItem = scheduledRunsProvider.addRun(
                    machine.ip,
                    message.packagePath,
                    machine.platform,
                    message.profile,
                    message.system,
                    message.timeout,
                    message.exitWait,
                    message.proxyApi,
                    message.packageStore,
                    message.eventHub,
                    message.experimentId,
                    message.clientId,
                    message.metadata,
                    message.parameters,
                    message.port,
                    message.ipAddress,
                    message.logToFile,
                    message.clean,
                    message.debug,
                    message.dependencies || '',
                    message.iterations || 1,
                    message.logLevel || '',
                    message.failFast || false,
                    createRunSteps()
                );                // --- LOG FILE SETUP ---
                const logsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME);
                await ensureDirectoryExistsWithLogging(logsDir);
                const logLabel = (scheduledRunsProvider as any).getRunLabel
                    ? (scheduledRunsProvider as any).getRunLabel(runItem.timestamp, runItem.machineIp)
                    : runItem.label;
                const logFilePath = path.join(logsDir, `${logLabel}${LOG_FILE_EXTENSION}`);
                
                const { logger, outputChannel, logStream } = createRunLogger(runItem.label, logFilePath);
                logger.info(`Scheduled run started for ${runItem.label}`);
                // --- END LOG FILE SETUP ---
                // Register the connection for cancellation
                runCancelFlags[runItem.label] = false;
                resources.conn = new ssh2.Client();
                runConnections[runItem.label] = resources.conn;                resources.conn.on('ready', () => {
                    if (!resources.conn) {
                        return;
                    }
                    resources.conn.sftp((err: Error | undefined, sftp: any) => {
                        if (err) {
                            vscode.window.showErrorMessage(`SFTP error: ${err?.message}`);
                            logger?.error('SFTP error: ' + (err?.message || ''));
                            resources.cleanup();
                            logStream?.end();
                            return;
                        }
                        resources.sftp = sftp;
                        // Execute steps in sequence
                        const executeSteps = async () => {
                            let sftpDir: string | undefined = undefined;
                            try {
                                progress.report({ message: 'Initializing run...' });                                // Step 0: Setup Machine
                                updateStepStatus(runItem.steps[0], 'running', undefined, scheduledRunsProvider);
                                updateSubstepStatus(runItem.steps[0], 0, 'running', undefined, scheduledRunsProvider);
                                logger?.info('Step 1: Setup Machine > Create Remote Directory');
                                try {
                                    logger?.debug(`[DEBUG] Attempting to create remote directory: ${remoteTargetDir}`);
                                    if (!remoteTargetDir) {
                                        throw new Error('Remote target directory is not set');
                                    }
                                    
                                    // Verify SFTP connection
                                    if (!sftp) {
                                        throw new Error('SFTP connection is not established');
                                    } else {
                                        logger?.debug(`[DEBUG] SFTP connection established`);
                                    }
                                    
                                    // Create directory and get the relative SFTP path
                                    sftpDir = await sftpMkdirRecursive(sftp, remoteTargetDir, logger);
                                    
                                    // Verify directory was created using the relative SFTP path
                                    await new Promise((resolve, reject) => {
                                        sftp.stat(sftpDir, (err: any) => {
                                            if (err) {
                                                const errorMsg = `Failed to verify directory creation: ${err.message}`;
                                                logger?.error(errorMsg);
                                                reject(new Error(errorMsg));
                                            } else {
                                                logger?.debug(`[DEBUG] Successfully verified directory exists: ${sftpDir}`);
                                                resolve(true);
                                            }
                                        });
                                    });

                                    updateSubstepStatus(runItem.steps[0], 0, 'success', undefined, scheduledRunsProvider);
                                    updateStepStatus(runItem.steps[0], 'success', undefined, scheduledRunsProvider);  // Update parent step status
                                    logger?.info('Step 1: Setup Machine > Create Remote Directory completed');                                } catch (err) {
                                    const errorMsg = `Failed to create remote directory: ${err instanceof Error ? err.message : String(err)}`;
                                    markSubstepAsError(runItem.steps[0], 0, errorMsg, logger, scheduledRunsProvider);
                                    vscode.window.showErrorMessage(errorMsg);
                                    throw err; // Re-throw to prevent continuing to upload step
                                }

                                // Only proceed to upload if directory creation was successful
                                const stepStatus = runItem.steps[0].status as 'pending' | 'running' | 'success' | 'error';
                                if (stepStatus !== 'success') {
                                    const errorMsg = `Cannot proceed with upload: directory creation failed (status: ${stepStatus})`;
                                    logger?.error(`[ERROR] ${errorMsg}`);
                                    throw new Error(errorMsg);
                                }                                // Substep 0.1: Upload Package
                                updateSubstepStatus(runItem.steps[0], 1, 'running', undefined, scheduledRunsProvider);
                                logger?.info('Step 1: Setup Machine > Upload Package');
                                // Validate package path
                                const validation = await validatePackagePath(message.packagePath);
                                if (!validation.isValid) {
                                    markSubstepAsError(runItem.steps[0], 1, validation.error!, logger, scheduledRunsProvider);
                                    vscode.window.showErrorMessage(`Step 0.1 (Upload package) failed: ${validation.error}`);
                                    throw new Error(validation.error);
                                }
                                // Use sftpDir as the base for all subsequent SFTP operations (Linux/posix)
                                const remotePackagePath = getRemotePath(platform, sftpDir || remoteTargetDir, path.basename(message.packagePath));
                                // Fix extracted directory path logic:
                                const packageName = path.basename(message.packagePath, path.extname(message.packagePath));
                                const extractDestDir = getRemotePath(platform, sftpDir || remoteTargetDir, packageName);
                                const remoteExtractDir = extractDestDir;
                                logger?.debug(`[DEBUG] remotePackagePath: ${remotePackagePath}`);
                                logger?.debug(`[DEBUG] remoteExtractDir: ${remoteExtractDir}`);                                if (await checkRemoteFileExists(sftp, remoteExtractDir, logger)) {
                                    logger?.debug('[DEBUG] Extracted directory exists. Skipping extraction.');
                                    updateSubstepStatus(runItem.steps[0], 1, 'success', undefined, scheduledRunsProvider);
                                    logger?.info('Step 1: Setup Machine > Upload Package skipped (already present and extracted)');
                                } else {
                                    logger?.debug('[DEBUG] Extracted directory does not exist. Proceeding with upload and extraction.');                                    // --- NEW LOGIC: Check if remote package file exists, upload if not ---
                                    const remotePackageExists = await checkRemoteFileExists(sftp, remotePackagePath, logger);
                                    if (!remotePackageExists) {
                                        logger?.debug('[DEBUG] Remote package does not exist. Uploading package...');
                                        const localPath = message.packagePath;
                                        const remotePath = remotePackagePath;
                                        const { size: totalSize } = await fsPromises.stat(localPath);
                                        const totalMB = totalSize / (1024 * 1024);
                                        logger?.debug(`[DEBUG] Uploading package: ${totalMB.toFixed(2)} MB to remote using fastPut...`);                                        // Progress bar state
                                        let lastLoggedPercent = { value: 0 };
                                    
                                        // Log 0% at the start
                                        logger?.info(`[UPLOAD] ${renderProgressBar(0)} (0.00 MB / ${totalMB.toFixed(2)} MB)`);
                                    
                                        await new Promise<void>((resolve, reject) => {
                                            sftp.fastPut(localPath, remotePath, {
                                                // step is a built-in progress callback for fastPut in ssh2
                                                step: (transferred: number, chunk: number, total: number) => {
                                                    logUploadProgress(transferred, total, logger, lastLoggedPercent);
                                                },
                                            }, (err: Error | undefined) => {
                                                if (err) {
                                                    logger?.error('fastPut error during upload: ' + err.message);
                                                    return reject(err); // Make sure to reject the promise
                                                }
                                                logger?.debug('[DEBUG] fastPut package upload completed.');
                                                resolve();
                                            });
                                        });
                                    } else {
                                        logger?.debug('[DEBUG] Remote package already exists. Skipping upload.');
                                    }
                                    // --- END NEW LOGIC ---
                                    // Extraction logic (must be after upload is complete)
                                    try {
                                        let checkExtractCmd = '';
                                        let extractCmd = '';
                                        const safeRemotePackagePath = remotePackagePath.replace(/'/g, "'\\''");
                                        if (isWindows) {
                                            checkExtractCmd = 'powershell -Command "Get-Command Expand-Archive"';
                                            extractCmd = `powershell -Command \"Expand-Archive -Path '${remotePackagePath.replace(/\//g, '\\')}' -DestinationPath '${extractDestDir.replace(/\//g, '\\')}' -Force\"`;
                                        } else if (remotePackagePath.endsWith('.zip')) {
                                            checkExtractCmd = 'command -v unzip';
                                            extractCmd = `unzip -o ${safeRemotePackagePath} -d ${shQuote(extractDestDir)}`;
                                        } else if (remotePackagePath.endsWith('.tar.gz') || remotePackagePath.endsWith('.tgz')) {
                                            checkExtractCmd = 'command -v tar';
                                            extractCmd = `tar -xzf ${safeRemotePackagePath} -C ${shQuote(extractDestDir)}`;
                                        } else if (remotePackagePath.endsWith('.tar')) {
                                            checkExtractCmd = 'command -v tar';
                                            extractCmd = `tar -xf ${safeRemotePackagePath} -C ${shQuote(extractDestDir)}`;
                                        }
                                        // --- RUN EXTRACTION COMMAND IF DEFINED ---
                                        if (extractCmd) {
                                            logger?.debug(`[DEBUG] Running extraction command: ${extractCmd}`);
                                            await new Promise((resolve, reject) => {
                                                resources.conn!.exec(extractCmd, (err: Error | undefined, stream: any) => {
                                                    if (err) {
                                                        const detail = `Extraction failed to start: ${err?.message}`;
                                                        if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'error'; runItem.steps[0].substeps[1].detail = detail; scheduledRunsProvider.update(); }
                                                        logger?.error(detail);
                                                        return reject(err);
                                                    }
                                                    let stdout = '';
                                                    let stderr = '';
                                                    // Suppress per-line extraction output, only log on error or summary
                                                    stream.on('data', (data: Buffer) => {
                                                        stdout += data.toString();
                                                    });
                                                    stream.stderr.on('data', (data: Buffer) => {
                                                        stderr += data.toString();
                                                    });                                                    stream.on('close', async (code: number) => {
                                                        if (code === 0) {
                                                            // After extraction, verify the directory exists
                                                            const extractedNowExists = await checkRemoteFileExists(sftp, remoteExtractDir, logger);
                                                            if (extractedNowExists) {
                                                                updateSubstepStatus(runItem.steps[0], 1, 'success', undefined, scheduledRunsProvider);
                                                                logger?.info('Extraction completed and directory verified.');
                                                                resolve(true);
                                                            } else {
                                                                const detail = 'Extraction command completed but extracted directory not found.';
                                                                markSubstepAsError(runItem.steps[0], 1, detail, logger, scheduledRunsProvider);
                                                                vscode.window.showErrorMessage(detail);
                                                                reject(new Error(detail));
                                                            }
                                                        } else {
                                                            const detail = `Extraction failed (code ${code}): ${stderr}`;
                                                            markSubstepAsError(runItem.steps[0], 1, detail, logger, scheduledRunsProvider);
                                                            vscode.window.showErrorMessage(detail);
                                                            reject(new Error(detail));
                                                        }
                                                    });
                                                });
                                            });
                                        } else {
                                            logger?.debug('[DEBUG] No extraction command defined for this package type.');
                                        }
                            } catch (err) {
                                    logger?.debug(`[DEBUG] Upload or extraction failed: ${err instanceof Error ? err.message : err}`);
                                    logger?.error(`Step 0.1 (Upload or extraction) failed: ${err instanceof Error ? err.message : err}`);
                                    vscode.window.showErrorMessage(`Step 0.1 (Upload or extraction) failed: ${err instanceof Error ? err.message : err}`);
                                    throw err;
                                }
                            }                            // Mark Setup Machine as success if all substeps succeeded
                            updateParentStepIfComplete(runItem.steps[0], scheduledRunsProvider);                            // Step 1: Run Virtual Client
                            updateStepStatus(runItem.steps[1], 'running', undefined, scheduledRunsProvider);
                            updateSubstepStatus(runItem.steps[1], 0, 'running', undefined, scheduledRunsProvider);
                            logger?.info('Step 2: Run Virtual Client > Verify Virtual Client Tool');
                            
                            // Use the platform from the selected machine, not from the message
                            if (!platform) {
                                markStepAsError(runItem.steps[1], 'Platform is not set for the selected machine.', logger, scheduledRunsProvider);
                                throw new Error('Platform is not set for the selected machine.');
                            }
                            
                            const toolExecutable = getToolExecutableName(platform);
                            let toolPath, toolDir;
                            toolPath = getRemotePath(platform, extractDestDir, 'content', platform, toolExecutable);
                            toolDir = path.dirname(toolPath);                            // --- TOOL PATH VALIDATION AND LOGGING ---
                            // Validate tool path exists on remote before running
                            logger?.info(`[INFO] Tool path verified: ${toolPath}`);
                            logger?.debug(`[DEBUG] Tool path: ${toolPath}`);
                            const toolExists = await checkRemoteFileExists(sftp, toolPath, logger);
                            
                            // For Linux: chmod +x VirtualClient after validation
                            if (!isWindows && toolExists) {
                                await executeSSHCommand(resources.conn!, `chmod +x ${shQuote(toolPath)}`, logger);
                                logger?.debug(`[DEBUG] Ran chmod +x on ${toolPath}`);
                            }
                            
                            if (toolExists) {
                                updateSubstepStatus(runItem.steps[1], 0, 'success', undefined, scheduledRunsProvider);
                            } else {
                                const errorMsg = `VirtualClient tool not found at path: ${toolPath}`;
                                markSubstepAsError(runItem.steps[1], 0, errorMsg, logger, scheduledRunsProvider);
                                throw new Error(errorMsg);
                            }
                            // --- END TOOL PATH VALIDATION ---                            // Merge additionalArgs with form fields, giving precedence to additionalArgs
                            const vcCmd = buildVirtualClientCommand(message, message.additionalArgs, shQuote);
                            
                            // Run the command in the tool directory, capture PID
                            let command = '';
                            if (platform && isWindows) {
                                command = `"${toolPath}"${vcCmd}`;
                                logger?.debug(`[DEBUG] Command to execute: ${command}`);
                            } else {
                                // For Linux: run as sudo with password from credentials
                                command = `echo '${credentials.password.replace(/'/g, "'\\''")}' | sudo -S ${shQuote(toolPath)}${vcCmd}`;
                                // Log only the command arguments, not the password
                                logger?.debug(`[DEBUG] Command to execute: sudo -S ${shQuote(toolPath)}${vcCmd}`);
                            }                            // Run the command in the remote target directory, capture PID
                            updateSubstepStatus(runItem.steps[1], 1, 'running', undefined, scheduledRunsProvider);
                            logger?.info('Step 2: Run Virtual Client > Execute Virtual Client Command');
                            
                            let executionError: Error | null = null;
                            
                            try {
                                const result = await executeSSHCommandWithStreaming(
                                    resources.conn!,
                                    command,
                                    (data) => logger?.info('VC stdout: ' + data),
                                    (data) => logger?.warn('VC stderr: ' + data),
                                    logger
                                );
                                
                                if (runCancelFlags[runItem.label]) {
                                    markSubstepAsError(runItem.steps[1], 1, 'Run cancelled.', logger, scheduledRunsProvider);
                                    executionError = new Error('Run cancelled');
                                } else if (result.exitCode === 0) {
                                    updateSubstepStatus(runItem.steps[1], 1, 'success', undefined, scheduledRunsProvider);
                                    logger?.info('Step 2: Run Virtual Client completed');
                                    // Mark parent as success only if both substeps succeeded
                                    updateParentStepIfComplete(runItem.steps[1], scheduledRunsProvider);
                                } else {
                                    const errorMsg = `Execution failed (code ${result.exitCode}): ${result.stderr}`;
                                    markSubstepAsError(runItem.steps[1], 1, errorMsg, logger, scheduledRunsProvider);
                                    executionError = new Error(errorMsg);
                                }
                            } catch (error) {
                                if (runCancelFlags[runItem.label]) {
                                    markSubstepAsError(runItem.steps[1], 1, 'Run cancelled before execution.', logger, scheduledRunsProvider);
                                    executionError = new Error('Run cancelled before execution');
                                } else {
                                    markSubstepAsError(runItem.steps[1], 1, `Failed to start Virtual Client: ${(error as Error).message}`, logger, scheduledRunsProvider);
                                    executionError = error as Error;
                                }
                            }
                            // Step 2: Transfer Logs
                            const logsStep = new ScheduledRunStep('Transfer Logs', 'running', undefined, [
                                new ScheduledRunStep('Archive Logs Folder', 'pending'),
                                new ScheduledRunStep('Download Logs Archive', 'pending'),
                                new ScheduledRunStep('Extract Logs Locally', 'pending')
                            ]);
                            runItem.steps.push(logsStep);
                            scheduledRunsProvider.update();

                            try {
                                // Get archive paths and set up step metadata
                                const { remoteArchivePath, isTar } = getRemoteArchivePaths(platform, extractDestDir);
                                
                                // Set runLabel and download path on Extract Logs Locally step
                                if (logsStep.substeps && logsStep.substeps[2]) {
                                    (logsStep.substeps[2] as any).runLabel = runItem.label;                                    (logsStep.substeps[2] as any).archivePath = path.join(
                                        context.globalStorageUri.fsPath,
                                        LOGS_DIR_NAME,
                                        sanitizeLabel(runItem.label),
                                        isTar ? LOGS_TAR : LOGS_ZIP
                                    );
                                }

                                // Update step statuses as we progress
                                updateSubstepStatus(logsStep, 0, 'running', undefined, scheduledRunsProvider);
                                updateSubstepStatus(logsStep, 1, 'running', undefined, scheduledRunsProvider);
                                updateSubstepStatus(logsStep, 2, 'running', undefined, scheduledRunsProvider);
                                
                                logger?.info('Step 3: Transfer Logs > Archive, Download, and Extract');
                                
                                // Use the complete transfer logs utility function
                                const localLogsDir = await transferLogs({
                                    context,
                                    runLabel: runItem.label,
                                    platform,
                                    extractDestDir,
                                    conn: resources.conn!,
                                    sftp: resources.sftp!,
                                    credentials,
                                    logger,
                                    shQuote
                                });
                                
                                // Mark all substeps as successful
                                updateSubstepStatus(logsStep, 0, 'success', undefined, scheduledRunsProvider);
                                updateSubstepStatus(logsStep, 1, 'success', undefined, scheduledRunsProvider);
                                updateSubstepStatus(logsStep, 2, 'success', undefined, scheduledRunsProvider);

                                // Build log file tree and attach to Extract Logs step
                                if (logsStep.substeps && logsStep.substeps[2]) {
                                    logsStep.substeps[2].substeps = await buildLogFileTree(
                                        localLogsDir, 
                                        logsStep.substeps[2], 
                                        runItem.label
                                    );
                                }                                updateStepStatus(logsStep, 'success', `Logs transferred to ${localLogsDir}`, scheduledRunsProvider);
                                logger?.info(`Step 3: Transfer Logs completed - ${localLogsDir}`);
                            } catch (err) {
                                markStepAsError(logsStep, err instanceof Error ? err.message : String(err), logger, scheduledRunsProvider);
                                logger?.error('Step 3 (Transfer Logs) failed: ' + (err instanceof Error ? err.message : String(err)));
                            }

                            // After logs are transferred (or attempted), throw execution error if it occurred
                            if (executionError) {
                                throw executionError;
                            }

                        } catch (error) {
                                progress.report({ message: 'Error occurred. See logs for details.' });
                                throw error;
                            } finally {
                                logger?.info('Scheduled run finished.');
                                logStream?.end();
                                outputChannel?.appendLine('=== Run finished ===');
                                outputChannel?.show(true);                        }
                    };

                    // Check if remote package cleanup is requested
                    const performCleanupBeforeExecution = async () => {
                        if (message.cleanRemotePackages) {
                            try {                                progress.report({ message: 'Cleaning remote packages...' });
                                logger?.debug('Cleaning remote packages before deployment');
                                  const machinePlatform = machine.platform;
                                if (!machinePlatform) {
                                    logger?.error('Machine platform not available for cleanup');
                                    return;
                                }
                                
                                await cleanRemotePackagesInternal(resources.conn!, machinePlatform, logger, credentials.username);
                                
                                logger?.debug('Remote packages cleaned successfully');
                                progress.report({ message: 'Remote packages cleaned, starting deployment...' });
                            } catch (cleanError) {
                                const errorMsg = `Failed to clean remote packages: ${cleanError instanceof Error ? cleanError.message : String(cleanError)}`;
                                logger?.error(errorMsg);
                                vscode.window.showWarningMessage(errorMsg + '. Continuing with deployment...');
                            }
                        }
                    };

                    // Perform cleanup if requested, then execute the deployment steps
                    performCleanupBeforeExecution().then(() => {
                        executeSteps();
                    }).catch((error) => {
                        logger?.error(`Failed during cleanup phase: ${error instanceof Error ? error.message : String(error)}`);
                        executeSteps(); // Continue with deployment even if cleanup fails
                    });
                });
            });

            resources.conn.connect({
                host: machine.ip,
                username: credentials.username,
                password: credentials.password,
                algorithms: {
                    cipher: ['aes128-ctr']
                }
            });

            // Update status in scheduled runs provider
            scheduledRunsProvider.update();
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to execute run: ${errorMessage}`);
            // If logStream is defined, log the error and close it
            if (logger && logStream) {
                logger.error('Failed to execute run: ' + (error instanceof Error ? error.stack || error.message : error));
                logStream?.end();
            }
            resources.cleanup();
        }
    });

    // Clean up resources when panel is closed
    resources.panel.onDidDispose(() => {
        resources.cleanup();
    });
}

async function handleDeleteMachine(context: vscode.ExtensionContext, item: MachineItem) {
    try {
        if (!item) {
            throw new Error('No machine selected');
        }

        const confirm = await vscode.window.showWarningMessage(
            `Delete machine '${item.label}' (${item.ip})?`,
            { modal: true },
            'Delete'
        );

        if (confirm === 'Delete') {
            await machinesProvider.deleteMachine(item.ip);
            vscode.window.showInformationMessage(`Machine '${item.label}' deleted.`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to delete machine: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function handleStreamLogs(context: vscode.ExtensionContext, item: ScheduledRunItem, scheduledRunsProvider: ScheduledRunsProvider) {
    const outputChannel = vscode.window.createOutputChannel(`Virtual Client Logs - ${item.label}`);
    outputChannel.show(true);

    // Start streaming logs from the log file
    const logFile = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME, `${item.label}${LOG_FILE_EXTENSION}`);
    const logFileWatcher = vscode.workspace.createFileSystemWatcher(logFile);
    
    logFileWatcher.onDidChange(async () => {
        try {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(logFile));
            outputChannel.appendLine(content.toString());
        } catch (error) {
            outputChannel.appendLine(`Error reading log file: ${error}`);
        }
    });

    // Monitor run completion
    const disposable = scheduledRunsProvider.onDidChangeTreeData(async () => {
        const run = scheduledRunsProvider.getRun(item.runId);
        if (run && run.steps.every((step: { status: string }) => step.status === 'success' || step.status === 'error')) {
            // Run is complete, read final logs
            try {
                const content = await vscode.workspace.fs.readFile(vscode.Uri.file(logFile));
                outputChannel.appendLine('\n=== Final Logs ===\n');
                outputChannel.appendLine(content.toString());
            } catch (error) {
                outputChannel.appendLine(`Error reading final logs: ${error}`);
            }
            disposable.dispose();
            logFileWatcher.dispose();
        }
    });
}

async function handleShowLogFiles(context: vscode.ExtensionContext): Promise<void> {
    try {
        const logsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME);
        const logFiles = (await fsPromises.readdir(logsDir)).filter(f => f.endsWith(JSON_FILE_EXTENSION));
        if (logFiles.length === 0) {
            vscode.window.showInformationMessage('No log files found.');
            return;
        }

        const selectedFile = await vscode.window.showQuickPick(logFiles, {
            placeHolder: 'Select a log file to view'
        });

        if (selectedFile) {
            const logPath = path.join(logsDir, selectedFile);
            const document = await vscode.workspace.openTextDocument(logPath);
            await vscode.window.showTextDocument(document);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to show log files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

async function handleShowRunDetails(context: vscode.ExtensionContext, runItem: ScheduledRunItem | undefined) {
    if (!runItem) {
        vscode.window.showErrorMessage('No run item selected');
        return;
    }
    showRunDetailsWebview(context, runItem);
}

async function handleRerun(context: vscode.ExtensionContext, item: ScheduledRunItem) {
    // Get the last used parameters from the run
    const lastParams = {
        machineIp: item.machineIp,
        packagePath: item.packagePath,
        platform: item.platform,
        profile: item.profile,
        system: item.system,
        timeout: item.timeout,
        exitWait: item.exitWait,
        proxyApi: item.proxyApi,
        packageStore: item.packageStore,
        eventHub: item.eventHub,
        experimentId: item.experimentId,
        clientId: item.clientId,
        metadata: item.metadata,
        parameters: item.parameters,
        port: item.port,
        ipAddress: item.ipAddress,
        logToFile: item.logToFile,
        clean: item.clean,
        debug: item.debug,
        dependencies: item.dependencies,
        iterations: item.iterations,
        logLevel: item.logLevel,
        failFast: item.failFast
    };

    // Create a new webview panel with the last used parameters
    const panel = vscode.window.createWebviewPanel(
        'runVirtualClient',
        'Run Virtual Client',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))],
            retainContextWhenHidden: true
        }
    );

    // Get all machines from the provider
    const machines = await machinesProvider.getChildren();
    const machineItems = machines.map((m: MachineItem) => ({
        label: m.label,
        ip: m.ip
    }));

    // Helper to create fresh steps for each rerun
    function createRunSteps() {
        return [
            new ScheduledRunStep('Setup Machine', 'pending', undefined, [
                new ScheduledRunStep('Create Remote Directory', 'pending'),
                new ScheduledRunStep('Upload Package', 'pending')
            ]),
            new ScheduledRunStep('Run Virtual Client', 'pending', undefined, [
                new ScheduledRunStep('Verify Virtual Client Tool', 'pending'),
                new ScheduledRunStep('Execute Virtual Client Command', 'pending')
            ])
        ];
    }

    const steps = createRunSteps();

    // Set the webview content with the last used parameters
    panel.webview.html = getRunVirtualClientWebviewContent(machineItems, lastParams, steps, panel.webview);

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(async (message: any) => {
        if (message.command === 'run') {
            // Save the parameters for future use
            await context.globalState.update('lastParameters', message);

            // Create a new run with the same parameters, including dependencies, iterations, logLevel
            const runItem = scheduledRunsProvider.addRun(
                message.machineIp,
                message.packagePath,
                message.platform,
                message.profile,
                message.system,
                message.timeout,
                message.exitWait,
                message.proxyApi,
                message.packageStore,
                message.eventHub,
                message.experimentId,
                message.clientId,
                message.metadata,
                message.parameters,
                message.port,
                message.ipAddress,
                message.logToFile,
                message.clean,
                message.debug,
                message.dependencies || '',
                message.iterations || 1,
                message.logLevel || '',
                message.failFast || false,
                createRunSteps() // always fresh steps
            );

            // Save the run to disk
            await saveScheduledRun(context, runItem);

            // Show success message
            vscode.window.showInformationMessage(`Virtual Client run scheduled for ${message.machineIp}`);

            // Refresh the tree view
            if (treeViewProvider) {
                treeViewProvider.refresh();
            }            // Close the webview
            panel.dispose();
        }
    });
}

/**
 * Handles cleaning remote packages from VirtualClientScheduler directory
 */
async function handleCleanRemotePackages(
    context: vscode.ExtensionContext, 
    machine: any, 
    panel?: vscode.WebviewPanel
): Promise<void> {
    return new Promise((resolve, reject) => {
        const resources = {
            conn: null as ssh2.Client | null,
            sftp: null as any
        };

        const cleanup = () => {
            if (resources.sftp) {
                try { resources.sftp.end(); } catch {}
            }
            if (resources.conn) {
                try { resources.conn.end(); } catch {}
            }
        };

        const handleError = (error: any) => {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            panel?.webview.postMessage({
                command: 'cleanRemotePackagesComplete',
                success: false,
                error: errorMessage
            });

            vscode.window.showErrorMessage(`Failed to clean remote packages: ${errorMessage}`);
            cleanup();
            reject(error);
        };

        // Get machine credentials
        machinesProvider.getMachineCredentials(machine.ip).then(credentials => {
            if (!credentials) {
                handleError(new Error('Machine credentials not found'));
                return;
            }

            // Detect platform
            const platform = machine.platform;
            if (!platform) {
                handleError(new Error('Machine platform not detected'));
                return;
            }

            // Create SSH connection
            resources.conn = new ssh2.Client();

            resources.conn.on('ready', () => {
                if (!resources.conn) {
                    return;
                }

                // Get remote target directory
                const remoteTargetDir = getDefaultRemoteTargetDir(platform, credentials.username);
                
                // Build cleanup commands based on platform
                const isWindows = isWindowsPlatform(platform);
                let cleanupCommand: string;

                if (isWindows) {
                    // Windows PowerShell command to remove all files and folders in VirtualClientScheduler
                    cleanupCommand = `powershell -Command "if (Test-Path '${remoteTargetDir}') { Get-ChildItem -Path '${remoteTargetDir}' -Recurse | Remove-Item -Force -Recurse; Write-Host 'Cleaned VirtualClientScheduler directory' } else { Write-Host 'VirtualClientScheduler directory not found' }"`;
                } else {
                    // Linux command to remove all files and folders in VirtualClientScheduler
                    cleanupCommand = `if [ -d "${remoteTargetDir}" ]; then rm -rf "${remoteTargetDir}"/*; echo "Cleaned VirtualClientScheduler directory"; else echo "VirtualClientScheduler directory not found"; fi`;
                }

                // Execute cleanup command
                resources.conn.exec(cleanupCommand, (err: Error | undefined, stream: any) => {
                    if (err) {
                        handleError(err);
                        return;
                    }

                    let stdout = '';
                    let stderr = '';

                    stream.on('data', (data: Buffer) => {
                        stdout += data.toString();
                    });

                    stream.stderr.on('data', (data: Buffer) => {
                        stderr += data.toString();
                    });

                    stream.on('close', (code: number) => {
                        if (code !== 0) {
                            handleError(new Error(`Cleanup command failed with exit code ${code}: ${stderr}`));
                            return;
                        }

                        // Notify success
                        panel?.webview.postMessage({
                            command: 'cleanRemotePackagesComplete',
                            success: true
                        });

                        vscode.window.showInformationMessage(`Successfully cleaned remote packages from ${machine.label} (${machine.ip})`);
                        
                        cleanup();
                        resolve();
                    });
                });
            });

            resources.conn.on('error', (err: Error) => {
                handleError(err);
            });

            // Connect to the machine
            resources.conn.connect({
                host: machine.ip,
                username: credentials.username,
                password: credentials.password,
                algorithms: {
                    cipher: ['aes128-ctr']
                }
            });

        }).catch(handleError);
    });
}

/**
 * Internal helper function to clean remote packages using an existing SSH connection
 */
async function cleanRemotePackagesInternal(
    conn: ssh2.Client, 
    platform: string, 
    logger?: import('./types').Logger,
    username?: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        // Get remote target directory
        const remoteTargetDir = getDefaultRemoteTargetDir(platform, username || 'vclientuser');
        
        // Build cleanup commands based on platform
        const isWindows = isWindowsPlatform(platform);
        let cleanupCommand: string;

        if (isWindows) {
            // Windows PowerShell command to remove all files and folders in VirtualClientScheduler
            cleanupCommand = `powershell -Command "if (Test-Path '${remoteTargetDir}') { Get-ChildItem -Path '${remoteTargetDir}' -Recurse | Remove-Item -Force -Recurse; Write-Host 'Cleaned VirtualClientScheduler directory' } else { Write-Host 'VirtualClientScheduler directory not found' }"`;
        } else {
            // Linux command to remove all files and folders in VirtualClientScheduler
            cleanupCommand = `if [ -d "${remoteTargetDir}" ]; then rm -rf "${remoteTargetDir}"/*; echo "Cleaned VirtualClientScheduler directory"; else echo "VirtualClientScheduler directory not found"; fi`;
        }

        logger?.debug(`Executing cleanup command: ${cleanupCommand}`);

        // Execute cleanup command
        conn.exec(cleanupCommand, (err: Error | undefined, stream: any) => {
            if (err) {
                logger?.error(`Failed to execute cleanup command: ${err.message}`);
                reject(err);
                return;
            }

            let stdout = '';
            let stderr = '';

            stream.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            stream.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            stream.on('close', (code: number) => {
                if (code !== 0) {
                    const errorMsg = `Cleanup command failed with exit code ${code}: ${stderr}`;
                    logger?.error(errorMsg);
                    reject(new Error(errorMsg));
                    return;
                }

                logger?.debug(`Cleanup command completed successfully: ${stdout.trim()}`);
                resolve();
            });
        });
    });
}