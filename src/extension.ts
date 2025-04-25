// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as ssh2 from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as os from 'os';
import { MachinesTreeViewProvider } from './machineManager';

class MachineItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly ip: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string
    ) {
        super(label, collapsibleState);
    }
}

class VirtualClientTreeViewProvider implements vscode.TreeDataProvider<MachineItem | ScheduledRunItem | ScheduledRunStep> {
    private _onDidChangeTreeData: vscode.EventEmitter<MachineItem | ScheduledRunItem | ScheduledRunStep | undefined | void> = new vscode.EventEmitter<MachineItem | ScheduledRunItem | ScheduledRunStep | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<MachineItem | ScheduledRunItem | ScheduledRunStep | undefined | void> = this._onDidChangeTreeData.event;

    private machines: MachineItem[] = [];
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    getTreeItem(element: MachineItem | ScheduledRunItem | ScheduledRunStep): vscode.TreeItem {
        if (element instanceof ScheduledRunItem || element instanceof ScheduledRunStep) {
            return scheduledRunsProvider.getTreeItem(element);
        }
        return element;
    }

    getChildren(element?: MachineItem | ScheduledRunItem | ScheduledRunStep): Promise<(MachineItem | ScheduledRunItem | ScheduledRunStep)[]> {
        if (!element) {
            // Only show Scheduled Runs node in Virtual Client view
            const scheduledRunsNode = new MachineItem('Scheduled Runs', '', vscode.TreeItemCollapsibleState.Collapsed, 'scheduledRunsRoot');
            return Promise.resolve([scheduledRunsNode]);
        }
        if (element instanceof MachineItem && element.contextValue === 'scheduledRunsRoot') {
            // Return scheduled runs as children
            return scheduledRunsProvider.getChildren() as Promise<ScheduledRunItem[]>;
        }
        if (element instanceof ScheduledRunItem) {
            return scheduledRunsProvider.getChildren(element) as Promise<ScheduledRunStep[]>;
        }
        return Promise.resolve([]);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

// Declare scheduledRunsProvider at the top level so it is in scope everywhere
let scheduledRunsProvider: ScheduledRunsProvider;

class ScheduledRunStep {
    constructor(
        public readonly label: string,
        public status: 'pending' | 'running' | 'success' | 'error',
        public detail?: string
    ) {}
}

// Update ScheduledRunItem to include a timestamp
class ScheduledRunItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly steps: ScheduledRunStep[],
        public readonly timestamp: Date,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(`${label} (${timestamp.toLocaleString()})`, collapsibleState);
        this.contextValue = 'scheduledRun';
    }
}

class ScheduledRunsProvider implements vscode.TreeDataProvider<ScheduledRunItem | ScheduledRunStep> {
    private _onDidChangeTreeData: vscode.EventEmitter<ScheduledRunItem | ScheduledRunStep | undefined | void> = new vscode.EventEmitter<ScheduledRunItem | ScheduledRunStep | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ScheduledRunItem | ScheduledRunStep | undefined | void> = this._onDidChangeTreeData.event;
    private runs: ScheduledRunItem[] = [];

    getTreeItem(element: ScheduledRunItem | ScheduledRunStep): vscode.TreeItem {
        if (element instanceof ScheduledRunItem) {
            return element;
        } else {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.description = element.status;
            item.iconPath = new vscode.ThemeIcon(
                element.status === 'success' ? 'check' :
                element.status === 'error' ? 'error' :
                element.status === 'running' ? 'loading~spin' : 'clock'
            );
            if (element.detail) { item.tooltip = element.detail; }
            return item;
        }
    }

    getChildren(element?: ScheduledRunItem | ScheduledRunStep): Promise<(ScheduledRunItem | ScheduledRunStep)[]> {
        if (!element) {
            return Promise.resolve(this.runs);
        }
        if (element instanceof ScheduledRunItem) {
            return Promise.resolve(element.steps);
        }
        return Promise.resolve([]);
    }

    // Update ScheduledRunsProvider.addRun to accept timestamp
    addRun(label: string, steps: ScheduledRunStep[]): ScheduledRunItem {
        const run = new ScheduledRunItem(label, steps, new Date(), vscode.TreeItemCollapsibleState.Expanded);
        this.runs.unshift(run);
        this._onDidChangeTreeData.fire();
        return run;
    }

    update(): void {
        this._onDidChangeTreeData.fire();
    }
}

// --- Persistent Run History and Detailed Run View ---

