// Node core modules
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// NPM packages
import * as ssh2 from 'ssh2';
import { spawn } from 'child_process';

// Local files
import { getAddMachineWebviewContent, getRunVirtualClientWebviewContent, showRunDetailsWebview } from './webviewContent';
import { VirtualClientTreeViewProvider } from './VirtualClientTreeViewProvider';
import { MachineCredentials } from './types';
import { ScheduledRunsProvider, ScheduledRunItem, ScheduledRunStep } from './ScheduledRunsProvider';
import { MachinesProvider, MachineItem } from './machinesProvider';

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

// Global resource manager
let globalResourceManager: RunResourceManager | undefined;

// Shared state
let sharedMachines: { label: string, ip: string }[] = [];

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

// Helper functions for run persistence
interface PersistentRun {
    id: string;
    label: string;
    steps: RunStep[];
    logs: string[];
    started: number;
    finished?: number;
}

function getPersistentRuns(context: vscode.ExtensionContext): PersistentRun[] {
    return context.globalState.get<PersistentRun[]>('persistentRuns', []);
}

function savePersistentRuns(context: vscode.ExtensionContext, runs: PersistentRun[]) {
    context.globalState.update('persistentRuns', runs);
}

// Helper functions for log management
export function loadScheduledRuns(context: vscode.ExtensionContext): any[] {
    LOGS_DIR = path.join(context.globalStoragePath, 'virtualclient-vscode-logs');
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
        const content = fs.readFileSync(path.join(LOGS_DIR, f), 'utf-8');
        return JSON.parse(content);
    });
}

export function saveScheduledRun(context: vscode.ExtensionContext, run: any) {
    LOGS_DIR = path.join(context.globalStoragePath, 'virtualclient-vscode-logs');
    // Create the directory structure recursively
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    
    // Create a timestamp-based filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}_${run.machineLabel}(${run.machineIp}).json`;
    const file = path.join(LOGS_DIR, filename);
    
    try {
        fs.writeFileSync(file, JSON.stringify(run, null, 2));
    } catch (error) {
        console.error('Failed to save run:', error);
        vscode.window.showErrorMessage(`Failed to save run: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export function clearLogsFolder(context: vscode.ExtensionContext) {
    LOGS_DIR = path.join(context.globalStoragePath, 'virtualclient-vscode-logs');
    if (fs.existsSync(LOGS_DIR)) {
        fs.readdirSync(LOGS_DIR).forEach(f => {
            fs.unlinkSync(path.join(LOGS_DIR, f));
        });
    }
}

// Add a global cancel flag and a map to track running connections by run label
const runCancelFlags: { [label: string]: boolean } = {};
const runConnections: { [label: string]: ssh2.Client } = {};

// Helper to safely quote shell arguments
function shQuote(str: string) {
    return `'${str.replace(/'/g, `"'"`)}'`;
}

