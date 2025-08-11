import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ssh2 from 'ssh2';
import { MachineItem } from './machinesProvider';
import { ScheduledRunItem, ScheduledRunsProvider, ScheduledRunStep } from './ScheduledRunsProvider';
import {
    getAddMachineWebviewContent,
    getRunVirtualClientWebviewContent,
    showRunDetailsWebview,
} from './webviewContent';
import { MachinesProvider } from './machinesProvider';
import { scheduledRunsProvider } from './extension';
import { LOGS_DIR_NAME, LOG_FILE_EXTENSION, MAX_LOG_CONTENT_SIZE_BYTES } from './constants';
import { sanitizeLabel } from './utils';

// Types
export interface ActiveResources {
    panel: vscode.WebviewPanel | undefined;
    conn: ssh2.Client | null;
    sftp: ssh2.SFTPWrapper | null;
    readStream: fs.ReadStream | null;
    writeStream: fs.WriteStream | null;
}

class RunResourceManager implements ActiveResources {
    panel: vscode.WebviewPanel | undefined;
    conn: ssh2.Client | null = null;
    sftp: ssh2.SFTPWrapper | null = null;
    readStream: fs.ReadStream | null = null;
    writeStream: fs.WriteStream | null = null;

    cleanup(): void {
        if (this.readStream) {
            try {
                this.readStream.destroy();
            } catch {}
            this.readStream = null;
        }
        if (this.writeStream) {
            try {
                this.writeStream.destroy();
            } catch {}
            this.writeStream = null;
        }
        if (this.sftp) {
            try {
                this.sftp.end();
            } catch {}
            this.sftp = null;
        }
        if (this.conn) {
            try {
                this.conn.end();
            } catch {}
            this.conn = null;
        }
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }
}

let globalResourceManager: RunResourceManager | undefined;

// Helper functions
/**
 * Cleans up resources used by a run (SSH, SFTP, streams, panel).
 * @param resources The resources to clean up.
 */
export function cleanupResources(resources: ActiveResources) {
    if (resources.readStream) {
        try {
            resources.readStream.destroy();
        } catch {}
        resources.readStream = null;
    }
    if (resources.writeStream) {
        try {
            resources.writeStream.destroy();
        } catch {}
        resources.writeStream = null;
    }
    if (resources.sftp) {
        try {
            resources.sftp.end();
        } catch {}
        resources.sftp = null;
    }
    if (resources.conn) {
        try {
            resources.conn.end();
        } catch {}
        resources.conn = null;
    }
}

/**
 * Find all files in a directory recursively
 */
async function findAllFiles(logDir: string): Promise<string[]> {
    const files: string[] = [];

    async function scanDirectory(dir: string): Promise<void> {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                await scanDirectory(fullPath);
            } else if (entry.isFile()) {
                files.push(fullPath);
            }
        }
    }

    await scanDirectory(logDir);
    return files;
}

/**
 * Read all files and combine their content with size limit
 */
async function readAllFiles(files: string[]): Promise<string> {
    let combinedContent = '';
    let totalSize = 0;
    // Use configurable size limit to stay within token limits (roughly 25k tokens)
    const maxSizeBytes = MAX_LOG_CONTENT_SIZE_BYTES;

    // Sort files by modification time (newest first)
    const filesWithStats = await Promise.all(
        files.map(async file => {
            const stat = await fs.promises.stat(file);
            return { file, mtime: stat.mtime };
        })
    );

    filesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    for (const { file } of filesWithStats) {
        try {
            const content = await fs.promises.readFile(file, 'utf-8');
            const fileHeader = `\n--- ${path.basename(file)} ---\n`;

            if (totalSize + content.length + fileHeader.length > maxSizeBytes) {
                // If adding this file would exceed limit, add truncated version
                const remainingSpace = maxSizeBytes - totalSize - fileHeader.length;
                if (remainingSpace > 500) {
                    // Only add if we have reasonable space
                    combinedContent += fileHeader;
                    combinedContent += content.substring(0, remainingSpace - 100);
                    combinedContent += '\n... [Log truncated due to size limits] ...\n';
                }
                break;
            }

            combinedContent += fileHeader;
            combinedContent += content;
            totalSize += content.length + fileHeader.length;
        } catch (error) {
            // Skip files that can't be read
            console.warn(`Could not read file ${file}:`, error);
        }
    }

    // Add summary info about what was included
    const summaryHeader = `\n=== LOG ANALYSIS SUMMARY ===\nProcessed ${filesWithStats.length} files, included ${Math.round(totalSize / 1024)}KB of content\n\n`;

    return summaryHeader + combinedContent;
}

