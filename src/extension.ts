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
import { 
    shQuote, 
    sanitizeLabel, 
    sftpMkdirRecursive, 
    sftpDownloadFile, 
    extractZip, 
    detectRemotePlatform 
} from './utils';

// Use extension-specific logs directory in globalStoragePath
let LOGS_DIR: string;

// Global providers
export let scheduledRunsProvider: ScheduledRunsProvider;
let treeViewProvider: VirtualClientTreeViewProvider | undefined;
let machinesProvider: MachinesProvider;

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

// Helper functions for log management
export async function loadScheduledRuns(context: vscode.ExtensionContext): Promise<any[]> {
    try {
        const files = (await fsPromises.readdir(LOGS_DIR)).filter(f => f.endsWith('.json'));
        const runsData = await Promise.all(files.map(async f => {
            const filePath = path.join(LOGS_DIR, f);
            try {
                const content = await fsPromises.readFile(filePath, 'utf-8');
                return JSON.parse(content);
            } catch (error) {
                console.error(`Failed to read or parse scheduled run file ${filePath}:`, error);
                return null;
            }
        }));
        return runsData.filter(run => run !== null);
    } catch (error) {
        console.error('Failed to load scheduled runs:', error);
        return [];
    }
}

export async function saveScheduledRun(context: vscode.ExtensionContext, run: any): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const machineLabel = typeof run.machineLabel === 'string' ? sanitizeLabel(run.machineLabel) : 'unknown_label';
    const machineIp = typeof run.machineIp === 'string' ? run.machineIp : 'unknown_ip';
    const filename = `${timestamp}_${machineLabel}(${machineIp}).json`;
    const file = path.join(LOGS_DIR, filename);
    try {
        await fsPromises.writeFile(file, JSON.stringify(run, null, 2));
        console.log(`Scheduled run saved to ${file}`);
    } catch (error) {
        console.error('Failed to save run:', error);
        vscode.window.showErrorMessage(`Failed to save run: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function clearLogsFolder(context: vscode.ExtensionContext): Promise<void> {
    try {
        await fsPromises.access(LOGS_DIR);
        const files = await fsPromises.readdir(LOGS_DIR);
        for (const f of files) {
            try {
                await fsPromises.unlink(path.join(LOGS_DIR, f));
            } catch (unlinkError) {
                console.warn(`Failed to delete log file ${f}:`, unlinkError);
            }
        }
        vscode.window.showInformationMessage('Scheduled run history files cleared from LOGS_DIR.');
    } catch (error) {
        console.info('Log folder for scheduled runs either does not exist or could not be cleared:', error);
    }
}

// Add a global cancel flag and a map to track running connections by run label
const runCancelFlags: { [label: string]: boolean } = {};
const runConnections: { [label: string]: ssh2.Client } = {};

// Add at the top, after imports
let defaultRemoteTargetDir: string | undefined;

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
    try {
        // Initialize providers
        scheduledRunsProvider = new ScheduledRunsProvider();
        machinesProvider = new MachinesProvider(context);
        
        // Initialize LOGS_DIR and ensure it exists
        LOGS_DIR = path.join(context.globalStoragePath, 'virtualclient-vscode-logs');
        try {
            await fsPromises.mkdir(LOGS_DIR, { recursive: true });
            console.log(`LOGS_DIR ensured at: ${LOGS_DIR}`);
        } catch (err) {
            console.error(`Failed to create LOGS_DIR at ${LOGS_DIR}:`, err);
            vscode.window.showErrorMessage(`Critical error: Failed to initialize logging directory. Extension might not function correctly.`);
        }
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
            vscode.commands.registerCommand('virtual-client.showLogFiles', () => handleShowLogFiles(context)),
            vscode.commands.registerCommand('virtual-client.openLogFile', async (stepOrRun: any) => {
                let runLabel = '';
                let logFileName = '';
                if (stepOrRun && stepOrRun.label && typeof stepOrRun.label === 'string' && stepOrRun.label.startsWith('Log: ')) {
                    logFileName = stepOrRun.label.substring('Log: '.length);
                    if (stepOrRun.runLabel) {
                        runLabel = stepOrRun.runLabel;
                    } else if (stepOrRun.parent && stepOrRun.parent.label) {
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
                        runLabel = stepOrRun.label;
                    }
                }
                if (!runLabel && stepOrRun && stepOrRun.runLabel) {
                    runLabel = stepOrRun.runLabel;
                }
                if (!runLabel) {
                    vscode.window.showErrorMessage('Could not determine run label for log file.');
                    return;
                }
                // If opening a specific log file
                if (logFileName) {
                    // Use .relativePath if present
                    let logFilePath;
                    if (stepOrRun.relativePath) {
                        const logsDir = path.join(context.globalStoragePath, 'logs', sanitizeLabel(runLabel));
                        logFilePath = path.join(logsDir, ...stepOrRun.relativePath.split('/'));
                    } else {
                        const logsDir = path.join(context.globalStoragePath, 'logs', sanitizeLabel(runLabel));
                        logFilePath = path.join(logsDir, logFileName);
                    }
                    try {
                        await fsPromises.access(logFilePath);
                    } catch {
                        vscode.window.showErrorMessage(`Log file not found or inaccessible: ${logFilePath}`);
                        return;
                    }
                    const doc = await vscode.workspace.openTextDocument(logFilePath);
                    await vscode.window.showTextDocument(doc, { preview: false });
                    return;
                }
                // Default: open the main .log file
                const logsDir = path.join(context.globalStorageUri.fsPath, 'logs');
                const safeLabel = runLabel.replace(/[\\/:"*?<>|,]/g, '-');
                const logFilePath = path.join(logsDir, `${safeLabel}.log`);
                try {
                    await fsPromises.access(logFilePath);
                } catch {
                    vscode.window.showErrorMessage(`Log file not found or inaccessible: ${logFilePath}`);
                    return;
                }
                const doc = await vscode.workspace.openTextDocument(logFilePath);
                await vscode.window.showTextDocument(doc, { preview: false });
            }),
            vscode.commands.registerCommand('virtual-client.cancelRun', async (runLabel: string) => {
                runCancelFlags[runLabel] = true;
                if (runConnections[runLabel]) {
                    runConnections[runLabel].end();
                    delete runConnections[runLabel];
                }
                vscode.window.showInformationMessage(`Cancelled run: ${runLabel}`);
            }),
            // New command to clear all scheduled runs and logs
            vscode.commands.registerCommand('virtual-client.removeAllScheduledRuns', async () => {
                // Confirmation dialogs are intentionally skipped in test environments (NODE_ENV === 'test', etc.)
                // to allow automated tests to run without UI interaction.
                const isTest = process.env.NODE_ENV === 'test' || process.env.VSC_JEST_WORKER === '1' || process.env.VSCODE_TEST === 'true';
                let confirm: string | undefined = 'Remove All';
                if (!isTest) {
                    confirm = await vscode.window.showWarningMessage(
                        'Are you sure you want to remove all scheduled runs and logs? This cannot be undone.',
                        { modal: true },
                        'Remove All'
                    );
                }
                if (confirm === 'Remove All') {
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
                    // Helper to recursively delete a directory
                    async function deleteDirectoryRecursive(dirPath: string, failedDeletes: string[]) {
                        try {
                            await fsPromises.access(dirPath);
                            const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
                            for (const entry of entries) {
                                const curPath = path.join(dirPath, entry.name);
                                if (entry.isDirectory()) {
                                    await deleteDirectoryRecursive(curPath, failedDeletes);
                                    try {
                                        await fsPromises.rmdir(curPath);
                                    } catch (e) {
                                        console.warn(`Failed to rmdir ${curPath}:`, e);
                                        failedDeletes.push(curPath);
                                    }
                                } else {
                                    try {
                                        await fsPromises.unlink(curPath);
                                    } catch (e) {
                                        console.warn(`Failed to unlink ${curPath}:`, e);
                                        failedDeletes.push(curPath);
                                    }
                                }
                            }
                        } catch (err) {
                            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                                console.warn(`Error accessing ${dirPath} for deletion:`, err);
                                failedDeletes.push(dirPath);
                            }
                        }
                    }
                    let failedDeletes: string[] = [];
                    // Delete all log files and subdirectories from both logs and virtualclient-vscode-logs directories
                    const logsDir1 = path.join(context.globalStorageUri.fsPath, 'logs');
                    await deleteDirectoryRecursive(logsDir1, failedDeletes);
                    const logsDir2 = LOGS_DIR;
                    await deleteDirectoryRecursive(logsDir2, failedDeletes);
                    if (failedDeletes.length > 0) {
                        vscode.window.showWarningMessage('Some log files or directories could not be deleted: ' + failedDeletes.join(', '));
                    }
                    vscode.window.showInformationMessage('All scheduled runs and logs have been cleared.');
                }
            }),
            vscode.commands.registerCommand('virtual-client.openExtensionLogFile', async (runItem: ScheduledRunItem) => {
                if (!runItem || !runItem.label) {
                    vscode.window.showErrorMessage('Could not determine run label for extension log file.');
                    return;
                }
                const logsDir = path.join(context.globalStorageUri.fsPath, 'logs');
                const safeLabel = runItem.label.replace(/[\\/:"*?<>|,]/g, '-');
                const logFilePath = path.join(logsDir, `${safeLabel}.log`);
                try {
                    await fsPromises.access(logFilePath);
                } catch {
                    vscode.window.showErrorMessage(`Extension log file not found or inaccessible: ${logFilePath}`);
                    return;
                }
                const doc = await vscode.workspace.openTextDocument(logFilePath);
                await vscode.window.showTextDocument(doc, { preview: false });
            }),
            vscode.commands.registerCommand('virtual-client.downloadLogsZip', async (step: any) => {
                // Find the run label
                let runLabel = '';
                if (step && step.runLabel) {
                    runLabel = step.runLabel;
                } else if (step && step.parent && step.parent.runLabel) {
                    runLabel = step.parent.runLabel;
                }
                if (!runLabel) {
                    vscode.window.showErrorMessage('Could not determine run label for logs.zip download.');
                    return;
                }
                const logsDir = path.join(context.globalStoragePath, 'logs', sanitizeLabel(runLabel));
                const zipPath = path.join(logsDir, 'logs.zip');
                try {
                    await fsPromises.access(zipPath);
                } catch {
                    vscode.window.showErrorMessage(`logs.zip not found or inaccessible: ${zipPath}`);
                    return;
                }
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(os.homedir(), 'logs.zip')),
                    saveLabel: 'Save logs.zip as...'
                });
                if (!uri) { return; }
                await fsPromises.copyFile(zipPath, uri.fsPath);
                vscode.window.showInformationMessage(`logs.zip saved to ${uri.fsPath}`);
            }),
            vscode.commands.registerCommand('virtual-client.refreshMachineStatus', async () => {
                if (machinesProvider && typeof machinesProvider.refreshConnectionStatus === 'function') {
                    await machinesProvider.refreshConnectionStatus();
                    vscode.window.showInformationMessage('Machine status refreshed.');
                } else {
                    vscode.window.showWarningMessage('Machines provider not available.');
                }
            }),
            vscode.commands.registerCommand('virtual-client.removeScheduledRun', async (item: ScheduledRunItem) => {
                if (!item || !item.runId) {
                    vscode.window.showErrorMessage('Could not determine run to remove.');
                    return;
                }
                // Confirmation dialogs are intentionally skipped in test environments (NODE_ENV === 'test', etc.)
                // to allow automated tests to run without UI interaction.
                const isTest = process.env.NODE_ENV === 'test' || process.env.VSC_JEST_WORKER === '1' || process.env.VSCODE_TEST === 'true';
                let confirm: string | undefined = 'Remove';
                if (!isTest) {
                    confirm = await vscode.window.showWarningMessage(
                        `Are you sure you want to remove the scheduled run for ${item.label}?`,
                        { modal: true },
                        'Remove'
                    );
                }
                if (confirm === 'Remove') {
                    scheduledRunsProvider.removeRun(item.runId);
                    vscode.window.showInformationMessage(`Scheduled run for ${item.label} has been removed.`);
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
                defaultRemoteTargetDir = 'C:\\VirtualClientScheduler';
            } else {
                defaultRemoteTargetDir = `/home/${os.userInfo().username}/VirtualClientScheduler`;
            }
        }

        console.log('Extension "virtual-client" is now active!');
    } catch (error) {
        console.error('Failed to activate extension:', error);
        vscode.window.showErrorMessage('Failed to activate Virtual Client extension. Please check the logs for details.');
    }
}

// This method is called when your extension is deactivated
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
                    machines = machines.map(m => m.ip === ip ? { ...m, platform } : m);
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
    const machines = await machinesProvider.getChildren();
    const machineItems = machines.map(m => ({
        label: m.label,
        ip: m.ip
    }));

    // Load last parameters
    const lastParameters = await context.globalState.get('lastParameters', {});

    // Helper to create fresh steps for each run
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
        }
    );

    // Set content security policy
    resources.panel.webview.html = getRunVirtualClientWebviewContent(machineItems, lastParameters, webviewSteps, resources.panel.webview);

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
                const isWindows = platform.startsWith('win');
                // Set the remote target directory automatically
                let remoteTargetDir: string;
                if (defaultRemoteTargetDir) {
                    remoteTargetDir = defaultRemoteTargetDir;
                } else if (isWindows) {
                    remoteTargetDir = 'C:\\VirtualClientScheduler';
                } else {
                    remoteTargetDir = `/home/${os.userInfo().username}/VirtualClientScheduler`;
                }
                const credentials = await machinesProvider.getMachineCredentials(message.machineIp);
                if (!credentials) {
                    throw new Error('Machine credentials not found');
                }
                // Update global state with last parameters (do not include remoteTargetDir)
                const { remoteTargetDir: _removed, ...paramsToSave } = message;
                await context.globalState.update('lastParameters', paramsToSave);
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
                );
                // --- LOG FILE SETUP ---
                const logsDir = path.join(context.globalStorageUri.fsPath, 'logs');
                try {
                    await fsPromises.mkdir(logsDir, { recursive: true });
                } catch (error) {
                    console.error(`Failed to create run-specific log directory ${logsDir}:`, error);
                    vscode.window.showErrorMessage('Failed to create log directory for the run.');
                }
                const safeLabel = runItem.label.replace(/[\\/:"*?<>|,]/g, '-');
                const logFilePath = path.join(logsDir, `${safeLabel}.log`);
                logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
                outputChannel = vscode.window.createOutputChannel(`Virtual Client Logs - ${runItem.label}`);
                outputChannel.show(true);
                // Determine log level from run parameters (default: Info)
                const { LogLevel, Logger } = await import('./types');
                let logLevel = LogLevel.Info;
                if (typeof message.logLevel === 'string') {
                    const levelStr = message.logLevel.toLowerCase();
                    if (levelStr === 'debug') { logLevel = LogLevel.Debug; }
                    else if (levelStr === 'info') { logLevel = LogLevel.Info; }
                    else if (levelStr === 'warn' || levelStr === 'warning') { logLevel = LogLevel.Warning; }
                    else if (levelStr === 'error') { logLevel = LogLevel.Error; }
                }
                logger = new Logger(logLevel, outputChannel, logStream);
                logger.info(`Scheduled run started for ${runItem.label}`);
                // --- END LOG FILE SETUP ---
                // Register the connection for cancellation
                runCancelFlags[runItem.label] = false;
                resources.conn = new ssh2.Client();
                runConnections[runItem.label] = resources.conn;
                resources.conn.on('ready', () => {
                    if (!resources.conn) {
                        return;
                    }
                    resources.conn.sftp((err: Error | undefined, sftp: any) => {
                        if (err) {
                            vscode.window.showErrorMessage(`SFTP error: ${err?.message}`);
                            console.error('SFTP error:', err);
                            logger?.error('SFTP error: ' + (err?.message || ''));
                            resources.cleanup();
                            logStream?.end();
                            return;
                        }
                        resources.sftp = sftp;
                        // Execute steps in sequence
                        const executeSteps = async () => {
                            try {
                                progress.report({ message: 'Initializing run...' });
                                // Step 0: Setup Machine
                                runItem.steps[0].status = 'running'; scheduledRunsProvider.update();
                                if (runItem.steps[0].substeps && runItem.steps[0].substeps[0]) { runItem.steps[0].substeps[0].status = 'running'; scheduledRunsProvider.update(); }
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
                                    
                                    // Create directory
                                    await sftpMkdirRecursive(sftp, remoteTargetDir, logger);
                                    
                                    // Verify directory was created
                                    await new Promise((resolve, reject) => {
                                        sftp.stat(remoteTargetDir, (err: any) => {
                                            if (err) {
                                                const errorMsg = `Failed to verify directory creation: ${err.message}`;
                                                logger?.error(errorMsg);
                                                reject(new Error(errorMsg));
                                            } else {
                                                logger?.debug(`[DEBUG] Successfully verified directory exists: ${remoteTargetDir}`);
                                                resolve(true);
                                            }
                                        });
                                    });

                                    if (runItem.steps[0].substeps && runItem.steps[0].substeps[0]) { 
                                        runItem.steps[0].substeps[0].status = 'success'; 
                                        runItem.steps[0].status = 'success';  // Update parent step status
                                        scheduledRunsProvider.update(); 
                                    }
                                    logger?.info('Step 1: Setup Machine > Create Remote Directory completed');
                                } catch (err) {
                                    const detail = `Failed to create remote directory: ${err instanceof Error ? err.message : err}`;
                                    logger?.error(`[ERROR] ${detail}`);
                                    console.error('[ERROR]', detail);
                                    vscode.window.showErrorMessage(detail);
                                    // Mark the substep and parent step as error
                                    if (runItem.steps[0].substeps && runItem.steps[0].substeps[0]) {
                                        runItem.steps[0].substeps[0].status = 'error';
                                        runItem.steps[0].substeps[0].detail = detail;
                                    }
                                    runItem.steps[0].status = 'error';
                                    runItem.steps[0].detail = detail;
                                    scheduledRunsProvider.update();
                                    throw err; // Re-throw to prevent continuing to upload step
                                }

                                // Only proceed to upload if directory creation was successful
                                const stepStatus = runItem.steps[0].status as 'pending' | 'running' | 'success' | 'error';
                                if (stepStatus !== 'success') {
                                    const errorMsg = `Cannot proceed with upload: directory creation failed (status: ${stepStatus})`;
                                    logger?.error(`[ERROR] ${errorMsg}`);
                                    throw new Error(errorMsg);
                                }

                                // Substep 0.1: Upload Package
                                if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { 
                                    runItem.steps[0].substeps[1].status = 'running'; 
                                    scheduledRunsProvider.update(); 
                                }
                                logger?.info('Step 1: Setup Machine > Upload Package');
                                // Validate package path
                                try {
                                    const stats = await fsPromises.stat(message.packagePath);
                                    if (!stats.isFile()) {
                                        const detail = `Local package path is not a file: ${message.packagePath}`;
                                        if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'error'; runItem.steps[0].substeps[1].detail = detail; }
                                        console.error(detail);
                                        logger?.error('Step 0.1 (Upload package) failed: ' + detail);
                                        scheduledRunsProvider.update();
                                        vscode.window.showErrorMessage(`Step 0.1 (Upload package) failed: ${detail}`);
                                        throw new Error(detail);
                                    }
                                } catch (error) {
                                    const detail = `Local package path does not exist or is not accessible: ${message.packagePath} - ${error instanceof Error ? error.message : error}`;
                                    if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'error'; runItem.steps[0].substeps[1].detail = detail; }
                                    console.error(detail);
                                    logger?.error('Step 0.1 (Upload package) failed: ' + detail);
                                    scheduledRunsProvider.update();
                                    vscode.window.showErrorMessage(`Step 0.1 (Upload package) failed: ${detail}`);
                                    throw new Error(detail);
                                }
                                const remotePackagePath = isWindows
                                    ? path.win32.join(remoteTargetDir, path.basename(message.packagePath))
                                    : path.posix.join(remoteTargetDir, path.basename(message.packagePath));
                                // Fix extracted directory path logic:
                                const packageName = path.basename(message.packagePath, path.extname(message.packagePath));
                                const extractDestDir = path.posix.join(remoteTargetDir.replace(/\\/g, '/'), packageName);
                                const extractDestDirWin = path.win32.join(remoteTargetDir, packageName);
                                const remoteExtractDir = isWindows ? extractDestDirWin : extractDestDir;
                                logger?.debug(`[DEBUG] remotePackagePath: ${remotePackagePath}`);
                                logger?.debug(`[DEBUG] remoteExtractDir: ${remoteExtractDir}`);
                                const checkExtractedDirExists = async () => {
                                    return new Promise((resolve) => {
                                        sftp.stat(remoteExtractDir, (err: Error | undefined) => {
                                            const dirExists = !err;
                                            logger?.debug(`[DEBUG] sftp.stat for extract dir: err=${err ? err.message : 'none'}, exists=${dirExists}`);
                                            resolve(dirExists);
                                        });
                                    });
                                };
                                if (await checkExtractedDirExists()) {
                                    logger?.debug('[DEBUG] Extracted directory exists. Skipping extraction.');
                                    if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'success'; scheduledRunsProvider.update(); }
                                    logger?.info('Step 1: Setup Machine > Upload Package skipped (already present and extracted)');
                                } else {
                                    logger?.debug('[DEBUG] Extracted directory does not exist. Proceeding with upload and extraction.');
                                    // --- NEW LOGIC: Check if remote package file exists, upload if not ---
                                    const checkRemotePackageExists = async () => {
                                        return new Promise<boolean>((resolve) => {
                                            sftp.stat(remotePackagePath, (err: any) => {
                                                const fileExists = !err;
                                                logger?.debug(`[DEBUG] sftp.stat for remote package: err=${err ? err.message : 'none'}, exists=${fileExists}`);
                                                resolve(fileExists);
                                            });
                                        });
                                    };
                                    const remotePackageExists = await checkRemotePackageExists();
                                    if (!remotePackageExists) {
                                        logger?.debug('[DEBUG] Remote package does not exist. Uploading package...');
                                        const localPath = message.packagePath;
                                        const remotePath = remotePackagePath;
                                        const { size: totalSize } = await fsPromises.stat(localPath);
                                        const totalMB = totalSize / (1024 * 1024);
                                        logger?.debug(`[DEBUG] Uploading package: ${totalMB.toFixed(2)} MB to remote using fastPut...`);
                                    
                                        // Progress bar state
                                        let lastLoggedPercent = 0;
                                        const barLength = 20;
                                        function renderProgressBar(percent: number) {
                                            const filled = Math.round((percent / 100) * barLength);
                                            const empty = barLength - filled;
                                            return `[${'#'.repeat(filled)}${'-'.repeat(empty)}] ${percent}%`;
                                        }
                                    
                                        // Log 0% at the start
                                        logger?.info(`[UPLOAD] ${renderProgressBar(0)} (0.00 MB / ${totalMB.toFixed(2)} MB)`);
                                    
                                        await new Promise<void>((resolve, reject) => {
                                            sftp.fastPut(localPath, remotePath, {
                                                // step is a built-in progress callback for fastPut in ssh2
                                                step: (transferred: number, chunk: number, total: number) => {
                                                    const percent = Math.floor((transferred / total) * 100);
                                                    // Only log every 5% or on completion
                                                    if (percent - lastLoggedPercent >= 5 || percent === 100) {
                                                        lastLoggedPercent = percent;
                                                        logger?.info(`[UPLOAD] ${renderProgressBar(percent)} (${(transferred / (1024 * 1024)).toFixed(2)} MB / ${(total / (1024 * 1024)).toFixed(2)} MB)`);
                                                    }
                                                },
                                                // Concurrency and chunkSize can be tuned, but defaults are often good.
                                                // concurrency: 64,
                                                // chunkSize: 32768
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
                                        if (machine.platform?.startsWith('win')) {
                                            checkExtractCmd = 'powershell -Command "Get-Command Expand-Archive"';
                                            extractCmd = `powershell -Command \"Expand-Archive -Path '${remotePackagePath.replace(/\//g, '\\')}' -DestinationPath '${extractDestDirWin.replace(/\//g, '\\')}' -Force\"`;
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
                                                    stream.on('data', (data: Buffer) => {
                                                        stdout += data.toString();
                                                        logger?.info('Extract stdout: ' + data.toString());
                                                    });
                                                    stream.stderr.on('data', (data: Buffer) => {
                                                        stderr += data.toString();
                                                        logger?.warn('Extract stderr: ' + data.toString());
                                                    });
                                                    stream.on('close', async (code: number) => {
                                                        if (code === 0) {
                                                            // After extraction, verify the directory exists
                                                            const extractedNowExists = await checkExtractedDirExists();
                                                            if (extractedNowExists) {
                                                                if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'success'; scheduledRunsProvider.update(); }
                                                                logger?.info('Extraction completed and directory verified.');
                                                                resolve(true);
                                                            } else {
                                                                const detail = 'Extraction command completed but extracted directory not found.';
                                                                if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'error'; runItem.steps[0].substeps[1].detail = detail; scheduledRunsProvider.update(); }
                                                                logger?.error(detail);
                                                                vscode.window.showErrorMessage(detail);
                                                                reject(new Error(detail));
                                                            }
                                                        } else {
                                                            const detail = `Extraction failed (code ${code}): ${stderr}`;
                                                            if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'error'; runItem.steps[0].substeps[1].detail = detail; scheduledRunsProvider.update(); }
                                                            logger?.error(detail);
                                                            vscode.window.showErrorMessage(detail);
                                                            reject(new Error(detail));
                                                        }
                                                    });
                                                });
                                            });
                                        } else {
                                            logger?.debug('[DEBUG] No extraction command defined for this package type.');
                                        }
                                        // ... existing code ...

                            } catch (err) {
                                    logger?.debug(`[DEBUG] Upload or extraction failed: ${err instanceof Error ? err.message : err}`);
                                    logger?.error(`Step 0.1 (Upload or extraction) failed: ${err instanceof Error ? err.message : err}`);
                                    vscode.window.showErrorMessage(`Step 0.1 (Upload or extraction) failed: ${err instanceof Error ? err.message : err}`);
                                    throw err;
                                }
                            }

                            // Mark Setup Machine as success if all substeps succeeded
                            if (runItem.steps[0].substeps && runItem.steps[0].substeps.every(s => s.status === 'success')) { runItem.steps[0].status = 'success'; scheduledRunsProvider.update(); }

                            // Step 1: Run Virtual Client
                            runItem.steps[1].status = 'running'; scheduledRunsProvider.update();
                            if (runItem.steps[1].substeps && runItem.steps[1].substeps[0]) {
                                runItem.steps[1].substeps[0].status = 'running'; scheduledRunsProvider.update();
                            }
                            logger?.info('Step 2: Run Virtual Client > Verify Virtual Client Tool');
                            
                            // Use the platform from the selected machine, not from the message
                            if (!platform) {
                                runItem.steps[1].status = 'error';
                                runItem.steps[1].detail = `Platform is not set for the selected machine.`;
                                logger?.error(`Platform is not set for the selected machine.`);
                                scheduledRunsProvider.update();
                                throw new Error('Platform is not set for the selected machine.');
                            }
                            
                            let toolExecutable = '';
                            if (isWindows) {
                                toolExecutable = 'VirtualClient.exe';
                            } else if (platform.startsWith('linux')) {
                                toolExecutable = 'VirtualClient';
                            } else {
                                logger?.warn(`Unknown platform: ${platform}. Defaulting to VirtualClient.`);
                                toolExecutable = 'VirtualClient';
                            }
                            let toolPath, toolDir;
                            if (isWindows) {
                                toolPath = path.win32.join(extractDestDirWin, 'content', platform, toolExecutable);
                                toolDir = path.win32.dirname(toolPath);
                            } else {
                                toolPath = path.posix.join(extractDestDir, 'content', platform, toolExecutable);
                                toolDir = path.posix.dirname(toolPath);
                            }
                            // --- TOOL PATH VALIDATION AND LOGGING ---
                            // Validate tool path exists on remote before running
                            logger?.debug(`[DEBUG] Tool path: ${toolPath}`);
                            let toolExists = false;
                            try {
                                await new Promise((resolve) => {
                                    sftp.stat(toolPath, (err: Error | undefined) => {
                                        toolExists = !err;
                                        if (toolExists) {
                                            logger?.debug(`[DEBUG] Tool exists: ${toolPath}`);
                                        }
                                        resolve(true);
                                    });
                                });
                            } catch (err) {
                                logger?.debug(`[DEBUG] Tool path validation error: ${err instanceof Error ? err.message : err}`);
                            }
                            if (runItem.steps[1].substeps && runItem.steps[1].substeps[0]) {
                                if (toolExists) {
                                    runItem.steps[1].substeps[0].status = 'success';
                                    scheduledRunsProvider.update();
                                } else {
                                    runItem.steps[1].substeps[0].status = 'error';
                                    runItem.steps[1].substeps[0].detail = `VirtualClient tool not found at path: ${toolPath}`;
                                    runItem.steps[1].status = 'error';
                                    runItem.steps[1].detail = `VirtualClient tool not found at path: ${toolPath}`;
                                    logger?.error(`VirtualClient tool not found at path: ${toolPath}`);
                                    scheduledRunsProvider.update();
                                    throw new Error(`VirtualClient tool not found at path: ${toolPath}`);
                                }
                            }
                            // --- END TOOL PATH VALIDATION ---
                            // Build the command
                            let vcCmd = '';
                            if (message.profile) { vcCmd += ` --profile ${message.profile}`; }
                            if (message.system) { vcCmd += ` --system ${message.system}`; }
                            if (message.timeout) { vcCmd += ` --timeout ${message.timeout.toString()}`; }
                            if (message.exitWait) { vcCmd += ` --exit-wait ${message.exitWait.toString()}`; }
                            if (message.proxyApi) { vcCmd += ` --proxy-api ${message.proxyApi}`; }
                            if (message.packageStore) { vcCmd += ` --package-store ${message.packageStore}`; }
                            if (message.eventHub) { vcCmd += ` --event-hub ${message.eventHub}`; }
                            if (message.experimentId) { vcCmd += ` --experiment-id ${message.experimentId}`; }
                            if (message.clientId) { vcCmd += ` --client-id ${message.clientId}`; }
                            if (message.metadata) { vcCmd += ` --metadata ${message.metadata}`; }
                            if (message.parameters) { vcCmd += ` --parameters ${message.parameters}`; }
                            if (message.port) { vcCmd += ` --port ${message.port}`; }
                            if (message.ipAddress) { vcCmd += ` --ip-address ${message.ipAddress}`; }
                            if (message.logToFile) { vcCmd += ` --log-to-file`; }
                            if (message.clean) { vcCmd += ` --clean`; }
                            if (message.debug) { vcCmd += ` --debug`; }
                            if (message.dependencies) { vcCmd += ` --dependencies ${message.dependencies}`; }
                            if (message.iterations) { vcCmd += ` --iterations ${message.iterations}`; }
                            if (message.logLevel) { vcCmd += ` --log-level ${message.logLevel}`; }
                            if (message.failFast) { vcCmd += ` --fail-fast`; }
                            // Run the command in the tool directory, capture PID
                            let command = '';
                            if (platform && isWindows) {
                                command = `"${toolPath}"${vcCmd}`;
                            } else {
                                command = `${shQuote(toolPath)}${vcCmd}`;
                            }
                            logger?.debug(`[DEBUG] Command to execute: ${command}`);
                            // Run the command in the remote target directory, capture PID
                            if (runItem.steps[1].substeps && runItem.steps[1].substeps[1]) {
                                runItem.steps[1].substeps[1].status = 'running';
                                scheduledRunsProvider.update();
                            }
                            logger?.info('Step 2: Run Virtual Client > Execute Virtual Client Command');
                            await new Promise((resolve, reject) => {
                                if (runCancelFlags[runItem.label]) {
                                    if (runItem.steps[1].substeps && runItem.steps[1].substeps[1]) {
                                        runItem.steps[1].substeps[1].status = 'error';
                                        runItem.steps[1].substeps[1].detail = 'Run cancelled before execution.';
                                    }
                                    runItem.steps[1].status = 'error';
                                    runItem.steps[1].detail = 'Run cancelled before execution.';
                                    logger?.warn('Run cancelled before execution.');
                                    scheduledRunsProvider.update();
                                    return reject(new Error('Run cancelled'));
                                }
                                resources.conn!.exec(command, (err: any, stream: any) => {
                                    if (err) {
                                        if (runItem.steps[1].substeps && runItem.steps[1].substeps[1]) {
                                            runItem.steps[1].substeps[1].status = 'error';
                                            runItem.steps[1].substeps[1].detail = `Failed to start Virtual Client: ${err.message}`;
                                        }
                                        runItem.steps[1].status = 'error';
                                        runItem.steps[1].detail = `Failed to start Virtual Client: ${err.message}`;
                                        logger?.error('Virtual Client execution error: ' + err.message);
                                        scheduledRunsProvider.update();
                                        return reject(err);
                                    }
                                    let stdout = '';
                                    let stderr = '';
                                    stream.on('data', (data: Buffer) => {
                                        const msg = data.toString();
                                        stdout += msg;
                                        logger?.info('VC stdout: ' + msg);
                                    }).stderr.on('data', (data: Buffer) => {
                                        const msg = data.toString();
                                        stderr += msg;
                                        logger?.warn('VC stderr: ' + msg);
                                    });
                                    stream.on('close', (code: number, signal: string) => {
                                        if (runCancelFlags[runItem.label]) {
                                            if (runItem.steps[1].substeps && runItem.steps[1].substeps[1]) {
                                                runItem.steps[1].substeps[1].status = 'error';
                                                runItem.steps[1].substeps[1].detail = 'Run cancelled.';
                                            }
                                            runItem.steps[1].status = 'error';
                                            runItem.steps[1].detail = 'Run cancelled.';
                                            logger?.warn('Run cancelled during execution.');
                                            scheduledRunsProvider.update();
                                            return reject(new Error('Run cancelled'));
                                        }
                                        if (code === 0) {
                                            if (runItem.steps[1].substeps && runItem.steps[1].substeps[1]) {
                                                runItem.steps[1].substeps[1].status = 'success';
                                                scheduledRunsProvider.update();
                                            }
                                            logger?.info('Step 2: Run Virtual Client completed');
                                            // Mark parent as success only if both substeps succeeded
                                            if (runItem.steps[1].substeps && runItem.steps[1].substeps.every(s => s.status === 'success')) {
                                                runItem.steps[1].status = 'success';
                                                scheduledRunsProvider.update();
                                            }
                                            resolve(true);
                                        } else {
                                            if (runItem.steps[1].substeps && runItem.steps[1].substeps[1]) {
                                                runItem.steps[1].substeps[1].status = 'error';
                                                runItem.steps[1].substeps[1].detail = `Execution failed (code ${code}): ${stderr}`;
                                            }
                                            runItem.steps[1].status = 'error';
                                            runItem.steps[1].detail = `Execution failed (code ${code}): ${stderr}`;
                                            logger?.error('Virtual Client execution failed: ' + stderr);
                                            scheduledRunsProvider.update();
                                            reject(new Error(runItem.steps[1].detail));
                                        }
                                    });
                                });
                            });

                            // Step 2: Transfer Logs
                            const logsStep = new ScheduledRunStep('Transfer Logs', 'running', undefined, [
                                new ScheduledRunStep('Zip Logs Folder', 'pending'),
                                new ScheduledRunStep('Download Logs Zip', 'pending'),
                                new ScheduledRunStep('Extract Logs Locally', 'pending')
                            ]);
                            // Set runLabel on Extract Logs Locally step for download button
                            if (logsStep.substeps && logsStep.substeps[2]) {
                                (logsStep.substeps[2] as any).runLabel = runItem.label;
                            }
                            runItem.steps.push(logsStep);
                            scheduledRunsProvider.update();

                            try {
                                // 1. Zip logs folder on remote
                                const remoteLogsDir = path.win32.join(extractDestDirWin, 'content', platform, 'logs');
                                const remoteZipPath = path.win32.join(extractDestDirWin, 'content', platform, 'logs.zip');
                                const zipCmd = `powershell -Command "Compress-Archive -Path '${remoteLogsDir}/*' -DestinationPath '${remoteZipPath}' -Force"`;
                                logger?.debug('[DEBUG] Starting Transfer Logs > Zip Logs Folder');
                                logger?.debug(`[DEBUG] Remote logs directory: ${remoteLogsDir}`);
                                logger?.debug(`[DEBUG] Remote zip path: ${remoteZipPath}`);
                                logger?.debug(`[DEBUG] Zip command: ${zipCmd}`);
                                logsStep.substeps![0].status = 'running'; scheduledRunsProvider.update();
                                await new Promise((resolve, reject) => {
                                    resources.conn!.exec(zipCmd, (err: Error | undefined, stream: any) => {
                                        if (err) {
                                            logger?.debug(`[DEBUG] Error starting zip command: ${err.message}`);
                                            return reject(err);
                                        }
                                        let stderr = '';
                                        let stdout = '';
                                        stream.on('data', (data: Buffer) => {
                                            stdout += data.toString();
                                            logger?.info(`[DEBUG] Zip stdout: ${data.toString()}`);
                                        });
                                        stream.stderr.on('data', (data: Buffer) => {
                                            stderr += data.toString();
                                            logger?.warn(`[DEBUG] Zip stderr: ${data.toString()}`);
                                        });
                                        stream.on('close', (code: number) => {
                                            logger?.debug(`[DEBUG] Zip command exited with code ${code}`);
                                            if (code === 0) { resolve(true); }
                                            else {
                                                logger?.debug(`[DEBUG] Zip failed with stderr: ${stderr}`);
                                                reject(new Error(`Zip failed: ${stderr}`));
                                            }
                                        });
                                    });
                                });
                                logger?.debug('[DEBUG] Finished Transfer Logs > Zip Logs Folder');
                                logsStep.substeps![0].status = 'success'; scheduledRunsProvider.update();

                                // 2. Download logs.zip
                                logsStep.substeps![1].status = 'running'; scheduledRunsProvider.update();
                                const localLogsDir = path.join(context.globalStoragePath, 'logs', sanitizeLabel(runItem.label));
                                await fsPromises.mkdir(localLogsDir, { recursive: true });
                                const localZipPath = path.join(localLogsDir, 'logs.zip');
                                await sftpDownloadFile(sftp, remoteZipPath, localZipPath);
                                // Cleanup: delete logs.zip on remote
                                const cleanupZipCmd = `powershell -Command "Remove-Item -Path '${remoteZipPath.replace(/'/g, "''")}' -Force"`;
                                await new Promise((resolve, reject) => {
                                    resources.conn!.exec(cleanupZipCmd, (err: Error | undefined, stream: any) => {
                                        if (err) { resolve(true); return; } // Don't fail the run if cleanup fails
                                        stream.on('close', () => resolve(true));
                                        stream.on('data', () => {});
                                        stream.stderr.on('data', () => {});
                                    });
                                });
                                logsStep.substeps![1].status = 'success'; scheduledRunsProvider.update();

                                // 3. Extract logs.zip locally
                                logsStep.substeps![2].status = 'running'; scheduledRunsProvider.update();
                                await extractZip(localZipPath, localLogsDir);
                                logsStep.substeps![2].status = 'success'; scheduledRunsProvider.update();

                                // Recursively walk the logs directory and build tree nodes
                                async function buildLogSteps(dir: string, parentStep: any, relPath: string): Promise<ScheduledRunStep[]> {
                                    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
                                    const stepsPromises = entries.map(async (entry) => {
                                        if (entry.name === 'logs.zip') { return null; }
                                        const fullPath = path.join(dir, entry.name);
                                        const entryRelPath = relPath ? path.posix.join(relPath, entry.name) : entry.name;
                                        if (entry.isDirectory()) {
                                            const folderStep = new ScheduledRunStep(entry.name, 'success', undefined);
                                            (folderStep as any).parent = parentStep;
                                            (folderStep as any).runLabel = runItem.label;
                                            folderStep.substeps = await buildLogSteps(fullPath, folderStep, entryRelPath);
                                            return folderStep;
                                        } else if (entry.isFile()) {
                                            const logStep = new ScheduledRunStep(`Log: ${entry.name}`, 'success', undefined);
                                            (logStep as any).parent = parentStep;
                                            (logStep as any).runLabel = runItem.label;
                                            (logStep as any).relativePath = entryRelPath;
                                            return logStep;
                                        }
                                        return null;
                                    });
                                    const steps = (await Promise.all(stepsPromises)).filter(s => s !== null) as ScheduledRunStep[];
                                    return steps;
                                }
                                // Attach the log tree to the 'Extract Logs Locally' substep
                                if (logsStep.substeps && logsStep.substeps[2]) {
                                    logsStep.substeps[2].substeps = await buildLogSteps(localLogsDir, logsStep.substeps[2], '');
                                }
                                scheduledRunsProvider.update();

                                logsStep.status = 'success';
                                logsStep.detail = `Logs transferred to ${localLogsDir}`;
                                scheduledRunsProvider.update();
                            } catch (err) {
                                logsStep.status = 'error';
                                logsStep.detail = err instanceof Error ? err.message : String(err);
                                for (const sub of logsStep.substeps ?? []) { if (sub.status === 'running' || sub.status === 'pending') { sub.status = 'error'; } }
                                scheduledRunsProvider.update();
                                logger?.error('Step 3 (Transfer Logs) failed: ' + logsStep.detail);
                            }

                        } catch (error) {
                                progress.report({ message: 'Error occurred. See logs for details.' });
                                throw error;
                            } finally {
                                logger?.info('Scheduled run finished.');
                                logStream?.end();
                                outputChannel?.appendLine('=== Run finished ===');
                                outputChannel?.show(true);
                        }
                    };

                    executeSteps();
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
            console.error('Failed to execute run:', error);
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
    const logFile = path.join(context.globalStorageUri.fsPath, 'logs', `${item.label}.log`);
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
        const logFiles = (await fsPromises.readdir(LOGS_DIR)).filter(f => f.endsWith('.json'));
        if (logFiles.length === 0) {
            vscode.window.showInformationMessage('No log files found.');
            return;
        }

        const selectedFile = await vscode.window.showQuickPick(logFiles, {
            placeHolder: 'Select a log file to view'
        });

        if (selectedFile) {
            const logPath = path.join(LOGS_DIR, selectedFile);
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
    const machineItems = machines.map(m => ({
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
            }

            // Close the webview
            panel.dispose();
        }
    });
}