// 1. Persist run data in globalState
interface PersistentRun {
    id: string;
    label: string;
    steps: { label: string; status: string; detail?: string }[];
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

// 2. Add command to show run details in a webview
function showRunDetailsWebview(context: vscode.ExtensionContext, run: PersistentRun) {
    const panel = vscode.window.createWebviewPanel(
        'runDetails',
        `Run Details: ${run.label}`,
        vscode.ViewColumn.One,
        { enableScripts: true }
    );
    const stepsHtml = run.steps.map(step => `<li class="step-item ${step.status}">${step.label}: ${step.status}${step.detail ? ' - ' + step.detail : ''}</li>`).join('');
    const logsHtml = run.logs.map(line => `<div style="font-family:monospace;white-space:pre;">${line}</div>`).join('');
    panel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Run Details</title>
        <style>
            body { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
            ul#stepsList { padding-left: 1.2em; }
            .step-item { font-weight: 500; margin-bottom: 0.3em; }
            .step-item.success { color: #4EC9B0; }
            .step-item.error { color: #F44747; }
            .step-item.running { color: #569CD6; }
            .step-item.pending { color: #D7BA7D; }
            .log-section { margin-top: 1em; }
        </style>
    </head>
    <body>
        <h2>${run.label}</h2>
        <div>Started: ${new Date(run.started).toLocaleString()}</div>
        ${run.finished ? `<div>Finished: ${new Date(run.finished).toLocaleString()}</div>` : ''}
        <h3>Steps</h3>
        <ul id="stepsList">${stepsHtml}</ul>
        <div class="log-section">
            <h3>Logs</h3>
            <div>${logsHtml}</div>
        </div>
    </body>
    </html>
    `;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Register the webview command first
    let treeViewProvider: VirtualClientTreeViewProvider | undefined;
    context.subscriptions.push(
        vscode.commands.registerCommand('virtual-client-executor.addMachineWebview', () => {
            if (!treeViewProvider) {
                vscode.window.showErrorMessage('Tree view provider not initialized.');
                return;
            }
            const panel = vscode.window.createWebviewPanel(
                'addMachine',
                'Add New Machine',
                vscode.ViewColumn.One,
                { enableScripts: true }
            );
            panel.webview.html = getAddMachineWebviewContent();
            panel.webview.onDidReceiveMessage(
                async message => {
                    if (message.command === 'add') {
                        const { label, ip, username, password } = message;
                        vscode.window.showWarningMessage('Adding machines is only supported from the Machines view.');
                        panel.dispose();
                    } else if (message.command === 'cancel') {
                        panel.dispose();
                    }
                },
                undefined,
                context.subscriptions
            );
        })
    );

    // Disable telemetry by default
    const telemetryConfig = vscode.workspace.getConfiguration('telemetry');
    telemetryConfig.update('enableTelemetry', false, vscode.ConfigurationTarget.Global);

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "virtual-client-executor" is now active!');

    context.subscriptions.push(
        vscode.commands.registerCommand('virtual-client-executor.runVirtualClientWebview', async (machine: MachineItem) => {
            if (!machine || !machine.ip) {
                vscode.window.showErrorMessage('No machine selected.');
                return;
            }
            const username = await context.secrets.get(`machine:${machine.ip}:username`);
            const password = await context.secrets.get(`machine:${machine.ip}:password`);
            if (!username || !password) {
                vscode.window.showErrorMessage('Credentials not found for this machine.');
                return;
            }
            const lastParams = context.globalState.get<{packagePath: string, platform: string, toolArgs: string}>(`lastVCParams:${machine.ip}`);
            const panel = vscode.window.createWebviewPanel(
                'runVirtualClient',
                `Run Virtual Client on ${machine.label}`,
                vscode.ViewColumn.One,
                { enableScripts: true }
            );
            panel.webview.html = getRunVirtualClientWebviewContent(machine.label, machine.ip, lastParams, [
                { label: 'Create Remote Directory', status: 'pending' },
                { label: 'Transfer Package', status: 'pending' },
                { label: 'Extract Package', status: 'pending' },
                { label: 'Run Virtual Client', status: 'pending' }
            ]);
            // Helper to update webview with step status
            function updateWebviewSteps(steps: { label: string, status: string, detail?: string }[]) {
                panel.webview.postMessage({ command: 'updateSteps', steps });
            }
            let activeConn: ssh2.Client | null = null;
            let activeSftp: ssh2.SFTPWrapper | null = null;
            let activeReadStream: fs.ReadStream | null = null;
            // Fix WriteStream type error by using fs.WriteStream only
            let activeWriteStream: fs.WriteStream | null = null;
            panel.webview.onDidReceiveMessage(
                async message => {
                    if (message.command === 'run') {
                        const { packagePath, platform, toolArgs } = message;
                        await context.globalState.update(`lastVCParams:${machine.ip}`, {packagePath, platform, toolArgs});
                        const remoteDir = 'C:/VirtualClientExecutor';
                        const remoteZip = `${remoteDir}/${path.basename(packagePath)}`;
                        // Determine extraction folder and tool path based on package name and platform
                        const packageBaseName = path.basename(packagePath, path.extname(packagePath));
                        const remoteExtracted = `${remoteDir}/${packageBaseName}/content/${platform}`;
                        const toolPath = `${remoteExtracted}/VirtualClient.exe`;
                        const outputChannel = vscode.window.createOutputChannel(`VC on ${machine.label}`);
                        outputChannel.show(true);
                        outputChannel.appendLine(`# Connecting to ${machine.label} (${machine.ip}) as ${username}`);
                        const conn = new ssh2.Client();
                        activeConn = conn;
                        conn.on('ready', () => {
                            outputChannel.appendLine('SSH connection established. Creating remote directory...');
                            const steps = [
                                new ScheduledRunStep('Create Remote Directory', 'pending'),
                                new ScheduledRunStep('Transfer Package', 'pending'),
                                new ScheduledRunStep('Extract Package', 'pending'),
                                new ScheduledRunStep('Run Virtual Client', 'pending')
                            ];
                            const runItem = scheduledRunsProvider.addRun(`Run on ${machine.label} (${machine.ip})`, steps);
                            let webviewSteps = [
                                { label: 'Create Remote Directory', status: 'pending', detail: '' },
                                { label: 'Transfer Package', status: 'pending', detail: '' },
                                { label: 'Extract Package', status: 'pending', detail: '' },
                                { label: 'Run Virtual Client', status: 'pending', detail: '' }
                            ];
                            scheduledRunsProvider.update();
                            updateWebviewSteps(webviewSteps);
                            steps[0].status = 'running'; scheduledRunsProvider.update();
                            webviewSteps[0].status = 'running'; updateWebviewSteps(webviewSteps);
                            // Check for remote directory, package, and extraction
                            conn.exec(
                                `powershell -Command "if (!(Test-Path -Path '${remoteDir}')) { New-Item -ItemType Directory -Path '${remoteDir}' } ; ` +
                                `if (Test-Path -Path '${remoteZip}') { Write-Output 'PACKAGE_EXISTS' } else { Write-Output 'PACKAGE_NOT_EXISTS' } ; ` +
                                `if (Test-Path -Path '${remoteExtracted}/VirtualClient.exe') { Write-Output 'EXTRACTED_EXISTS' } else { Write-Output 'EXTRACTED_NOT_EXISTS' }"`,
                                (err: Error | undefined, stream) => {
                                    if (err) {
                                        outputChannel.appendLine(`Failed to create remote directory: ${err.message}`);
                                        steps[0].status = 'error'; scheduledRunsProvider.update();
                                        webviewSteps[0].status = 'error'; updateWebviewSteps(webviewSteps);
                                        conn.end();
                                        panel.dispose();
                                        return;
                                    }
                                    let dirCreateStdout = '';
                                    let dirCreateStderr = '';
                                    let didTimeout = false;
                                    const timeout = setTimeout(() => {
                                        didTimeout = true;
                                        outputChannel.appendLine('Directory creation timed out.');
                                        steps[0].status = 'error'; scheduledRunsProvider.update();
                                        webviewSteps[0].status = 'error'; updateWebviewSteps(webviewSteps);
                                        stream.close();
                                        conn.end();
                                        panel.dispose();
                                    }, 20000); // 20 seconds timeout

                                    stream.on('data', (data: Buffer) => {
                                        dirCreateStdout += data.toString();
                                    });
                                    stream.stderr.on('data', (data: Buffer) => {
                                        dirCreateStderr += data.toString();
                                    });
                                    stream.on('close', (code: number) => {
                                        clearTimeout(timeout);
                                        if (didTimeout) { return; }
                                        if (dirCreateStderr) {
                                            outputChannel.appendLine(`Directory creation stderr: ${dirCreateStderr}`);
                                        }
                                        if (code !== 0) {
                                            outputChannel.appendLine(`Directory creation failed with exit code ${code}.`);
                                            steps[0].status = 'error'; scheduledRunsProvider.update();
                                            webviewSteps[0].status = 'error'; updateWebviewSteps(webviewSteps);
                                            conn.end();
                                            panel.dispose();
                                            return;
                                        }
                                        outputChannel.appendLine('Remote directory ready. Checking for package and extraction...');
                                        steps[0].status = 'success'; scheduledRunsProvider.update();
                                        webviewSteps[0].status = 'success'; updateWebviewSteps(webviewSteps);
                                        const hasPackage = dirCreateStdout.includes('PACKAGE_EXISTS');
                                        const hasExtracted = dirCreateStdout.includes('EXTRACTED_EXISTS');
                                        if (hasPackage) {
                                            outputChannel.appendLine('Package already exists on remote.');
                                            steps[1].status = 'success'; scheduledRunsProvider.update();
                                            webviewSteps[1].status = 'success'; updateWebviewSteps(webviewSteps);
                                            if (hasExtracted) {
                                                outputChannel.appendLine('Extraction already exists. Skipping extraction.');
                                                steps[2].status = 'success'; scheduledRunsProvider.update();
                                                webviewSteps[2].status = 'success'; updateWebviewSteps(webviewSteps);
                                                steps[3].status = 'running'; scheduledRunsProvider.update();
                                                webviewSteps[3].status = 'running'; updateWebviewSteps(webviewSteps);
                                                // Use toolPath and remoteExtracted in all relevant SSH commands and logs
                                                outputChannel.appendLine(`Tool path: ${toolPath}`);
                                                outputChannel.appendLine(`Command: ${toolPath} ${toolArgs}`);
                                                let executionOutput = '';
                                                conn.exec(`${toolPath} ${toolArgs}`,
                                                    (err: Error | undefined, stream) => {
                                                        if (err) {
                                                            outputChannel.appendLine(`Execution error: ${err.message}`);
                                                            steps[3].status = 'error'; scheduledRunsProvider.update();
                                                            webviewSteps[3].status = 'error'; updateWebviewSteps(webviewSteps);
                                                            conn.end();
                                                            panel.dispose();
                                                            return;
                                                        }
                                                        stream.on('data', (data: Buffer) => {
                                                            outputChannel.appendLine(`[VC Output] ${data.toString()}`);
                                                            steps[3].detail = (steps[3].detail || '') + data.toString();
                                                            executionOutput += data.toString();
                                                            scheduledRunsProvider.update();
                                                            updateWebviewSteps(webviewSteps);
                                                        });
                                                        stream.stderr.on('data', (data: Buffer) => {
                                                            outputChannel.appendLine(`[VC Error] ${data.toString()}`);
                                                            steps[3].detail = (steps[3].detail || '') + data.toString();
                                                            executionOutput += data.toString();
                                                            scheduledRunsProvider.update();
                                                            updateWebviewSteps(webviewSteps);
                                                        });
                                                        stream.on('close', () => {
                                                            outputChannel.appendLine('Virtual Client execution finished.');
                                                            steps[3].status = 'success'; scheduledRunsProvider.update();
                                                            webviewSteps[3].status = 'success'; updateWebviewSteps(webviewSteps);
                                                            // Save the execution output log in Scheduled Runs
                                                            steps[3].detail = (steps[3].detail || '') + '\n[Execution Output]\n' + executionOutput;
                                                            scheduledRunsProvider.update();
                                                            updateWebviewSteps(webviewSteps);
                                                            // Fetch logs from remote logs directory
                                                            const remoteLogsDir = `${remoteExtracted}/logs`;
                                                            conn.sftp((err: Error | undefined, sftp) => {
                                                                if (err) {
                                                                    outputChannel.appendLine(`SFTP error while fetching logs: ${err.message}`);
                                                                    conn.end();
                                                                    panel.dispose();
                                                                    return;
                                                                }
                                                                sftp.readdir(remoteLogsDir, (err: Error | undefined, list: any[]) => {
                                                                    if (err) {
                                                                        outputChannel.appendLine(`Failed to read logs directory: ${err.message}`);
                                                                        conn.end();
                                                                        panel.dispose();
                                                                        return;
                                                                    }
                                                                    if (!list.length) {
                                                                        outputChannel.appendLine('No log files found in logs directory.');
                                                                        conn.end();
                                                                        panel.dispose();
                                                                        return;
                                                                    }
                                                                    let logsFetched = 0;
                                                                    list.forEach((file: any) => {
                                                                        const remoteLogPath = `${remoteLogsDir}/${file.filename}`;
                                                                        sftp.readFile(remoteLogPath, (err: Error | undefined, data: Buffer) => {
                                                                            logsFetched++;
                                                                            if (err) {
                                                                                outputChannel.appendLine(`Failed to read log file ${file.filename}: ${err.message}`);
                                                                            } else {
                                                                                const logContent = data.toString();
                                                                                outputChannel.appendLine(`[Log: ${file.filename}]\n${logContent}`);
                                                                                steps[3].detail = (steps[3].detail || '') + `\n[Log: ${file.filename}]\n${logContent}`;
                                                                                scheduledRunsProvider.update();
                                                                                updateWebviewSteps(webviewSteps);
                                                                            }
                                                                            if (logsFetched === list.length) {
                                                                                conn.end();
                                                                                panel.dispose();
                                                                            }
                                                                        });
                                                                    });
                                                                });
                                                            });
                                                        });
                                                    }
                                                );
                                                return;
                                            } else {
                                                outputChannel.appendLine('Extraction not found. Extracting package...');
                                                steps[2].status = 'running'; scheduledRunsProvider.update();
                                                webviewSteps[2].status = 'running'; updateWebviewSteps(webviewSteps);
                                                // Update extraction command to use the correct destination
                                                conn.exec(`powershell -Command \"Expand-Archive -Path '${remoteZip}' -DestinationPath '${remoteDir}/${packageBaseName}' -Force\"`, (err: Error | undefined, stream) => {
                                                    if (err) {
                                                        outputChannel.appendLine(`Extraction error: ${err.message}`);
                                                        steps[2].status = 'error'; scheduledRunsProvider.update();
                                                        webviewSteps[2].status = 'error'; updateWebviewSteps(webviewSteps);
                                                        conn.end();
                                                        panel.dispose();
                                                        return;
                                                    }
                                                    let extractionStdout = '';
                                                    let extractionStderr = '';
                                                    stream.on('data', (data: Buffer) => {
                                                        extractionStdout += data.toString();
                                                        outputChannel.appendLine(`[Extract stdout] ${data.toString()}`);
                                                        steps[2].detail = (steps[2].detail || '') + data.toString();
                                                        scheduledRunsProvider.update();
                                                        updateWebviewSteps(webviewSteps);
                                                    });
                                                    stream.stderr.on('data', (data: Buffer) => {
                                                        extractionStderr += data.toString();
                                                        outputChannel.appendLine(`[Extract stderr] ${data.toString()}`);
                                                        steps[2].detail = (steps[2].detail || '') + data.toString();
                                                        scheduledRunsProvider.update();
                                                        updateWebviewSteps(webviewSteps);
                                                    });
                                                    stream.on('close', (code: number) => {
                                                        if (extractionStderr) {
                                                            outputChannel.appendLine(`Extraction failed: ${extractionStderr}`);
                                                            steps[2].status = 'error'; scheduledRunsProvider.update();
                                                            webviewSteps[2].status = 'error'; updateWebviewSteps(webviewSteps);
                                                            conn.end();
                                                            panel.dispose();
                                                            return;
                                                        }
                                                        outputChannel.appendLine(`Extraction complete (exit code ${code}).`);
                                                        steps[2].status = 'success'; scheduledRunsProvider.update();
                                                        webviewSteps[2].status = 'success'; updateWebviewSteps(webviewSteps);
                                                        steps[3].status = 'running'; scheduledRunsProvider.update();
                                                        webviewSteps[3].status = 'running'; updateWebviewSteps(webviewSteps);
                                                        // Use toolPath and remoteExtracted in all relevant SSH commands and logs
                                                        outputChannel.appendLine(`Tool path: ${toolPath}`);
                                                        outputChannel.appendLine(`Command: ${toolPath} ${toolArgs}`);
                                                        let executionOutput = '';
                                                        conn.exec(`${toolPath} ${toolArgs}`,
                                                            (err: Error | undefined, stream) => {
                                                                if (err) {
                                                                    outputChannel.appendLine(`Execution error: ${err.message}`);
                                                                    steps[3].status = 'error'; scheduledRunsProvider.update();
                                                                    webviewSteps[3].status = 'error'; updateWebviewSteps(webviewSteps);
                                                                    conn.end();
                                                                    panel.dispose();
                                                                    return;
                                                                }
                                                                stream.on('data', (data: Buffer) => {
                                                                    outputChannel.appendLine(`[VC Output] ${data.toString()}`);
                                                                    steps[3].detail = (steps[3].detail || '') + data.toString();
                                                                    executionOutput += data.toString();
                                                                    scheduledRunsProvider.update();
                                                                    updateWebviewSteps(webviewSteps);
                                                                });
                                                                stream.stderr.on('data', (data: Buffer) => {
                                                                    outputChannel.appendLine(`[VC Error] ${data.toString()}`);
                                                                    steps[3].detail = (steps[3].detail || '') + data.toString();
                                                                    executionOutput += data.toString();
                                                                    scheduledRunsProvider.update();
                                                                    updateWebviewSteps(webviewSteps);
                                                                });
                                                                stream.on('close', () => {
                                                                    outputChannel.appendLine('Virtual Client execution finished.');
                                                                    steps[3].status = 'success'; scheduledRunsProvider.update();
                                                                    webviewSteps[3].status = 'success'; updateWebviewSteps(webviewSteps);
                                                                    // Save the execution output log in Scheduled Runs
                                                                    steps[3].detail = (steps[3].detail || '') + '\n[Execution Output]\n' + executionOutput;
                                                                    scheduledRunsProvider.update();
                                                                    updateWebviewSteps(webviewSteps);
                                                                    // Fetch logs from remote logs directory
                                                                    const remoteLogsDir = `${remoteExtracted}/logs`;
                                                                    conn.sftp((err: Error | undefined, sftp) => {
                                                                        if (err) {
                                                                            outputChannel.appendLine(`SFTP error while fetching logs: ${err.message}`);
                                                                            conn.end();
                                                                            panel.dispose();
                                                                            return;
                                                                        }
                                                                        sftp.readdir(remoteLogsDir, (err: Error | undefined, list: any[]) => {
                                                                            if (err) {
                                                                                outputChannel.appendLine(`Failed to read logs directory: ${err.message}`);
                                                                                conn.end();
                                                                                panel.dispose();
                                                                                return;
                                                                            }
                                                                            if (!list.length) {
                                                                                outputChannel.appendLine('No log files found in logs directory.');
                                                                                conn.end();
                                                                                panel.dispose();
                                                                                return;
                                                                            }
                                                                            let logsFetched = 0;
                                                                            list.forEach((file: any) => {
                                                                                const remoteLogPath = `${remoteLogsDir}/${file.filename}`;
                                                                                sftp.readFile(remoteLogPath, (err: Error | undefined, data: Buffer) => {
                                                                                    logsFetched++;
                                                                                    if (err) {
                                                                                        outputChannel.appendLine(`Failed to read log file ${file.filename}: ${err.message}`);
                                                                                    } else {
                                                                                        const logContent = data.toString();
                                                                                        outputChannel.appendLine(`[Log: ${file.filename}]\n${logContent}`);
                                                                                        steps[3].detail = (steps[3].detail || '') + `\n[Log: ${file.filename}]\n${logContent}`;
                                                                                        scheduledRunsProvider.update();
                                                                                        updateWebviewSteps(webviewSteps);
                                                                                    }
                                                                                    if (logsFetched === list.length) {
                                                                                        conn.end();
                                                                                        panel.dispose();
                                                                                    }
                                                                                });
                                                                            });
                                                                        });
                                                                    });
                                                                });
                                                            }
                                                        );
                                                    });
                                                });
                                                return;
                                            }
                                        }
                                        // If package does not exist, continue with transfer logic (existing code)
                                        outputChannel.appendLine('Package not found on remote. Starting transfer...');
                                        steps[1].status = 'running'; scheduledRunsProvider.update();
                                        webviewSteps[1].status = 'running'; updateWebviewSteps(webviewSteps);
                                        // Remove pscp logic, always use SFTP for file transfer
                                        conn.sftp((err: Error | undefined, sftp) => {
                                            if (err) {
                                                outputChannel.appendLine(`SFTP error: ${err.message}`);
                                                steps[1].status = 'error'; scheduledRunsProvider.update();
                                                webviewSteps[1].status = 'error'; updateWebviewSteps(webviewSteps);
                                                conn.end();
                                                panel.dispose();
                                                return;
                                            }
                                            activeSftp = sftp;
                                            const readStream = fs.createReadStream(packagePath);
                                            activeReadStream = readStream;
                                            const totalSize = fs.statSync(packagePath).size;
                                            let transferred = 0;
                                            readStream.on('data', (chunk) => {
                                                let chunkLength = 0;
                                                if (typeof chunk === 'string') {
                                                    chunkLength = Buffer.byteLength(chunk);
                                                } else if (Buffer.isBuffer(chunk)) {
                                                    chunkLength = chunk.length;
                                                }
                                                transferred += chunkLength;
                                                const percent = ((transferred / totalSize) * 100).toFixed(2);
                                                outputChannel.appendLine(`SFTP: Transferred ${transferred} of ${totalSize} bytes (${percent}%)`);
                                                steps[1].detail = `Transferred ${percent}% (${transferred}/${totalSize} bytes)`;
                                                webviewSteps[1].detail = `Transferred ${percent}% (${transferred}/${totalSize} bytes)`;
                                                scheduledRunsProvider.update();
                                                updateWebviewSteps(webviewSteps);
                                            });
                                            outputChannel.appendLine(`SFTP: Starting upload of ${packagePath} to ${remoteZip}`);
                                            readStream.on('error', (err: Error) => {
                                                outputChannel.appendLine(`SFTP: Local file read error: ${err.message}`);
                                            });
                                            const writeStream = sftp.createWriteStream(remoteZip.replace(/\\/g, '/'));
                                            activeWriteStream = writeStream as any;
                                            writeStream.on('open', () => {
                                                outputChannel.appendLine('SFTP: Remote file opened for writing.');
                                            });
                                            writeStream.on('finish', () => {
                                                outputChannel.appendLine('SFTP: File upload finished.');
                                            });
                                            writeStream.on('close', () => {
                                                outputChannel.appendLine('SFTP: Write stream closed.');
                                                activeReadStream = null;
                                                activeWriteStream = null;
                                                steps[1].detail = 'Transfer complete';
                                                webviewSteps[1].detail = 'Transfer complete';
                                                outputChannel.appendLine('Package transferred. Extracting on remote...');
                                                steps[1].status = 'success'; scheduledRunsProvider.update();
                                                webviewSteps[1].status = 'success'; updateWebviewSteps(webviewSteps);
                                                steps[2].status = 'running'; scheduledRunsProvider.update();
                                                webviewSteps[2].status = 'running'; updateWebviewSteps(webviewSteps);
                                                // Update extraction command to use the correct destination
                                                conn.exec(`powershell -Command \"Expand-Archive -Path '${remoteZip}' -DestinationPath '${remoteDir}/${packageBaseName}' -Force\"`, (err: Error | undefined, stream) => {
                                                    if (err) {
                                                        outputChannel.appendLine(`Extraction error: ${err.message}`);
                                                        steps[2].status = 'error'; scheduledRunsProvider.update();
                                                        webviewSteps[2].status = 'error'; updateWebviewSteps(webviewSteps);
                                                        conn.end();
                                                        panel.dispose();
                                                        return;
                                                    }
                                                    let extractionStdout = '';
                                                    let extractionStderr = '';
                                                    stream.on('data', (data: Buffer) => {
                                                        extractionStdout += data.toString();
                                                        outputChannel.appendLine(`[Extract stdout] ${data.toString()}`);
                                                        steps[2].detail = (steps[2].detail || '') + data.toString();
                                                        scheduledRunsProvider.update();
                                                        updateWebviewSteps(webviewSteps);
                                                    });
                                                    stream.stderr.on('data', (data: Buffer) => {
                                                        extractionStderr += data.toString();
                                                        outputChannel.appendLine(`[Extract stderr] ${data.toString()}`);
                                                        steps[2].detail = (steps[2].detail || '') + data.toString();
                                                        scheduledRunsProvider.update();
                                                        updateWebviewSteps(webviewSteps);
                                                    });
                                                    stream.on('close', (code: number) => {
                                                        if (extractionStderr) {
                                                            outputChannel.appendLine(`Extraction failed: ${extractionStderr}`);
                                                            steps[2].status = 'error'; scheduledRunsProvider.update();
                                                            webviewSteps[2].status = 'error'; updateWebviewSteps(webviewSteps);
                                                            conn.end();
                                                            panel.dispose();
                                                            return;
                                                        }
                                                        outputChannel.appendLine(`Extraction complete (exit code ${code}).`);
                                                        steps[2].status = 'success'; scheduledRunsProvider.update();
                                                        webviewSteps[2].status = 'success'; updateWebviewSteps(webviewSteps);
                                                        steps[3].status = 'running'; scheduledRunsProvider.update();
                                                        webviewSteps[3].status = 'running'; updateWebviewSteps(webviewSteps);
                                                        // Use toolPath and remoteExtracted in all relevant SSH commands and logs
                                                        outputChannel.appendLine(`Tool path: ${toolPath}`);
                                                        outputChannel.appendLine(`Command: ${toolPath} ${toolArgs}`);
                                                        let executionOutput = '';
                                                        conn.exec(`${toolPath} ${toolArgs}`, (err: Error | undefined, stream) => {
                                                            if (err) {
                                                                outputChannel.appendLine(`Execution error: ${err.message}`);
                                                                steps[3].status = 'error'; scheduledRunsProvider.update();
                                                                webviewSteps[3].status = 'error'; updateWebviewSteps(webviewSteps);
                                                                conn.end();
                                                                panel.dispose();
                                                                return;
                                                            }
                                                            stream.on('data', (data: Buffer) => {
                                                                outputChannel.appendLine(`[VC Output] ${data.toString()}`);
                                                                steps[3].detail = (steps[3].detail || '') + data.toString();
                                                                executionOutput += data.toString();
                                                                scheduledRunsProvider.update();
                                                                updateWebviewSteps(webviewSteps);
                                                            });
                                                            stream.stderr.on('data', (data: Buffer) => {
                                                                outputChannel.appendLine(`[VC Error] ${data.toString()}`);
                                                                steps[3].detail = (steps[3].detail || '') + data.toString();
                                                                executionOutput += data.toString();
                                                                scheduledRunsProvider.update();
                                                                updateWebviewSteps(webviewSteps);
                                                            });
                                                            stream.on('close', () => {
                                                                outputChannel.appendLine('Virtual Client execution finished.');
                                                                steps[3].status = 'success'; scheduledRunsProvider.update();
                                                                webviewSteps[3].status = 'success'; updateWebviewSteps(webviewSteps);
                                                                // Save the execution output log in Scheduled Runs
                                                                steps[3].detail = (steps[3].detail || '') + '\n[Execution Output]\n' + executionOutput;
                                                                scheduledRunsProvider.update();
                                                                updateWebviewSteps(webviewSteps);
                                                                // Fetch logs from remote logs directory
                                                                const remoteLogsDir = `${remoteExtracted}/logs`;
                                                                conn.sftp((err: Error | undefined, sftp) => {
                                                                    if (err) {
                                                                        outputChannel.appendLine(`SFTP error while fetching logs: ${err.message}`);
                                                                        conn.end();
                                                                        panel.dispose();
                                                                        return;
                                                                    }
                                                                    sftp.readdir(remoteLogsDir, (err: Error | undefined, list: any[]) => {
                                                                        if (err) {
                                                                            outputChannel.appendLine(`Failed to read logs directory: ${err.message}`);
                                                                            conn.end();
                                                                            panel.dispose();
                                                                            return;
                                                                        }
                                                                        if (!list.length) {
                                                                            outputChannel.appendLine('No log files found in logs directory.');
                                                                            conn.end();
                                                                            panel.dispose();
                                                                            return;
                                                                        }
                                                                        let logsFetched = 0;
                                                                        list.forEach((file: any) => {
                                                                            const remoteLogPath = `${remoteLogsDir}/${file.filename}`;
                                                                            sftp.readFile(remoteLogPath, (err: Error | undefined, data: Buffer) => {
                                                                                logsFetched++;
                                                                                if (err) {
                                                                                    outputChannel.appendLine(`Failed to read log file ${file.filename}: ${err.message}`);
                                                                                } else {
                                                                                    const logContent = data.toString();
                                                                                    outputChannel.appendLine(`[Log: ${file.filename}]\n${logContent}`);
                                                                                    steps[3].detail = (steps[3].detail || '') + `\n[Log: ${file.filename}]\n${logContent}`;
                                                                                    scheduledRunsProvider.update();
                                                                                    updateWebviewSteps(webviewSteps);
                                                                                }
                                                                                if (logsFetched === list.length) {
                                                                                    conn.end();
                                                                                    panel.dispose();
                                                                                }
                                                                            });
                                                                        });
                                                                    });
                                                                });
                                                            });
                                                        });
                                                    });
                                                });
                                            });
                                            writeStream.on('error', (err: Error) => {
                                                outputChannel.appendLine(`SFTP: Remote file write error: ${err.message}`);
                                                activeReadStream = null;
                                                activeWriteStream = null;
                                                steps[1].status = 'error'; scheduledRunsProvider.update();
                                                webviewSteps[1].status = 'error'; updateWebviewSteps(webviewSteps);
                                                conn.end();
                                                panel.dispose();
                                            });
                                            readStream.pipe(writeStream);
                                        });
                                    });
                                }
                            );
                        }).on('error', (err: Error) => {
                            outputChannel.appendLine(`SSH connection error: ${err.message}`);
                        }).connect({
                            host: machine.ip,
                            port: 22,
                            username,
                            password
                        });
                    } else if (message.command === 'cancel') {
                        // Clean up SFTP/SSH resources on cancel
                        if (activeReadStream) {
                            try { activeReadStream.destroy(); } catch {}
                            activeReadStream = null;
                        }
                        if (activeWriteStream) {
                            try { activeWriteStream.destroy(); } catch {}
                            activeWriteStream = null;
                        }
                        if (activeSftp) {
                            try { activeSftp.end(); } catch {}
                            activeSftp = null;
                        }
                        if (activeConn) {
                            try { activeConn.end(); } catch {}
                            activeConn = null;
                        }
                        panel.dispose();
                    }
                },
                undefined,
                context.subscriptions
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('virtual-client-executor.streamLogs', async () => {
            const platform = await vscode.window.showQuickPick(['win-x64', 'win-arm64'], { placeHolder: 'Select the platform' });

            if (!platform) {
                vscode.window.showErrorMessage('Platform selection is required.');
                return;
            }

            const remotePath = `/tmp/virtualclient/content/${platform}/logs`;
            const connection = new ssh2.Client();

            connection.on('ready', () => {
                connection.sftp((err: Error | undefined, sftp: ssh2.SFTPWrapper) => {
                    if (err) {
                        vscode.window.showErrorMessage(`SFTP error: ${err.message}`);
                        connection.end();
                        return;
                    }

                    sftp.readdir(remotePath, (err: Error | undefined, list: ssh2.FileEntry[]) => {
                        if (err) {
                            vscode.window.showErrorMessage(`Failed to read logs directory: ${err.message}`);
                            connection.end();
                            return;
                        }

                        list.forEach((file: ssh2.FileEntry) => {
                            const filePath = `${remotePath}/${file.filename}`;
                            const localPath = vscode.Uri.file(`${vscode.workspace.rootPath}/logs/${file.filename}`);

                            const readStream = sftp.createReadStream(filePath);
                            const writeStream = fs.createWriteStream(localPath.fsPath);

                            writeStream.on('close', () => {
                                vscode.window.showInformationMessage(`Log file downloaded: ${file.filename}`);
                            });

                            readStream.pipe(writeStream);
                        });

                        connection.end();
                    });
                });
            }).on('error', (err: Error) => {
                vscode.window.showErrorMessage(`Connection error: ${err.message}`);
            }).connect({
                host: '<REMOTE_IP>', // Replace with actual IP or prompt user
                port: 22,
                username: '<USERNAME>', // Replace with actual username or prompt user
                password: '<PASSWORD>' // Replace with actual password or prompt user
            });
        })
    );

    // Register command to show run details
    context.subscriptions.push(
        vscode.commands.registerCommand('virtual-client-executor.showRunDetails', (runItem: ScheduledRunItem) => {
            const persistentRuns = getPersistentRuns(context);
            const found = persistentRuns.find(r => r.id === runItem.label);
            if (found) {
                showRunDetailsWebview(context, found);
            } else {
                vscode.window.showWarningMessage('Run details not found.');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('virtual-client-executor.showLogFiles', async () => {
            // Prompt user for log type
            const logType = await vscode.window.showQuickPick([
                { label: 'Traces', ext: '.traces' },
                { label: 'Metrics', ext: '.metrics' },
                { label: 'Events', ext: '.events' }
            ], { placeHolder: 'Select log type to view' });
            if (!logType) { return; }
            // Find log files in logs directory
            const logsDir = path.join(vscode.workspace.rootPath || '', 'logs');
            if (!fs.existsSync(logsDir)) {
                vscode.window.showWarningMessage('Logs directory not found.');
                return;
            }
            const files = fs.readdirSync(logsDir).filter(f => f.endsWith(logType.ext));
            if (files.length === 0) {
                vscode.window.showInformationMessage(`No ${logType.label.toLowerCase()} files found.`);
                return;
            }
            // Prompt user to select a file
            const filePick = await vscode.window.showQuickPick(files, { placeHolder: `Select a ${logType.label.toLowerCase()} file` });
            if (!filePick) { return; }
            const filePath = path.join(logsDir, filePick);
            // Read and show JSON content in a webview
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const json = JSON.parse(content);
                const panel = vscode.window.createWebviewPanel(
                    'logFileView',
                    `${logType.label} Log: ${filePick}`,
                    vscode.ViewColumn.One,
                    { enableScripts: false }
                );
                panel.webview.html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>${logType.label} Log</title>
                    <style>
                        body { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
                        pre { font-family: monospace; font-size: 13px; white-space: pre-wrap; word-break: break-all; }
                    </style>
                </head>
                <body>
                    <h2>${logType.label} Log: ${filePick}</h2>
                    <pre>${JSON.stringify(json, null, 2)}</pre>
                </body>
                </html>
                `;
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to read or parse log file: ${err}`);
            }
        })
    );

    // Register the tree view provider
    treeViewProvider = new VirtualClientTreeViewProvider(context);
    vscode.window.registerTreeDataProvider('virtualClientView', treeViewProvider);

    // Register scheduled runs provider
    scheduledRunsProvider = new ScheduledRunsProvider();

    // Register the Machines treeview and add + command in extension activation
    let machinesTreeViewProvider: MachinesTreeViewProvider;
    machinesTreeViewProvider = new MachinesTreeViewProvider(context);
    vscode.window.registerTreeDataProvider('machinesView', machinesTreeViewProvider);
    context.subscriptions.push(
        vscode.commands.registerCommand('machines.addMachine', async () => {
            const panel = vscode.window.createWebviewPanel(
                'addMachine',
                'Add Machine',
                vscode.ViewColumn.One,
                { enableScripts: true }
            );
            panel.webview.html = getAddMachineWebviewContent();
            panel.webview.onDidReceiveMessage(
                async message => {
                    if (message.command === 'add') {
                        const { label, ip } = message;
                        machinesTreeViewProvider.addMachine(label, ip);
                        panel.dispose();
                    } else if (message.command === 'cancel') {
                        panel.dispose();
                    }
                },
                undefined,
                context.subscriptions
            );
        })
    );
}

// This method is called when your extension is deactivated
export function deactivate() {
    console.log('Extension "Virtual Client Executor" is now deactivated!');
}

function getAddMachineWebviewContent(): string {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Add New Machine</title>
    </head>
    <body>
        <h2>Add New Machine</h2>
        <form id="machineForm">
            <label for="label">Machine Name:</label><br>
            <input type="text" id="label" name="label" required><br><br>
            <label for="ip">IP Address:</label><br>
            <input type="text" id="ip" name="ip" required><br><br>
            <label for="username">Username:</label><br>
            <input type="text" id="username" name="username" required><br><br>
            <label for="password">Password:</label><br>
            <input type="password" id="password" name="password" required><br><br>
            <button type="submit">Add Machine</button>
            <button type="button" id="cancelBtn">Cancel</button>
        </form>
        <script>
            const vscode = acquireVsCodeApi();
            document.getElementById('machineForm').addEventListener('submit', (e) => {
                e.preventDefault();
                vscode.postMessage({
                    command: 'add',
                    label: document.getElementById('label').value,
                    ip: document.getElementById('ip').value,
                    username: document.getElementById('username').value,
                    password: document.getElementById('password').value
                });
            });
            document.getElementById('cancelBtn').addEventListener('click', () => {
                vscode.postMessage({ command: 'cancel' });
            });
        </script>
    </body>
    </html>
    `;
}

function getRunVirtualClientWebviewContent(label: string, ip: string, lastParams?: {packagePath: string, platform: string, toolArgs: string}, steps?: { label: string, status: string, detail?: string }[]): string {
    const stepsHtml = (steps ?? []).map(step => `<li class="step-item ${step.status}">${step.label}: ${step.status}${step.detail ? ' - ' + step.detail : ''}</li>`).join('');
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Run Virtual Client</title>
        <style>
            body { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
            ul#stepsList { padding-left: 1.2em; }
            .step-item { font-weight: 500; margin-bottom: 0.3em; }
            .step-item.success { color: #4EC9B0; }
            .step-item.error { color: #F44747; }
            .step-item.running { color: #569CD6; }
            .step-item.pending { color: #D7BA7D; }
            .parameter-section { margin-bottom: 20px; border: 1px solid var(--vscode-panel-border); padding: 10px; border-radius: 5px; }
            .parameter-section h3 { margin-top: 0; }
            .parameter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .parameter-item { margin-bottom: 10px; }
            label { display: block; margin-bottom: 5px; }
            .checkbox-label { display: inline-flex; align-items: center; }
        </style>
    </head>
    <body>
        <h2>Run Virtual Client on ${label} (${ip})</h2>
        <form id="runForm">
            <div class="parameter-section">
                <h3>Basic Settings</h3>
                <label for="packagePath">Virtual Client Package Path:</label>
                <input type="text" id="packagePath" name="packagePath" value="${lastParams?.packagePath ?? ''}" required><br><br>
                <label for="platform">Platform:</label>
                <select id="platform" name="platform" required>
                    <option value="win-x64" ${lastParams?.platform === 'win-x64' ? 'selected' : ''}>win-x64</option>
                    <option value="win-arm64" ${lastParams?.platform === 'win-arm64' ? 'selected' : ''}>win-arm64</option>
                    <option value="linux-x64" ${lastParams?.platform === 'linux-x64' ? 'selected' : ''}>linux-x64</option>
                    <option value="linux-arm64" ${lastParams?.platform === 'linux-arm64' ? 'selected' : ''}>linux-arm64</option>
                </select>
            </div>
            <div class="parameter-section">
                <h3>Command Line Options</h3>
                <div class="parameter-grid">
                    <div class="parameter-item">
                        <label for="profile">Profile:</label>
                        <input type="text" id="profile" name="profile" placeholder="e.g., PERF-CPU-OPENSSL.json">
                    </div>
                    <div class="parameter-item">
                        <label for="system">System:</label>
                        <input type="text" id="system" name="system" placeholder="e.g., Demo">
                    </div>
                    <div class="parameter-item">
                        <label for="timeout">Timeout (minutes):</label>
                        <input type="number" id="timeout" name="timeout" placeholder="e.g., 180" min="1">
                    </div>
                    <div class="parameter-item">
                        <label for="clientId">Client ID:</label>
                        <input type="text" id="clientId" name="clientId" placeholder="Unique client identifier">
                    </div>
                </div>
                <div class="parameter-item">
                    <label for="metadata">Metadata:</label>
                    <input type="text" id="metadata" name="metadata" placeholder="e.g., property1=value1,,,property2=value2" style="width: 95%;">
                </div>
                <div class="parameter-item">
                    <label for="parameters">Parameters:</label>
                    <input type="text" id="parameters" name="parameters" placeholder="e.g., property1=value1,,,property2=value2" style="width: 95%;">
                </div>
                <div class="parameter-item">
                    <label for="proxyApi">Proxy API:</label>
                    <input type="text" id="proxyApi" name="proxyApi" placeholder="e.g., http://localhost:4501">
                </div>
                <div class="parameter-item">
                    <label for="clean">Clean:</label>
                    <input type="text" id="clean" name="clean" placeholder="all | logs | packages | state | logs,packages (leave blank for full reset)">
                    <label class="checkbox-label" style="margin-top:5px;">
                        <input type="checkbox" id="cleanFlag" name="cleanFlag">
                        <span style="margin-left: 5px;">Full Clean (reset all state)</span>
                    </label>
                </div>
                <div class="parameter-item">
                    <label class="checkbox-label">
                        <input type="checkbox" id="failFast" name="failFast">
                        <span style="margin-left: 5px;">Fail Fast</span>
                    </label>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 10px;">
                    <div class="parameter-item">
                        <label class="checkbox-label">
                            <input type="checkbox" id="logToFile" name="logToFile">
                            <span style="margin-left: 5px;">Log to File</span>
                        </label>
                    </div>
                    <div class="parameter-item">
                        <label for="exitWait">Exit Wait (minutes):</label>
                        <input type="number" id="exitWait" name="exitWait" min="1" placeholder="e.g., 5">
                    </div>
                    <div class="parameter-item">
                        <label class="checkbox-label">
                            <input type="checkbox" id="debug" name="debug">
                            <span style="margin-left: 5px;">Debug/Verbose</span>
                        </label>
                    </div>
                </div>
            </div>
            <!-- Additional Command Arguments removed, only --profile=MONITORS-STANDARD.json will be appended automatically -->
            <button type="submit">Run Virtual Client</button>
            <button type="button" id="cancelBtn">Cancel</button>
        </form>
        <h3>Steps</h3>
        <ul id="stepsList">
            ${stepsHtml}
        </ul>
        <script>
            const vscode = acquireVsCodeApi();
            document.getElementById('runForm').addEventListener('submit', function(e) {
                e.preventDefault();
                var args = [];
                var profile = document.getElementById('profile').value.trim();
                if (profile) { args.push('--profile=' + profile); }
                var system = document.getElementById('system').value.trim();
                if (system) { args.push('--system=' + system); }
                var timeout = document.getElementById('timeout').value.trim();
                if (timeout) { args.push('--timeout=' + timeout); }
                var clientId = document.getElementById('clientId').value.trim();
                if (clientId) { args.push('--client-id=' + clientId); }
                var metadata = document.getElementById('metadata').value.trim();
                if (metadata) { args.push('--metadata="' + metadata + '"'); }
                var parameters = document.getElementById('parameters').value.trim();
                if (parameters) { args.push('--parameters="' + parameters + '"'); }
                var proxyApi = document.getElementById('proxyApi').value.trim();
                if (proxyApi) { args.push('--proxy-api=' + proxyApi); }
                var clean = document.getElementById('clean').value.trim();
                var cleanFlag = document.getElementById('cleanFlag').checked;
                if (cleanFlag) {
                    args.push('--clean');
                } else if (clean) {
                    args.push('--clean=' + clean);
                }
                if (document.getElementById('failFast').checked) { args.push('--fail-fast'); }
                if (document.getElementById('logToFile').checked) { args.push('--log-to-file'); }
                var exitWait = document.getElementById('exitWait').value.trim();
                if (exitWait) { args.push('--exit-wait=' + exitWait); }
                if (document.getElementById('debug').checked) { args.push('--debug'); }
                // Always append --profile=MONITORS-STANDARD.json
                args.push('--profile=MONITORS-STANDARD.json');
                vscode.postMessage({
                    command: 'run',
                    packagePath: document.getElementById('packagePath').value,
                    platform: document.getElementById('platform').value,
                    toolArgs: args.join(' ')
                });
            });
            document.getElementById('cancelBtn').addEventListener('click', function() {
                vscode.postMessage({ command: 'cancel' });
            });
            window.addEventListener('message', function(event) {
                var message = event.data;
                if (message.command === 'updateSteps') {
                    var stepsList = document.getElementById('stepsList');
                    var html = '';
                    for (var i = 0; i < message.steps.length; i++) {
                        var step = message.steps[i];
                        html += '<li class="step-item ' + step.status + '">' + step.label + ': ' + step.status + (step.detail ? ' - ' + step.detail : '') + '</li>';
                    }
                    stepsList.innerHTML = html;
                }
            });
        </script>
    </body>
    </html>
    `;
}

// Register the Machines treeview with the correct view id in package.json
// Add this to contributes.views in your package.json:
//
// "views": {
//   "explorer": [
//     {
//       "id": "machinesView",
//       "name": "Machines"
//     }
//   ]
// }
//
// Also add a + command to the view/title bar:
//
// "menus": {
//   "view/title": [
//     {
//       "command": "machines.addMachine",
//       "when": "view == machinesView",
//       "group": "navigation@1"
//     }
//   ]
// }