// Command handlers
/**
 * Handles the Add Machine command, showing the webview and processing user input.
 * @param context The extension context.
 * @param machinesProvider The machines provider instance.
 */
export async function handleAddMachine(context: vscode.ExtensionContext, machinesProvider: any): Promise<void> {
    const resources: ActiveResources = {
        panel: undefined,
        conn: null,
        sftp: null,
        readStream: null,
        writeStream: null,
    };

    try {
        resources.panel = vscode.window.createWebviewPanel('addMachine', 'Add New Machine', vscode.ViewColumn.One, {
            enableScripts: true,
        });

        resources.panel.webview.html = getAddMachineWebviewContent();

        resources.panel.webview.onDidReceiveMessage(
            async message => {
                try {
                    if (message.command === 'add') {
                        const { label, ip, username, password } = message;
                        await machinesProvider.addMachine(label, ip, username, password);
                        resources.panel?.dispose();
                    } else if (message.command === 'cancel') {
                        resources.panel?.dispose();
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to add machine: ${error instanceof Error ? error.message : 'Unknown error'}`
                    );
                }
            },
            undefined,
            context.subscriptions
        );

        resources.panel.onDidDispose(() => {
            cleanupResources(resources);
        });
    } catch (error) {
        vscode.window.showErrorMessage(
            `Failed to open Add Machine webview: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

export async function handleDeleteMachine(
    context: vscode.ExtensionContext,
    item: MachineItem,
    machinesProvider: any
): Promise<void> {
    try {
        if (!item) {
            throw new Error('No machine selected.');
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
        vscode.window.showErrorMessage(
            `Failed to delete machine: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

export async function handleShowRunDetails(context: vscode.ExtensionContext, runItem: ScheduledRunItem): Promise<void> {
    try {
        const persistentRuns = context.globalState.get<any[]>('persistentRuns', []);
        const found = persistentRuns.find(r => r.id === runItem.label);

        if (found) {
            await showRunDetailsWebview(context, found);
        } else {
            vscode.window.showWarningMessage('Run details not found.');
        }
    } catch (error) {
        vscode.window.showErrorMessage(
            `Failed to show run details: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

export async function handleStreamLogs(context: vscode.ExtensionContext): Promise<void> {
    try {
        const platform = await vscode.window.showQuickPick(['win-x64', 'win-arm64'], {
            placeHolder: 'Select the platform',
        });

        if (!platform) {
            vscode.window.showInformationMessage('Platform selection cancelled.');
            return;
        }

        // ... implement log streaming logic ...
    } catch (error) {
        vscode.window.showErrorMessage(
            `Failed to stream logs: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

export async function handleShowLogFiles(context: vscode.ExtensionContext): Promise<void> {
    try {
        const logType = await vscode.window.showQuickPick(
            [
                { label: 'Traces', ext: '.traces' },
                { label: 'Metrics', ext: '.metrics' },
                { label: 'Events', ext: '.events' },
            ],
            { placeHolder: 'Select log type to view' }
        );

        if (!logType) {
            return;
        }

        const logsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME);
        if (!fs.existsSync(logsDir)) {
            vscode.window.showWarningMessage('Logs directory not found.');
            return;
        }

        const files = fs.readdirSync(logsDir).filter(f => f.endsWith(logType.ext));
        if (files.length === 0) {
            vscode.window.showInformationMessage(`No ${logType.label.toLowerCase()} files found.`);
            return;
        }

        const filePick = await vscode.window.showQuickPick(files, {
            placeHolder: `Select a ${logType.label.toLowerCase()} file`,
        });

        if (!filePick) {
            return;
        }

        const filePath = path.join(logsDir, filePick);
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
    } catch (error) {
        vscode.window.showErrorMessage(
            `Failed to show log files: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

/**
 * Handles the log summarization command using VS Code's LLM capabilities
 */
export async function handleSummarizeLogs(context: vscode.ExtensionContext, item: ScheduledRunItem): Promise<void> {
    try {
        // Show progress indicator
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Preparing log analysis...',
                cancellable: false,
            },
            async progress => {
                progress.report({ increment: 20, message: 'Finding log files...' });

                // Get the log file path - logs are stored in globalStorageUri/logs/{sanitizedLabel}/ directory
                const sanitizedLabel = sanitizeLabel(item.label);
                const runLogsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME, sanitizedLabel);
                const logLabel = item.label;

                // Check for the run's log directory
                if (!fs.existsSync(runLogsDir)) {
                    // Check what directories exist in the main logs directory
                    const mainLogsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME);
                    if (!fs.existsSync(mainLogsDir)) {
                        vscode.window.showWarningMessage(`Main logs directory not found: ${mainLogsDir}`);
                        return;
                    }

                    const existingDirs = fs
                        .readdirSync(mainLogsDir, { withFileTypes: true })
                        .filter(dirent => dirent.isDirectory())
                        .map(dirent => dirent.name);

                    console.log(`Available log directories: ${existingDirs.join(', ')}`);

                    // Show more detailed info about what we're looking for vs what exists
                    const logInfo = `No log directory found for run: ${item.label}. 
Expected: ${sanitizedLabel}
Available directories: ${existingDirs.slice(0, 5).join(', ')}${existingDirs.length > 5 ? ` and ${existingDirs.length - 5} more...` : ''}`;

                    vscode.window.showWarningMessage(logInfo);
                    return;
                }

                console.log(`Looking for logs in: ${runLogsDir} for run: ${logLabel}`);

                progress.report({ increment: 20, message: 'Reading log files...' });
                // Find all files in the run's directory
                const allLogFiles = await findAllFiles(runLogsDir);

                if (allLogFiles.length === 0) {
                    vscode.window.showWarningMessage(`No files found in directory: ${runLogsDir}`);
                    return;
                }

                console.log(
                    `Found ${allLogFiles.length} files for analysis:`,
                    allLogFiles.map((f: string) => path.basename(f))
                );
                progress.report({ increment: 30, message: 'Processing content (with size limits)...' });

                // Read and combine all file content with size limits for API
                const combinedLogs = await readAllFiles(allLogFiles);

                if (!combinedLogs.trim()) {
                    vscode.window.showWarningMessage('Files are empty or could not be read');
                    return;
                }

                console.log(`Combined log content size: ${Math.round(combinedLogs.length / 1024)}KB`);

                progress.report({ increment: 20, message: 'Opening AI analysis...' }); // Use VS Code's LLM API to summarize the logs
                await summarizeWithCopilot(combinedLogs, item);

                progress.report({ increment: 10, message: 'Analysis ready!' });
            }
        );
    } catch (error) {
        vscode.window.showErrorMessage(
            `Failed to summarize logs: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

/**
 * Use VS Code's LLM capabilities to summarize logs
 */
async function summarizeWithCopilot(logContent: string, runItem: ScheduledRunItem): Promise<void> {
    try {
        // Create the analysis prompt with context and logs
        const analysisPrompt = `You are an expert system performance analyst. Analyze the Virtual Client execution logs and provide a comprehensive summary.

**Context:**
- Tool: Microsoft Virtual Client (performance benchmarking tool)
- Run Label: ${runItem.label}
- Machine IP: ${runItem.machineIp}
- Profile: ${runItem.profile}
- System: ${runItem.system}

**Analysis Requirements:**
Please structure your analysis with these sections:

**Execution Overview**
- Overall status (Success/Failure/Partial)
- Total execution time and key phases
- Virtual Client version and configuration

**Performance Metrics & Results**
- Key performance metrics and benchmarks found
- Resource utilization patterns (CPU, Memory, Disk, Network)
- Throughput, latency, or other relevant measurements

**Issues & Diagnostics**
- Any errors, warnings, or failures detected
- Root cause analysis for issues
- Impact assessment and severity

**Performance Insights**
- Notable patterns or anomalies
- Bottlenecks or optimization opportunities
- Comparison with typical baseline performance (if evident)

**Summary & Recommendations**
- Overall assessment and key takeaways
- Actionable recommendations for optimization
- Areas requiring further investigation

Format your response clearly with emojis and headers as shown above. Focus on actionable insights for performance optimization and troubleshooting.

Here are the Virtual Client execution logs to analyze:

\`\`\`
${logContent}
\`\`\``;

        // Use VS Code Language Model API
        const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
        const messages = [vscode.LanguageModelChatMessage.User(analysisPrompt)];
        const request = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

        // Collect the response
        let analysisResult = '';
        for await (const fragment of request.text) {
            analysisResult += fragment;
        }

        // Create a document with the AI analysis
        const doc = await vscode.workspace.openTextDocument({
            content: `# 🤖 AI Log Analysis Results

**Run:** ${runItem.label}  
**Machine:** ${runItem.machineIp}  
**Model:** ${model.name}  
**Generated:** ${new Date().toLocaleString()}

---

${analysisResult}

---

## 📋 Original Log Data

<details>
<summary>Click to expand log content (${Math.round(logContent.length / 1024)} KB)</summary>

\`\`\`
${logContent}
\`\`\`

</details>
`,
            language: 'markdown',
        });

        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage('✅ AI log analysis completed successfully!');
    } catch (err) {
        // Making the chat request might fail because
        // - model does not exist
        // - user consent not given
        // - quota limits were exceeded
        if (err instanceof vscode.LanguageModelError) {
            console.log(err.message, err.code, err.cause);

            switch (err.code) {
                case 'NoPermissions':
                    vscode.window.showWarningMessage(
                        'GitHub Copilot access required. Please authenticate with GitHub Copilot to use AI log analysis.'
                    );
                    break;
                case 'Blocked':
                    vscode.window.showWarningMessage(
                        'Request was blocked. The log content might contain sensitive information.'
                    );
                    break;
                case 'NotFound':
                    vscode.window.showWarningMessage(
                        'Language model not found. Please ensure GitHub Copilot is installed and enabled.'
                    );
                    break;
                case 'QuotaExceeded':
                    vscode.window.showWarningMessage('Quota exceeded. Please try again later or reduce the log size.');
                    break;
                default:
                    vscode.window.showWarningMessage(`Language model error: ${err.message}`);
            }
        } else {
            // add other error handling logic
            throw err;
        }
    }
}

/**
 * Handler for installing VC certificates on a remote machine.
 * Prompts for local .pfx file, cert password (optional), and remote directory (optional).
 * @param context The extension context.
 * @param item The target MachineItem.
 */
export async function installVCCertificatesHandler(context: vscode.ExtensionContext, item: MachineItem): Promise<void> {
    const outputChannel = vscode.window.createOutputChannel(`Install VC Certificates - ${item.label}`);
    outputChannel.show(true);
    try {
        // Prompt for local .pfx file
        const fileUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Select VC Certificate (.pfx)',
            filters: { 'PFX Files': ['pfx'] },
        });
        if (!fileUris || !fileUris[0]) {
            vscode.window.showWarningMessage('No certificate file selected.');
            return;
        }
        const localPfxPath = fileUris[0].fsPath;

        // Prompt for cert password (optional)
        const certPassword = await vscode.window.showInputBox({
            prompt: 'Enter certificate password (optional)',
            password: true,
            ignoreFocusOut: true,
        });

        // Prompt for remote directory (optional)
        const remoteDirInput = await vscode.window.showInputBox({
            prompt: `Enter remote directory for certificate (optional, default: ${item.getDefaultRemoteTargetDir()})`,
            value: item.getDefaultRemoteTargetDir(),
            ignoreFocusOut: true,
        });
        const remoteDir =
            remoteDirInput && remoteDirInput.trim() ? remoteDirInput.trim() : item.getDefaultRemoteTargetDir();

        // Get credentials
        const credentials = { username: item.username, password: item.password };
        if (!credentials.username || !credentials.password) {
            vscode.window.showErrorMessage('Machine credentials not found.');
            return;
        }

        // Connect via SSH
        const ssh2 = require('ssh2');
        const conn = new ssh2.Client();
        await new Promise<void>((resolve, reject) => {
            conn.on('ready', () => {
                outputChannel.appendLine('SSH connection established.');
                conn.sftp((err: any, sftp: any) => {
                    if (err) {
                        vscode.window.showErrorMessage('SFTP error: ' + err.message);
                        outputChannel.appendLine('SFTP error: ' + err.message);
                        conn.end();
                        reject(err);
                        return;
                    }
                    // Detect remote OS
                    conn.exec(item.isWindows ? 'ver' : 'uname', (err: any, stream: any) => {
                        if (err) {
                            vscode.window.showErrorMessage('Failed to detect remote OS: ' + err.message);
                            outputChannel.appendLine('Failed to detect remote OS: ' + err.message);
                            conn.end();
                            reject(err);
                            return;
                        }
                        let osOutput = '';
                        stream.on('data', (data: Buffer) => {
                            osOutput += data.toString();
                        });
                        stream.on('close', async () => {
                            const isWindows = item.isWindows || osOutput.includes('Windows');
                            const certFilename = require('path').basename(localPfxPath);
                            let remoteCertPath: string;
                            if (isWindows) {
                                remoteCertPath = require('path').win32.join(remoteDir, certFilename);
                            } else {
                                remoteCertPath = require('path').posix.join(remoteDir, certFilename);
                            }
                            // Create remote directory
                            const mkdirCmd = isWindows
                                ? `powershell -Command "New-Item -ItemType Directory -Path '${remoteDir}' -Force"`
                                : `mkdir -p '${remoteDir}'`;
                            conn.exec(mkdirCmd, (err: any, mkdirStream: any) => {
                                if (err) {
                                    vscode.window.showErrorMessage('Failed to create remote directory: ' + err.message);
                                    outputChannel.appendLine('Failed to create remote directory: ' + err.message);
                                    conn.end();
                                    reject(err);
                                    return;
                                }
                                let uploadStarted = false;
                                function startUpload() {
                                    if (uploadStarted) {
                                        return;
                                    }
                                    uploadStarted = true;
                                    outputChannel.appendLine(
                                        'Remote directory creation command exited/closed. Proceeding to upload certificate.'
                                    );
                                    outputChannel.appendLine(`Uploading certificate to ${remoteCertPath} ...`);
                                    sftp.fastPut(localPfxPath, remoteCertPath, (err: any) => {
                                        if (err) {
                                            vscode.window.showErrorMessage(
                                                'Failed to upload certificate: ' + err.message
                                            );
                                            outputChannel.appendLine('Failed to upload certificate: ' + err.message);
                                            conn.end();
                                            reject(err);
                                            return;
                                        }
                                        outputChannel.appendLine('Certificate uploaded.');
                                        // Install the certificate
                                        let installCmd;
                                        if (isWindows) {
                                            const escapedPath = remoteCertPath.replace(/\\/g, '\\\\');
                                            installCmd = `powershell -Command "$ErrorActionPreference = 'Stop'; $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2; $cert.Import('${escapedPath}', '${certPassword || ''}', 'PersistKeySet'); $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', 'CurrentUser'); $store.Open('ReadWrite'); $store.Add($cert); $store.Close(); Write-Output 'Certificate successfully imported.'"`;
                                        } else {
                                            installCmd = `openssl pkcs12 -in '${remoteCertPath}' -out '${remoteCertPath}.pem' -nodes -passin pass:${certPassword || ''}`;
                                        }
                                        outputChannel.appendLine('Installing certificate...');
                                        conn.exec(installCmd, (err: any, installStream: any) => {
                                            if (err) {
                                                vscode.window.showErrorMessage(
                                                    'Failed to install certificate: ' + err.message
                                                );
                                                outputChannel.appendLine(
                                                    'Failed to install certificate: ' + err.message
                                                );
                                                conn.end();
                                                reject(err);
                                                return;
                                            }
                                            let installOut = '';
                                            let installErr = '';
                                            installStream.on('data', (data: Buffer) => {
                                                installOut += data.toString();
                                            });
                                            installStream.stderr.on('data', (data: Buffer) => {
                                                installErr += data.toString();
                                            });
                                            installStream.on('close', () => {
                                                outputChannel.appendLine('Install Output:');
                                                outputChannel.appendLine(installOut);
                                                if (installErr) {
                                                    outputChannel.appendLine('Install Error/Warning:');
                                                    outputChannel.appendLine(installErr);
                                                }
                                                // Delete the .pfx file
                                                const deleteCmd = isWindows
                                                    ? `del "${remoteCertPath}"`
                                                    : `rm '${remoteCertPath}'`;
                                                conn.exec(deleteCmd, (err: any, delStream: any) => {
                                                    if (err) {
                                                        vscode.window.showWarningMessage(
                                                            'Failed to delete certificate file after install: ' +
                                                                err.message
                                                        );
                                                        outputChannel.appendLine(
                                                            'Failed to delete certificate file after install: ' +
                                                                err.message
                                                        );
                                                        conn.end();
                                                        resolve();
                                                        return;
                                                    }
                                                    delStream.on('close', () => {
                                                        outputChannel.appendLine(
                                                            'Certificate file deleted from remote machine.'
                                                        );
                                                        vscode.window.showInformationMessage(
                                                            'Certificate installed and cleaned up successfully.'
                                                        );
                                                        conn.end();
                                                        resolve();
                                                    });
                                                });
                                            });
                                        });
                                    });
                                }
                                mkdirStream.on('exit', startUpload);
                                mkdirStream.on('close', startUpload); // fallback
                            });
                        });
                    });
                });
            });
            conn.on('error', (err: any) => {
                vscode.window.showErrorMessage('SSH connection error: ' + err.message);
                outputChannel.appendLine('SSH connection error: ' + err.message);
                reject(err);
            });
            conn.connect({
                host: item.ip,
                port: 22,
                username: credentials.username,
                password: credentials.password,
                readyTimeout: 10000,
            });
        });
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to install VC certificate: ${error.message || error}`);
        outputChannel.appendLine(`Failed to install VC certificate: ${error.message || error}`);
    }
}