// Helper to sanitize run label for filesystem paths
function sanitizeLabel(label: string): string {
    return label.replace(/[\\/:*?"<>|,]/g, '-');
}

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
    try {
        // Initialize providers
        scheduledRunsProvider = new ScheduledRunsProvider();
        machinesProvider = new MachinesProvider(context);
        
        // Load any existing scheduled runs
        const existingRuns = loadScheduledRuns(context);
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
                    if (!fs.existsSync(logFilePath)) {
                        vscode.window.showErrorMessage(`Log file not found: ${logFilePath}`);
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
                if (!fs.existsSync(logFilePath)) {
                    vscode.window.showErrorMessage(`Log file not found: ${logFilePath}`);
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
            vscode.commands.registerCommand('virtual-client.clearScheduledRuns', async () => {
                const confirm = await vscode.window.showWarningMessage(
                    'Are you sure you want to clear all scheduled runs and logs? This cannot be undone.',
                    { modal: true },
                    'Clear'
                );
                if (confirm === 'Clear') {
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
                    // Delete all log files from both logs and virtualclient-vscode-logs directories
                    const logsDir1 = path.join(context.globalStorageUri.fsPath, 'logs');
                    let failedDeletes: string[] = [];
                    if (fs.existsSync(logsDir1)) {
                        fs.readdirSync(logsDir1).forEach(f => {
                            try {
                                fs.unlinkSync(path.join(logsDir1, f));
                            } catch (err) {
                                failedDeletes.push(path.join(logsDir1, f));
                            }
                        });
                    }
                    const logsDir2 = path.join(context.globalStoragePath, 'virtualclient-vscode-logs');
                    if (fs.existsSync(logsDir2)) {
                        fs.readdirSync(logsDir2).forEach(f => {
                            try {
                                fs.unlinkSync(path.join(logsDir2, f));
                            } catch (err) {
                                failedDeletes.push(path.join(logsDir2, f));
                            }
                        });
                    }
                    if (failedDeletes.length > 0) {
                        vscode.window.showWarningMessage('Some log files could not be deleted: ' + failedDeletes.join(', '));
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
                if (!fs.existsSync(logFilePath)) {
                    vscode.window.showErrorMessage(`Extension log file not found: ${logFilePath}`);
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
                if (!fs.existsSync(zipPath)) {
                    vscode.window.showErrorMessage(`logs.zip not found: ${zipPath}`);
                    return;
                }
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(os.homedir(), 'logs.zip')),
                    saveLabel: 'Save logs.zip as...'
                });
                if (!uri) return;
                fs.copyFileSync(zipPath, uri.fsPath);
                vscode.window.showInformationMessage(`logs.zip saved to ${uri.fsPath}`);
            })
        ];

        context.subscriptions.push(...disposables);

        // Disable telemetry
        const telemetryConfig = vscode.workspace.getConfiguration('telemetry');
        telemetryConfig.update('enableTelemetry', false, vscode.ConfigurationTarget.Global);

        console.log('Extension "virtual-client" is now active!');
    } catch (error) {
        console.error('Failed to activate extension:', error);
        vscode.window.showErrorMessage('Failed to activate Virtual Client extension. Please check the logs for details.');
    }
}

// This method is called when your extension is deactivated
export function deactivate() {
    // Clean up global resources
    if (globalResourceManager) {
        globalResourceManager.cleanup();
        globalResourceManager = undefined;
    }
}

// Command handlers
async function handleAddMachine(context: vscode.ExtensionContext, machinesProvider: MachinesProvider) {
    const resources = new RunResourceManager();
    globalResourceManager = resources;
    
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
                    const conn = new ssh2.Client();
                    conn.on('ready', () => {
                        conn.exec('uname -s && uname -m || (ver & echo %PROCESSOR_ARCHITECTURE%)', (err: Error | undefined, stream: any) => {
                            if (err) {
                                resources.panel?.webview.postMessage({ command: 'platformDetected', platform: '' });
                                conn.end();
                                return;
                            }
                            let output = '';
                            stream.on('data', (data: Buffer) => { output += data.toString(); });
                            stream.on('close', () => {
                                let platform = '';
                                if (/Linux/i.test(output)) {
                                    if (/aarch64|arm64/i.test(output)) { platform = 'linux-arm64'; }
                                    else if (/x86_64/i.test(output)) { platform = 'linux-x64'; }
                                } else if (/Windows/i.test(output)) {
                                    if (/ARM64/i.test(output)) { platform = 'win-arm64'; }
                                    else if (/AMD64/i.test(output)) { platform = 'win-x64'; }
                                }
                                resources.panel?.webview.postMessage({ command: 'platformDetected', platform });
                                conn.end();
                            });
                        });
                    });
                    conn.on('error', () => {
                        resources.panel?.webview.postMessage({ command: 'platformDetected', platform: '' });
                    });
                    conn.connect({
                        host: ip,
                        username,
                        password
                    });
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
        if (globalResourceManager === resources) {
            globalResourceManager = undefined;
        }
    });
}

export async function handleRunVirtualClient(context: vscode.ExtensionContext) {
    const resources = new RunResourceManager();
    globalResourceManager = resources;
    
    // Get all machines from the provider
    const machines = await machinesProvider.getChildren();
    const machineItems = machines.map(m => ({
        label: m.label,
        ip: m.ip
    }));

    // Load last parameters
    const lastParameters = await context.globalState.get('lastParameters', {});

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

    // Define hierarchical steps for the run
    const steps = [
        new ScheduledRunStep('Setup Machine', 'pending', undefined, [
            new ScheduledRunStep('Create Remote Directory', 'pending'),
            new ScheduledRunStep('Upload Package', 'pending')
        ]),
        new ScheduledRunStep('Run Virtual Client', 'pending', undefined, [
            new ScheduledRunStep('Verify Virtual Client Tool', 'pending'),
            new ScheduledRunStep('Execute Virtual Client Command', 'pending')
        ])
    ];

    const webviewSteps = steps.map(step => ({
        label: step.label as string,
        status: step.status,
        detail: step.detail
    }));

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
                const conn = new ssh2.Client();
                conn.on('ready', () => {
                    // Try uname -s (Linux), fallback to ver (Windows)
                    conn.exec('uname -s && uname -m || (ver & echo %PROCESSOR_ARCHITECTURE%)', (err: Error | undefined, stream: any) => {
                        if (err) {
                            resources.panel?.webview.postMessage({ command: 'platformDetected', platform: '' });
                            conn.end();
                            return;
                        }
                        let output = '';
                        stream.on('data', (data: Buffer) => { output += data.toString(); });
                        stream.on('close', () => {
                            let platform = '';
                            if (/Linux/i.test(output)) {
                                if (/aarch64|arm64/i.test(output)) { platform = 'linux-arm64'; }
                                else if (/x86_64/i.test(output)) { platform = 'linux-x64'; }
                                // Add more as needed
                            } else if (/Windows/i.test(output)) {
                                if (/ARM64/i.test(output)) { platform = 'win-arm64'; }
                                else if (/AMD64/i.test(output)) { platform = 'win-x64'; }
                                // Add more as needed
                            }
                            resources.panel?.webview.postMessage({ command: 'platformDetected', platform });
                            conn.end();
                        });
                    });
                });
                conn.on('error', () => {
                    resources.panel?.webview.postMessage({ command: 'platformDetected', platform: '' });
                });
                conn.connect({
                    host: machine.ip,
                    username: credentials.username,
                    password: credentials.password,
                    algorithms: {
                        cipher: ['aes128-ctr']
                    }
                });
            } catch {
                resources.panel?.webview.postMessage({ command: 'platformDetected', platform: '' });
            }
            return;
        }
        // --- LOG FILE VARS ---
        let logStream: fs.WriteStream | undefined;
        let logToFile: ((msg: string) => void) | undefined;
        // --- OutputChannel for real-time streaming ---
        let outputChannel: vscode.OutputChannel | undefined;
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
                if (!message.remoteTargetDir || typeof message.remoteTargetDir !== 'string' || !message.remoteTargetDir.trim()) {
                    vscode.window.showErrorMessage('Remote target directory is required.');
                    throw new Error('Remote target directory is required.');
                }
                if (!message.machineIp || typeof message.machineIp !== 'string' || !message.machineIp.trim()) {
                    vscode.window.showErrorMessage('Machine IP is required.');
                    throw new Error('Machine IP is required.');
                }
                const platform = machine.platform;
                if (!platform || platform.trim() === '') {
                    logToFile?.('Platform is not set or empty for the selected machine.');
                    vscode.window.showErrorMessage('Platform is not set for the selected machine.');
                    throw new Error('Platform is not set for the selected machine.');
                }

                const isWindows = platform.startsWith('win');

                const credentials = await machinesProvider.getMachineCredentials(message.machineIp);
                if (!credentials) {
                    throw new Error('Machine credentials not found');
                }

                // Update global state with last parameters
                await context.globalState.update('lastParameters', message);

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
                    steps
                );

                // --- LOG FILE SETUP ---
                const logsDir = path.join(context.globalStorageUri.fsPath, 'logs');
                if (!fs.existsSync(logsDir)) {
                    fs.mkdirSync(logsDir, { recursive: true });
                }
                const safeLabel = runItem.label.replace(/[\\/:"*?<>|,]/g, '-');
                const logFilePath = path.join(logsDir, `${safeLabel}.log`);
                logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
                // Create OutputChannel for this run
                outputChannel = vscode.window.createOutputChannel(`Virtual Client Logs - ${runItem.label}`);
                outputChannel.show(true);
                logToFile = function(msg: string) {
                    const line = `[${new Date().toISOString()}] ${msg}`;
                    logStream!.write(line + '\n');
                    outputChannel!.appendLine(line);
                };
                logToFile?.(`Scheduled run started for ${runItem.label}`);
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
                            logToFile?.('SFTP error: ' + (err?.message || ''));
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
                                logToFile?.('Step 1: Setup Machine > Create Remote Directory');
                                try {
                                    await sftpMkdirRecursive(sftp, message.remoteTargetDir);
                                    if (runItem.steps[0].substeps && runItem.steps[0].substeps[0]) { runItem.steps[0].substeps[0].status = 'success'; scheduledRunsProvider.update(); }
                                    logToFile?.('Step 1: Setup Machine > Create Remote Directory completed');
                                } catch (err) {
                                    logToFile?.(`Step 0 (Initialize run) failed: ${err instanceof Error ? err.message : err}`);
                                    vscode.window.showErrorMessage(`Step 0 (Initialize run) failed: ${err instanceof Error ? err.message : err}`);
                                    throw err;
                                }

                                // Substep 0.1: Upload Package
                                if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'running'; scheduledRunsProvider.update(); }
                                logToFile?.('Step 1: Setup Machine > Upload Package');
                                if (!fs.existsSync(message.packagePath) || !fs.statSync(message.packagePath).isFile()) {
                                    const detail = `Local package path does not exist or is not a file: ${message.packagePath}`;
                                    if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'error'; runItem.steps[0].substeps[1].detail = detail; }
                                    console.error(detail);
                                    logToFile?.('Step 0.1 (Upload package) failed: ' + detail);
                                    scheduledRunsProvider.update();
                                    vscode.window.showErrorMessage(`Step 0.1 (Upload package) failed: ${detail}`);
                                    throw new Error(detail);
                                }
                                const remotePackagePath = path.posix.join(message.remoteTargetDir, path.basename(message.packagePath));
                                // Fix extracted directory path logic:
                                const packageName = path.basename(message.packagePath, path.extname(message.packagePath));
                                const extractDestDir = path.posix.join(message.remoteTargetDir.replace(/\\/g, '/'), packageName);
                                const extractDestDirWin = path.win32.join(message.remoteTargetDir, packageName);
                                const remoteExtractDir = isWindows ? extractDestDirWin : extractDestDir;
                                logToFile?.(`[DEBUG] remotePackagePath: ${remotePackagePath}`);
                                logToFile?.(`[DEBUG] remoteExtractDir: ${remoteExtractDir}`);
                                const checkExtractedDirExists = async () => {
                                    return new Promise((resolve) => {
                                        sftp.stat(remoteExtractDir, (err: Error | undefined) => {
                                            const dirExists = !err;
                                            logToFile?.(`[DEBUG] sftp.stat for extract dir: err=${err ? err.message : 'none'}, exists=${dirExists}`);
                                            resolve(dirExists);
                                        });
                                    });
                                };
                                if (await checkExtractedDirExists()) {
                                    logToFile?.('[DEBUG] Extracted directory exists. Skipping extraction.');
                                    if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'success'; scheduledRunsProvider.update(); }
                                    logToFile?.('Step 1: Setup Machine > Upload Package skipped (already present and extracted)');
                                } else {
                                    logToFile?.('[DEBUG] Extracted directory does not exist. Proceeding with upload and extraction.');
                                    // --- NEW LOGIC: Check if remote package file exists, upload if not ---
                                    const checkRemotePackageExists = async () => {
                                        return new Promise<boolean>((resolve) => {
                                            sftp.stat(remotePackagePath, (err: any) => {
                                                const fileExists = !err;
                                                logToFile?.(`[DEBUG] sftp.stat for remote package: err=${err ? err.message : 'none'}, exists=${fileExists}`);
                                                resolve(fileExists);
                                            });
                                        });
                                    };
                                    const remotePackageExists = await checkRemotePackageExists();
                                    if (!remotePackageExists) {
                                        logToFile?.('[DEBUG] Remote package does not exist. Uploading package...');
                                        const totalSize = fs.statSync(message.packagePath).size;
                                        const totalMB = totalSize / (1024 * 1024);
                                        logToFile?.(`[DEBUG] Uploading package: ${totalMB.toFixed(2)} MB to remote...`);
                                        await new Promise((resolve, reject) => {
                                            const readStream = fs.createReadStream(message.packagePath, { highWaterMark: 1024 * 1024 });
                                            const writeStream = sftp.createWriteStream(remotePackagePath, { highWaterMark: 1024 * 1024 });
                                            let bytesTransferred = 0;
                                            let lastLogged = Date.now();
                                            let lastPercentLogged = 0;
                                            readStream.on('data', (chunk: any) => {
                                                bytesTransferred += chunk.length;
                                                const now = Date.now();
                                                const percent = Math.floor((bytesTransferred / totalSize) * 100);
                                                // Log every 5% or every 5 seconds
                                                if (percent >= lastPercentLogged + 5 || now - lastLogged > 5000) {
                                                    logToFile?.(`[DEBUG] Upload progress: ${(bytesTransferred / (1024 * 1024)).toFixed(2)} MB / ${totalMB.toFixed(2)} MB (${percent}%) transferred...`);
                                                    lastPercentLogged = percent;
                                                    lastLogged = now;
                                                }
                                            });
                                            writeStream.on('error', (err: any) => {
                                                logToFile?.('WriteStream error during upload: ' + err.message);
                                                throw err;
                                            });
                                            writeStream.on('close', () => {
                                                logToFile?.(`[DEBUG] Upload finished. Total bytes transferred: ${bytesTransferred}`);
                                                logToFile?.('[DEBUG] Package upload completed.');
                                                resolve(true);
                                            });
                                            readStream.pipe(writeStream);
                                        });
                                    } else {
                                        logToFile?.('[DEBUG] Remote package already exists. Skipping upload.');
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
                                            logToFile?.(`[DEBUG] Running extraction command: ${extractCmd}`);
                                            await new Promise((resolve, reject) => {
                                                resources.conn!.exec(extractCmd, (err: Error | undefined, stream: any) => {
                                                    if (err) {
                                                        const detail = `Extraction failed to start: ${err?.message}`;
                                                        if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'error'; runItem.steps[0].substeps[1].detail = detail; scheduledRunsProvider.update(); }
                                                        logToFile?.(detail);
                                                        return reject(err);
                                                    }
                                                    let stdout = '';
                                                    let stderr = '';
                                                    stream.on('data', (data: Buffer) => {
                                                        stdout += data.toString();
                                                        logToFile?.('Extract stdout: ' + data.toString());
                                                    });
                                                    stream.stderr.on('data', (data: Buffer) => {
                                                        stderr += data.toString();
                                                        logToFile?.('Extract stderr: ' + data.toString());
                                                    });
                                                    stream.on('close', async (code: number) => {
                                                        if (code === 0) {
                                                            // After extraction, verify the directory exists
                                                            const extractedNowExists = await checkExtractedDirExists();
                                                            if (extractedNowExists) {
                                                                if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'success'; scheduledRunsProvider.update(); }
                                                                logToFile?.('Extraction completed and directory verified.');
                                                                resolve(true);
                                                            } else {
                                                                const detail = 'Extraction command completed but extracted directory not found.';
                                                                if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'error'; runItem.steps[0].substeps[1].detail = detail; scheduledRunsProvider.update(); }
                                                                logToFile?.(detail);
                                                                vscode.window.showErrorMessage(detail);
                                                                reject(new Error(detail));
                                                            }
                                                        } else {
                                                            const detail = `Extraction failed (code ${code}): ${stderr}`;
                                                            if (runItem.steps[0].substeps && runItem.steps[0].substeps[1]) { runItem.steps[0].substeps[1].status = 'error'; runItem.steps[0].substeps[1].detail = detail; scheduledRunsProvider.update(); }
                                                            logToFile?.(detail);
                                                            vscode.window.showErrorMessage(detail);
                                                            reject(new Error(detail));
                                                        }
                                                    });
                                                });
                                            });
                                        } else {
                                            logToFile?.('[DEBUG] No extraction command defined for this package type.');
                                        }
                                        // ... existing code ...

                            } catch (err) {
                                    logToFile?.(`[DEBUG] Upload or extraction failed: ${err instanceof Error ? err.message : err}`);
                                    logToFile?.(`Step 0.1 (Upload or extraction) failed: ${err instanceof Error ? err.message : err}`);
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
                            logToFile?.('Step 2: Run Virtual Client > Verify Virtual Client Tool');
                            
                            // Use the platform from the selected machine, not from the message
                            if (!platform) {
                                runItem.steps[1].status = 'error';
                                runItem.steps[1].detail = `Platform is not set for the selected machine.`;
                                logToFile?.(`Platform is not set for the selected machine.`);
                                scheduledRunsProvider.update();
                                throw new Error('Platform is not set for the selected machine.');
                            }
                            
                            let toolExecutable = '';
                            if (isWindows) {
                                toolExecutable = 'VirtualClient.exe';
                            } else if (platform.startsWith('linux')) {
                                toolExecutable = 'VirtualClient';
                            } else {
                                logToFile?.(`Unknown platform: ${platform}. Defaulting to VirtualClient.`);
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
                            logToFile?.(`[DEBUG] Tool path: ${toolPath}`);
                            let toolExists = false;
                            try {
                                await new Promise((resolve) => {
                                    sftp.stat(toolPath, (err: Error | undefined) => {
                                        toolExists = !err;
                                        if (toolExists) {
                                            logToFile?.(`[DEBUG] Tool exists: ${toolPath}`);
                                        }
                                        resolve(true);
                                    });
                                });
                            } catch (err) {
                                logToFile?.(`[DEBUG] Tool path validation error: ${err instanceof Error ? err.message : err}`);
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
                                    logToFile?.(`VirtualClient tool not found at path: ${toolPath}`);
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
                            // Run the command in the tool directory, capture PID
                            let command = '';
                            if (platform && isWindows) {
                                command = `"${toolPath}"${vcCmd}`;
                            } else {
                                command = `${shQuote(toolPath)}${vcCmd}`;
                            }
                            logToFile?.(`[DEBUG] Command to execute: ${command}`);
                            // Run the command in the remote target directory, capture PID
                            if (runItem.steps[1].substeps && runItem.steps[1].substeps[1]) {
                                runItem.steps[1].substeps[1].status = 'running';
                                scheduledRunsProvider.update();
                            }
                            logToFile?.('Step 2: Run Virtual Client > Execute Virtual Client Command');
                            await new Promise((resolve, reject) => {
                                if (runCancelFlags[runItem.label]) {
                                    if (runItem.steps[1].substeps && runItem.steps[1].substeps[1]) {
                                        runItem.steps[1].substeps[1].status = 'error';
                                        runItem.steps[1].substeps[1].detail = 'Run cancelled before execution.';
                                    }
                                    runItem.steps[1].status = 'error';
                                    runItem.steps[1].detail = 'Run cancelled before execution.';
                                    logToFile?.('Run cancelled before execution.');
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
                                        logToFile?.('Virtual Client execution error: ' + err.message);
                                        scheduledRunsProvider.update();
                                        return reject(err);
                                    }
                                    let stdout = '';
                                    let stderr = '';
                                    stream.on('data', (data: Buffer) => {
                                        const msg = data.toString();
                                        stdout += msg;
                                        logToFile?.('VC stdout: ' + msg);
                                    }).stderr.on('data', (data: Buffer) => {
                                        const msg = data.toString();
                                        stderr += msg;
                                        logToFile?.('VC stderr: ' + msg);
                                    });
                                    stream.on('close', (code: number, signal: string) => {
                                        if (runCancelFlags[runItem.label]) {
                                            if (runItem.steps[1].substeps && runItem.steps[1].substeps[1]) {
                                                runItem.steps[1].substeps[1].status = 'error';
                                                runItem.steps[1].substeps[1].detail = 'Run cancelled.';
                                            }
                                            runItem.steps[1].status = 'error';
                                            runItem.steps[1].detail = 'Run cancelled.';
                                            logToFile?.('Run cancelled during execution.');
                                            scheduledRunsProvider.update();
                                            return reject(new Error('Run cancelled'));
                                        }
                                        if (code === 0) {
                                            if (runItem.steps[1].substeps && runItem.steps[1].substeps[1]) {
                                                runItem.steps[1].substeps[1].status = 'success';
                                                scheduledRunsProvider.update();
                                            }
                                            logToFile?.('Step 2: Run Virtual Client completed');
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
                                            logToFile?.('Virtual Client execution failed: ' + stderr);
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
                                logToFile?.('[DEBUG] Starting Transfer Logs > Zip Logs Folder');
                                logToFile?.(`[DEBUG] Remote logs directory: ${remoteLogsDir}`);
                                logToFile?.(`[DEBUG] Remote zip path: ${remoteZipPath}`);
                                logToFile?.(`[DEBUG] Zip command: ${zipCmd}`);
                                logsStep.substeps![0].status = 'running'; scheduledRunsProvider.update();
                                await new Promise((resolve, reject) => {
                                    resources.conn!.exec(zipCmd, (err: Error | undefined, stream: any) => {
                                        if (err) {
                                            logToFile?.(`[DEBUG] Error starting zip command: ${err.message}`);
                                            return reject(err);
                                        }
                                        let stderr = '';
                                        let stdout = '';
                                        stream.on('data', (data: Buffer) => {
                                            stdout += data.toString();
                                            logToFile?.(`[DEBUG] Zip stdout: ${data.toString()}`);
                                        });
                                        stream.stderr.on('data', (data: Buffer) => {
                                            stderr += data.toString();
                                            logToFile?.(`[DEBUG] Zip stderr: ${data.toString()}`);
                                        });
                                        stream.on('close', (code: number) => {
                                            logToFile?.(`[DEBUG] Zip command exited with code ${code}`);
                                            if (code === 0) { resolve(true); }
                                            else {
                                                logToFile?.(`[DEBUG] Zip failed with stderr: ${stderr}`);
                                                reject(new Error(`Zip failed: ${stderr}`));
                                            }
                                        });
                                    });
                                });
                                logToFile?.('[DEBUG] Finished Transfer Logs > Zip Logs Folder');
                                logsStep.substeps![0].status = 'success'; scheduledRunsProvider.update();

                                // 2. Download logs.zip
                                logsStep.substeps![1].status = 'running'; scheduledRunsProvider.update();
                                const localLogsDir = path.join(context.globalStoragePath, 'logs', sanitizeLabel(runItem.label));
                                if (!fs.existsSync(localLogsDir)) { fs.mkdirSync(localLogsDir, { recursive: true }); }
                                const localZipPath = path.join(localLogsDir, 'logs.zip');
                                await sftpDownloadFile(sftp, remoteZipPath, localZipPath);
                                // Cleanup: delete logs.zip on remote
                                const cleanupZipCmd = `powershell -Command "Remove-Item -Path '${remoteZipPath.replace(/'/g, "''")}' -Force"`;
                                await new Promise((resolve, reject) => {
                                    resources.conn!.exec(cleanupZipCmd, (err: Error | undefined, stream: any) => {
                                        if (err) return resolve(true); // Don't fail the run if cleanup fails
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
                                function buildLogSteps(dir: string, parentStep: any, relPath: string): ScheduledRunStep[] {
                                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                                    const steps: ScheduledRunStep[] = [];
                                    for (const entry of entries) {
                                        if (entry.name === 'logs.zip') continue;
                                        const fullPath = path.join(dir, entry.name);
                                        const entryRelPath = relPath ? path.posix.join(relPath, entry.name) : entry.name;
                                        if (entry.isDirectory()) {
                                            const folderStep = new ScheduledRunStep(entry.name, 'success', undefined);
                                            (folderStep as any).parent = parentStep;
                                            (folderStep as any).runLabel = runItem.label;
                                            folderStep.substeps = buildLogSteps(fullPath, folderStep, entryRelPath);
                                            steps.push(folderStep);
                                        } else if (entry.isFile()) {
                                            const logStep = new ScheduledRunStep(`Log: ${entry.name}`, 'success', undefined);
                                            (logStep as any).parent = parentStep;
                                            (logStep as any).runLabel = runItem.label;
                                            (logStep as any).relativePath = entryRelPath;
                                            steps.push(logStep);
                                        }
                                    }
                                    return steps;
                                }
                                // Attach the log tree to the 'Extract Logs Locally' substep
                                if (logsStep.substeps && logsStep.substeps[2]) {
                                    logsStep.substeps[2].substeps = buildLogSteps(localLogsDir, logsStep.substeps[2], '');
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
                                logToFile?.('Step 3 (Transfer Logs) failed: ' + logsStep.detail);
                            }

                        } catch (error) {
                                progress.report({ message: 'Error occurred. See logs for details.' });
                                throw error;
                            } finally {
                                logToFile?.('Scheduled run finished.');
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
            if (logToFile && logStream) {
                logToFile?.('Failed to execute run: ' + (error instanceof Error ? error.stack || error.message : error));
                logStream?.end();
            }
            resources.cleanup();
        }
    });

    // Clean up resources when panel is closed
    resources.panel.onDidDispose(() => {
        resources.cleanup();
        if (globalResourceManager === resources) {
            globalResourceManager = undefined;
        }
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
        const run = scheduledRunsProvider.getRun(item.label);
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

async function handleShowLogFiles(context: vscode.ExtensionContext) {
    try {
        const logFiles = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.json'));
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
        debug: item.debug
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

    // Define the hierarchical steps array
    const steps = [
        new ScheduledRunStep('Setup Machine', 'pending', undefined, [
            new ScheduledRunStep('Create Remote Directory', 'pending'),
            new ScheduledRunStep('Upload Package', 'pending')
        ]),
        new ScheduledRunStep('Run Virtual Client', 'pending', undefined, [
            new ScheduledRunStep('Verify Virtual Client Tool', 'pending'),
            new ScheduledRunStep('Execute Virtual Client Command', 'pending')
        ])
    ];

    // Set the webview content with the last used parameters
    panel.webview.html = getRunVirtualClientWebviewContent(machineItems, lastParams, steps, panel.webview);

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(async (message: any) => {
        if (message.command === 'run') {
            // Save the parameters for future use
            await context.globalState.update('lastParameters', message);

            // Create a new run with the same parameters
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
                steps
            );

            // Save the run to disk
            saveScheduledRun(context, runItem);

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

// Helper to recursively create remote directories over SFTP
async function sftpMkdirRecursive(sftp: any, remotePath: string): Promise<void> {
    const pathParts = remotePath.split('/').filter(Boolean);
    let current = remotePath.startsWith('/') ? '/' : '';
    for (const part of pathParts) {
        current = current ? `${current.replace(/\/$/, '')}/${part}` : part;
        await new Promise((resolve, reject) => {
            sftp.mkdir(current, (err: any) => {
                if (err && err.code !== 4 && err.code !== 11) { // 4: Failure (may already exist), 11: Already exists
                    reject(err);
                } else {
                    resolve(true);
                }
            });
        });
    }
}

// Helper to download a file via SFTP
async function sftpDownloadFile(sftp: any, remotePath: string, localPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const readStream = sftp.createReadStream(remotePath);
        const writeStream = fs.createWriteStream(localPath);
        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('close', resolve);
        readStream.pipe(writeStream);
    });
}

// Helper to extract a zip file locally
async function extractZip(zipPath: string, extractTo: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const unzip = require('unzipper');
        fs.createReadStream(zipPath)
            .pipe(unzip.Extract({ path: extractTo }))
            .on('close', resolve)
            .on('error', reject);
    });
}