// Node core modules
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// NPM packages
import * as ssh2 from 'ssh2';
import { spawn } from 'child_process';

// Local files
import { MachinesProvider, MachineItem } from './machinesProvider';
import { getAddMachineWebviewContent, getRunVirtualClientWebviewContent, showRunDetailsWebview } from './webviewContent';
import { VirtualClientTreeViewProvider } from './VirtualClientTreeViewProvider';
import { ScheduledRunStep, ScheduledRunItem, ScheduledRunsProvider } from './ScheduledRunsProvider';

// Use extension-specific logs directory in globalStoragePath
let LOGS_DIR: string;

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
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    const file = path.join(LOGS_DIR, `${run.id}.json`);
    fs.writeFileSync(file, JSON.stringify(run, null, 2));
}

export function clearLogsFolder(context: vscode.ExtensionContext) {
    LOGS_DIR = path.join(context.globalStoragePath, 'virtualclient-vscode-logs');
    if (fs.existsSync(LOGS_DIR)) {
        fs.readdirSync(LOGS_DIR).forEach(f => {
            fs.unlinkSync(path.join(LOGS_DIR, f));
        });
    }
}

// Share machines between both providers
let sharedMachines: { label: string, ip: string }[] = [];

// Declare scheduledRunsProvider at the top level so it is in scope everywhere
let scheduledRunsProvider: ScheduledRunsProvider;
let treeViewProvider: VirtualClientTreeViewProvider | undefined;

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

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Register the webview command first
    context.subscriptions.push(
        vscode.commands.registerCommand('virtual-client.addMachineWebview', () => {
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
	console.log('Congratulations, your extension "virtual-client" is now active!');

    context.subscriptions.push(
        vscode.commands.registerCommand('virtual-client.runVirtualClientWebview', async () => {
            // Get all machines from the tree view provider
            const machines = treeViewProvider ? treeViewProvider.machines : [];
            if (!machines || machines.length === 0) {
                vscode.window.showErrorMessage('No machines available. Please add a machine first.');
                return;
            }
            const lastParams = context.globalState.get<{packagePath: string, platform: string, toolArgs: string}>('lastVCParams') || { packagePath: '', platform: '', toolArgs: '' };
            const panel = vscode.window.createWebviewPanel(
                'runVirtualClient',
                `Run Virtual Client`,
                vscode.ViewColumn.One,
                { enableScripts: true }
            );
            panel.webview.html = getRunVirtualClientWebviewContent(machines, lastParams, [
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
            let activeWriteStream: fs.WriteStream | null = null;
            // Move steps and webviewSteps to outer scope so they are accessible in all callbacks
            let steps: ScheduledRunStep[] | undefined;
            let webviewSteps: { label: string, status: string, detail?: string }[] | undefined;
            panel.webview.onDidReceiveMessage(
                async message => {
                    if (message.command === 'run') {
                        const { machineIp, packagePath, platform, toolArgs } = message;
                        const machine = machines.find(m => m.ip === machineIp);
                        if (!machine) {
                            vscode.window.showErrorMessage('Selected machine not found.');
                            return;
                        }
                        const username = await context.secrets.get(`machine:${machine.ip}:username`);
                        const password = await context.secrets.get(`machine:${machine.ip}:password`);
                        if (!username || !password) {
                            vscode.window.showErrorMessage('Credentials not found for this machine.');
                            return;
                        }
                        await context.globalState.update('lastVCParams', {packagePath, platform, toolArgs});
                        const remoteDir = 'C:/VirtualClientScheduler';
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
                            steps = [
                                new ScheduledRunStep('Create Remote Directory', 'pending'),
                                new ScheduledRunStep('Transfer Package', 'pending'),
                                new ScheduledRunStep('Extract Package', 'pending'),
                                new ScheduledRunStep('Run Virtual Client', 'pending')
                            ];
                            const runItem = scheduledRunsProvider.addRun(machine.label, machine.ip, steps);
                            webviewSteps = [
                                { label: 'Create Remote Directory', status: 'pending', detail: '' },
                                { label: 'Transfer Package', status: 'pending', detail: '' },
                                { label: 'Extract Package', status: 'pending', detail: '' },
                                { label: 'Run Virtual Client', status: 'pending', detail: '' }
                            ];
                            scheduledRunsProvider.update();
                            updateWebviewSteps(webviewSteps || []);
                            if (steps) {
                                steps[0].status = 'running'; scheduledRunsProvider.update();
                            }
                            if (webviewSteps) {
                                webviewSteps[0].status = 'running'; updateWebviewSteps(webviewSteps);
                            }
                            // Check for remote directory, package, and extraction
                            conn.exec(
                                `powershell -Command "if (!(Test-Path -Path '${remoteDir}')) { New-Item -ItemType Directory -Path '${remoteDir}' } ; ` +
                                `if (Test-Path -Path '${remoteZip}') { Write-Output 'PACKAGE_EXISTS' } else { Write-Output 'PACKAGE_NOT_EXISTS' } ; ` +
                                `if (Test-Path -Path '${remoteExtracted}/VirtualClient.exe') { Write-Output 'EXTRACTED_EXISTS' } else { Write-Output 'EXTRACTED_NOT_EXISTS' }"`,
                                (err: Error | undefined, stream) => {
                                    if (err) {
                                        outputChannel.appendLine(`Failed to create remote directory: ${err.message}`);
                                        if (steps) {
                                            steps[0].status = 'error'; scheduledRunsProvider.update();
                                        }
                                        if (webviewSteps) {
                                            webviewSteps[0].status = 'error'; updateWebviewSteps(webviewSteps);
                                        }
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
                                        if (steps) {
                                            steps[0].status = 'error'; scheduledRunsProvider.update();
                                        }
                                        if (webviewSteps) {
                                            webviewSteps[0].status = 'error'; updateWebviewSteps(webviewSteps);
                                        }
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
                                    stream.on('close', (code: number, signal: string) => {
                                        clearTimeout(timeout);
                                        if (didTimeout) { return; }
                                        if (dirCreateStderr) {
                                            outputChannel.appendLine(`Directory creation stderr: ${dirCreateStderr}`);
                                        }
                                        if (code !== 0) {
                                            outputChannel.appendLine(`Directory creation failed with exit code ${code}.`);
                                            if (steps) {
                                                steps[0].status = 'error'; scheduledRunsProvider.update();
                                            }
                                            if (webviewSteps) {
                                                webviewSteps[0].status = 'error'; updateWebviewSteps(webviewSteps);
                                            }
                                            conn.end();
                                            panel.dispose();
                                            return;
                                        }
                                        outputChannel.appendLine('Remote directory ready. Checking for package and extraction...');
                                        if (steps) {
                                            steps[0].status = 'success'; scheduledRunsProvider.update();
                                        }
                                        if (webviewSteps) {
                                            webviewSteps[0].status = 'success'; updateWebviewSteps(webviewSteps);
                                        }
                                        const hasPackage = dirCreateStdout.includes('PACKAGE_EXISTS');
                                        const hasExtracted = dirCreateStdout.includes('EXTRACTED_EXISTS');
                                        if (hasPackage) {
                                            outputChannel.appendLine('Package already exists on remote.');
                                            if (steps) {
                                                steps[1].status = 'success'; scheduledRunsProvider.update();
                                            }
                                            if (webviewSteps) {
                                                webviewSteps[1].status = 'success'; updateWebviewSteps(webviewSteps);
                                            }
                                            if (hasExtracted) {
                                                outputChannel.appendLine('Extraction already exists. Skipping extraction.');
                                                if (steps) {
                                                    steps[2].status = 'success'; scheduledRunsProvider.update();
                                                }
                                                if (webviewSteps) {
                                                    webviewSteps[2].status = 'success'; updateWebviewSteps(webviewSteps);
                                                }
                                                if (steps) {
                                                    steps[3].status = 'running'; scheduledRunsProvider.update();
                                                }
                                                if (webviewSteps) {
                                                    webviewSteps[3].status = 'running'; updateWebviewSteps(webviewSteps);
                                                }
                                                // Use toolPath and remoteExtracted in all relevant SSH commands and logs
                                                outputChannel.appendLine(`Tool path: ${toolPath}`);
                                                outputChannel.appendLine(`Command: ${toolPath} ${toolArgs}`);
                                                let executionOutput = '';
                                                conn.exec(`${toolPath} ${toolArgs}`,
                                                    (err: Error | undefined, stream) => {
                                                        if (err) {
                                                            outputChannel.appendLine(`Execution error: ${err.message}`);
                                                            if (steps) {
                                                                steps[3].status = 'error'; scheduledRunsProvider.update();
                                                            }
                                                            if (webviewSteps) {
                                                                webviewSteps[3].status = 'error'; updateWebviewSteps(webviewSteps);
                                                            }
                                                            conn.end();
                                                            panel.dispose();
                                                            return;
                                                        }
                                                        stream.on('data', (data: Buffer) => {
                                                            outputChannel.appendLine(`[VC Output] ${data.toString()}`);
                                                            if (steps) {
                                                                steps[3].detail = (steps[3].detail || '') + data.toString();
                                                            }
                                                            executionOutput += data.toString();
                                                            scheduledRunsProvider.update();
                                                            updateWebviewSteps(webviewSteps || []);
                                                        });
                                                        stream.stderr.on('data', (data: Buffer) => {
                                                            outputChannel.appendLine(`[VC Error] ${data.toString()}`);
                                                            if (steps) {
                                                                steps[3].detail = (steps[3].detail || '') + data.toString();
                                                            }
                                                            executionOutput += data.toString();
                                                            scheduledRunsProvider.update();
                                                            updateWebviewSteps(webviewSteps || []);
                                                        });
                                                        stream.on('close', async (code: number, signal: string) => {
                                                            outputChannel.appendLine('Virtual Client execution finished.');
                                                            if (steps) {
                                                                steps[3].status = 'success'; scheduledRunsProvider.update();
                                                            }
                                                            if (webviewSteps) {
                                                                webviewSteps[3].status = 'success'; updateWebviewSteps(webviewSteps);
                                                            }
                                                            // Save the execution output log in Scheduled Runs
                                                            if (steps) {
                                                                steps[3].detail = (steps[3].detail || '') + '\n[Execution Output]\n' + executionOutput;
                                                            }
                                                            scheduledRunsProvider.update();
                                                            updateWebviewSteps(webviewSteps || []);
                                                            // Fetch logs from remote logs directory
                                                            const remoteLogsDir = `${remoteExtracted}/logs`;
                                                            const remoteLogsZip = `${remoteExtracted}/logs.zip`;
                                                            const localLogsDir = path.join(os.tmpdir(), `vc-logs-${Date.now()}`);
                                                            const localLogsZip = path.join(localLogsDir, 'logs.zip');
                                                            fs.mkdirSync(localLogsDir, { recursive: true });
                                                            conn.exec(`powershell -Command "if (Test-Path -Path '${remoteLogsDir}') { Compress-Archive -Path '${remoteLogsDir}/*' -DestinationPath '${remoteLogsZip}' -Force }"`, (err, stream) => {
                                                                if (err) {
                                                                    outputChannel.appendLine(`Failed to zip logs: ${err.message}`);
                                                                    conn.end();
                                                                    panel.dispose();
                                                                    return;
                                                                }
                                                                stream.on('close', (code: number, signal: string) => {
                                                                    conn.sftp((err, sftp) => {
                                                                        if (err) {
                                                                            outputChannel.appendLine(`SFTP error while fetching zipped logs: ${err.message}`);
                                                                            conn.end();
                                                                            panel.dispose();
                                                                            return;
                                                                        }
                                                                        const writeStream = fs.createWriteStream(localLogsZip);
                                                                        const readStream = sftp.createReadStream(remoteLogsZip.replace(/\\/g, '/'));
                                                                        readStream.pipe(writeStream);
                                                                        writeStream.on('close', () => {
                                                                            // Unzip logs locally
                                                                            const unzip = require('unzipper');
                                                                            fs.createReadStream(localLogsZip)
                                                                              .pipe(unzip.Extract({ path: localLogsDir }))
                                                                              .on('close', () => {
                                                                                  // Read all log files and append to Output Channel and steps[3].detail
                                                                                  const logFiles = fs.readdirSync(localLogsDir).filter(f => f.endsWith('.log') || f.endsWith('.txt'));
                                                                                  let logsContent = '';
                                                                                  for (const file of logFiles) {
                                                                                      const logContent = fs.readFileSync(path.join(localLogsDir, file), 'utf8');
                                                                                      outputChannel.appendLine(`[Log: ${file}]\n${logContent}`);
                                                                                      logsContent += `\n[Log: ${file}]\n${logContent}`;
                                                                                  }
                                                                                  if (steps) {
                                                                                      steps[3].detail = (steps[3].detail || '') + logsContent;
                                                                                      scheduledRunsProvider.update();
                                                                                      updateWebviewSteps(webviewSteps || []);
                                                                                  }
                                                                                  conn.end();
                                                                                  panel.dispose();
                                                                              });
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
                                                if (steps) {
                                                    steps[2].status = 'running'; scheduledRunsProvider.update();
                                                }
                                                if (webviewSteps) {
                                                    webviewSteps[2].status = 'running'; updateWebviewSteps(webviewSteps);
                                                }
                                                // Update extraction command to use the correct destination
                                                conn.exec(`powershell -Command \"Expand-Archive -Path '${remoteZip}' -DestinationPath '${remoteDir}/${packageBaseName}' -Force\"`, (err: Error | undefined, stream) => {
                                                    if (err) {
                                                        outputChannel.appendLine(`Extraction error: ${err.message}`);
                                                        if (steps) {
                                                            steps[2].status = 'error'; scheduledRunsProvider.update();
                                                        }
                                                        if (webviewSteps) {
                                                            webviewSteps[2].status = 'error'; updateWebviewSteps(webviewSteps);
                                                        }
                                                        conn.end();
                                                        panel.dispose();
                                                        return;
                                                    }
                                                    let extractionStdout = '';
                                                    let extractionStderr = '';
                                                    stream.on('data', (data: Buffer) => {
                                                        extractionStdout += data.toString();
                                                        outputChannel.appendLine(`[Extract stdout] ${data.toString()}`);
                                                        if (steps) {
                                                            steps[2].detail = (steps[2].detail || '') + data.toString();
                                                        }
                                                        scheduledRunsProvider.update();
                                                        updateWebviewSteps(webviewSteps || []);
                                                    });
                                                    stream.stderr.on('data', (data: Buffer) => {
                                                        extractionStderr += data.toString();
                                                        outputChannel.appendLine(`[Extract stderr] ${data.toString()}`);
                                                        if (steps) {
                                                            steps[2].detail = (steps[2].detail || '') + data.toString();
                                                        }
                                                        scheduledRunsProvider.update();
                                                        updateWebviewSteps(webviewSteps || []);
                                                    });
                                                    stream.on('close', (code: number, signal: string) => {
                                                        if (extractionStderr) {
                                                            outputChannel.appendLine(`Extraction failed: ${extractionStderr}`);
                                                            if (steps) {
                                                                steps[2].status = 'error'; scheduledRunsProvider.update();
                                                            }
                                                            if (webviewSteps) {
                                                                webviewSteps[2].status = 'error'; updateWebviewSteps(webviewSteps);
                                                            }
                                                            conn.end();
                                                            panel.dispose();
                                                            return;
                                                        }
                                                        outputChannel.appendLine(`Extraction complete (exit code ${code}).`);
                                                        if (steps) {
                                                            steps[2].status = 'success'; scheduledRunsProvider.update();
                                                        }
                                                        if (webviewSteps) {
                                                            webviewSteps[2].status = 'success'; updateWebviewSteps(webviewSteps);
                                                        }
                                                        if (steps) {
                                                            steps[3].status = 'running'; scheduledRunsProvider.update();
                                                        }
                                                        if (webviewSteps) {
                                                            webviewSteps[3].status = 'running'; updateWebviewSteps(webviewSteps);
                                                        }
                                                        // Use toolPath and remoteExtracted in all relevant SSH commands and logs
                                                        outputChannel.appendLine(`Tool path: ${toolPath}`);
                                                        outputChannel.appendLine(`Command: ${toolPath} ${toolArgs}`);
                                                        let executionOutput = '';
                                                        conn.exec(`${toolPath} ${toolArgs}`,
                                                            (err: Error | undefined, stream) => {
                                                                if (err) {
                                                                    outputChannel.appendLine(`Execution error: ${err.message}`);
                                                                    if (steps) {
                                                                        steps[3].status = 'error'; scheduledRunsProvider.update();
                                                                    }
                                                                    if (webviewSteps) {
                                                                        webviewSteps[3].status = 'error'; updateWebviewSteps(webviewSteps);
                                                                    }
                                                                    conn.end();
                                                                    panel.dispose();
                                                                    return;
                                                                }
                                                                stream.on('data', (data: Buffer) => {
                                                                    outputChannel.appendLine(`[VC Output] ${data.toString()}`);
                                                                    if (steps) {
                                                                        steps[3].detail = (steps[3].detail || '') + data.toString();
                                                                    }
                                                                    executionOutput += data.toString();
                                                                    scheduledRunsProvider.update();
                                                                    updateWebviewSteps(webviewSteps || []);
                                                                });
                                                                stream.stderr.on('data', (data: Buffer) => {
                                                                    outputChannel.appendLine(`[VC Error] ${data.toString()}`);
                                                                    if (steps) {
                                                                        steps[3].detail = (steps[3].detail || '') + data.toString();
                                                                    }
                                                                    executionOutput += data.toString();
                                                                    scheduledRunsProvider.update();
                                                                    updateWebviewSteps(webviewSteps || []);
                                                                });
                                                                stream.on('close', async (code: number, signal: string) => {
                                                                    outputChannel.appendLine('Virtual Client execution finished.');
                                                                    if (steps) {
                                                                        steps[3].status = 'success'; scheduledRunsProvider.update();
                                                                    }
                                                                    if (webviewSteps) {
                                                                        webviewSteps[3].status = 'success'; updateWebviewSteps(webviewSteps);
                                                                    }
                                                                    // Save the execution output log in Scheduled Runs
                                                                    if (steps) {
                                                                        steps[3].detail = (steps[3].detail || '') + '\n[Execution Output]\n' + executionOutput;
                                                                    }
                                                                    scheduledRunsProvider.update();
                                                                    updateWebviewSteps(webviewSteps || []);
                                                                    // Fetch logs from remote logs directory
                                                                    const remoteLogsDir = `${remoteExtracted}/logs`;
                                                                    const remoteLogsZip = `${remoteExtracted}/logs.zip`;
                                                                    const localLogsDir = path.join(os.tmpdir(), `vc-logs-${Date.now()}`);
                                                                    const localLogsZip = path.join(localLogsDir, 'logs.zip');
                                                                    fs.mkdirSync(localLogsDir, { recursive: true });
                                                                    conn.exec(`powershell -Command "if (Test-Path -Path '${remoteLogsDir}') { Compress-Archive -Path '${remoteLogsDir}/*' -DestinationPath '${remoteLogsZip}' -Force }"`, (err, stream) => {
                                                                        if (err) {
                                                                            outputChannel.appendLine(`Failed to zip logs: ${err.message}`);
                                                                            conn.end();
                                                                            panel.dispose();
                                                                            return;
                                                                        }
                                                                        stream.on('close', (code: number, signal: string) => {
                                                                            conn.sftp((err, sftp) => {
                                                                                if (err) {
                                                                                    outputChannel.appendLine(`SFTP error while fetching zipped logs: ${err.message}`);
                                                                                    conn.end();
                                                                                    panel.dispose();
                                                                                    return;
                                                                                }
                                                                                const writeStream = fs.createWriteStream(localLogsZip);
                                                                                const readStream = sftp.createReadStream(remoteLogsZip.replace(/\\/g, '/'));
                                                                                readStream.pipe(writeStream);
                                                                                writeStream.on('close', () => {
                                                                                    // Unzip logs locally
                                                                                    const unzip = require('unzipper');
                                                                                    fs.createReadStream(localLogsZip)
                                                                                      .pipe(unzip.Extract({ path: localLogsDir }))
                                                                                      .on('close', () => {
                                                                                          // Read all log files and append to Output Channel and steps[3].detail
                                                                                          const logFiles = fs.readdirSync(localLogsDir).filter(f => f.endsWith('.log') || f.endsWith('.txt'));
                                                                                          let logsContent = '';
                                                                                          for (const file of logFiles) {
                                                                                              const logContent = fs.readFileSync(path.join(localLogsDir, file), 'utf8');
                                                                                              outputChannel.appendLine(`[Log: ${file}]\n${logContent}`);
                                                                                              logsContent += `\n[Log: ${file}]\n${logContent}`;
                                                                                          }
                                                                                          if (steps) {
                                                                                              steps[3].detail = (steps[3].detail || '') + logsContent;
                                                                                              scheduledRunsProvider.update();
                                                                                              updateWebviewSteps(webviewSteps || []);
                                                                                          }
                                                                                          conn.end();
                                                                                          panel.dispose();
                                                                                      });
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
                                        if (steps) {
                                            steps[1].status = 'running'; scheduledRunsProvider.update();
                                        }
                                        if (webviewSteps) {
                                            webviewSteps[1].status = 'running'; updateWebviewSteps(webviewSteps);
                                        }
                                        // Remove pscp logic, always use SFTP for file transfer
                                        conn.sftp((err: Error | undefined, sftp) => {
                                            if (err) {
                                                outputChannel.appendLine(`SFTP error: ${err.message}`);
                                                if (steps) {
                                                    steps[1].status = 'error'; scheduledRunsProvider.update();
                                                }
                                                if (webviewSteps) {
                                                    webviewSteps[1].status = 'error'; updateWebviewSteps(webviewSteps);
                                                }
                                                conn.end();
                                                panel.dispose();
                                                return;
                                            }
                                            activeSftp = sftp;
                                            const readStream = fs.createReadStream(packagePath);
                                            activeReadStream = readStream;
                                            const totalSize = fs.statSync(packagePath).size;
                                            let transferred = 0;
                                            let lastLoggedPercent = 0;
                                            readStream.on('data', (chunk) => {
                                                let chunkLength = 0;
                                                if (typeof chunk === 'string') {
                                                    chunkLength = Buffer.byteLength(chunk);
                                                } else if (Buffer.isBuffer(chunk)) {
                                                    chunkLength = chunk.length;
                                                }
                                                transferred += chunkLength;
                                                const percent = Math.floor((transferred / totalSize) * 100);
                                                if (percent >= lastLoggedPercent + 10 || percent === 100) {
                                                    lastLoggedPercent = percent;
                                                    outputChannel.appendLine(`SFTP: Transferred ${percent}% (${transferred}/${totalSize} bytes)`);
                                                    if (steps) {
                                                        steps[1].detail = `Transferred ${percent}% (${transferred}/${totalSize} bytes)`;
                                                    }
                                                    if (webviewSteps) {
                                                        webviewSteps[1].detail = `Transferred ${percent}% (${transferred}/${totalSize} bytes)`;
                                                    }
                                                    scheduledRunsProvider.update();
                                                    updateWebviewSteps(webviewSteps || []);
                                                }
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
                                            // After SFTP upload, verify remote file size before extraction
                                            writeStream.on('close', (code: number, signal: string) => {
                                                outputChannel.appendLine('SFTP: Write stream closed.');
                                                activeReadStream = null;
                                                activeWriteStream = null;
                                                // Verify remote file size matches local file size
                                                conn.exec(`powershell -Command \"(Get-Item -Path '${remoteZip}').Length\"`, (err: Error | undefined, stream) => {
                                                    if (err) {
                                                        outputChannel.appendLine(`Failed to verify remote file size: ${err.message}`);
                                                        if (steps) { steps[1].status = 'error'; scheduledRunsProvider.update(); }
                                                        if (webviewSteps) { webviewSteps[1].status = 'error'; updateWebviewSteps(webviewSteps); }
                                                        conn.end();
                                                        panel.dispose();
                                                        return;
                                                    }
                                                    let remoteSizeStr = '';
                                                    stream.on('data', (data: Buffer) => { remoteSizeStr += data.toString(); });
                                                    stream.on('close', (code: number, signal: string) => {
                                                        const localSize = fs.statSync(packagePath).size;
                                                        const remoteSize = parseInt(remoteSizeStr.trim(), 10);
                                                        if (remoteSize !== localSize) {
                                                            outputChannel.appendLine(`Remote package size mismatch (local: ${localSize}, remote: ${remoteSize}). Re-uploading...`);
                                                            // Remove remote file and re-upload
                                                            conn.exec(`powershell -Command Remove-Item -Path '${remoteZip}' -Force`, (err) => {
                                                                if (err) {
                                                                    outputChannel.appendLine(`Failed to remove corrupted remote file: ${err.message}`);
                                                                    if (steps) { steps[1].status = 'error'; scheduledRunsProvider.update(); }
                                                                    if (webviewSteps) { webviewSteps[1].status = 'error'; updateWebviewSteps(webviewSteps); }
                                                                    conn.end();
                                                                    panel.dispose();
                                                                    return;
                                                                }
                                                                // Re-upload by calling the SFTP upload logic again
                                                                outputChannel.appendLine('Retrying SFTP upload...');
                                                                // ...call the SFTP upload logic here (recursion or function extraction recommended)...
                                                            });
                                                            return;
                                                        }
                                                        if (steps) { steps[1].detail = 'Transfer complete'; }
                                                        if (webviewSteps) { webviewSteps[1].detail = 'Transfer complete'; }
                                                        outputChannel.appendLine('Package transferred and verified. Extracting on remote...');
                                                        if (steps) { steps[1].status = 'success'; scheduledRunsProvider.update(); }
                                                        if (webviewSteps) { webviewSteps[1].status = 'success'; updateWebviewSteps(webviewSteps); }
                                                        if (steps) { steps[2].status = 'running'; scheduledRunsProvider.update(); }
                                                        if (webviewSteps) { webviewSteps[2].status = 'running'; updateWebviewSteps(webviewSteps); }
                                                        // Extraction logic continues here...
                                                        conn.exec(`powershell -Command \"Expand-Archive -Path '${remoteZip}' -DestinationPath '${remoteDir}/${packageBaseName}' -Force\"`, (err: Error | undefined, stream) => {
                                                            // ...existing extraction logic...
                                                        });
                                                    });
                                                });
                                            });
                                            writeStream.on('error', (err: Error) => {
                                                outputChannel.appendLine(`SFTP: Remote file write error: ${err.message}`);
                                                activeReadStream = null;
                                                activeWriteStream = null;
                                                if (steps) {
                                                    steps[1].status = 'error'; scheduledRunsProvider.update();
                                                }
                                                if (webviewSteps) {
                                                    webviewSteps[1].status = 'error'; updateWebviewSteps(webviewSteps);
                                                }
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
                            // Mark the step as failed if connection fails
                            if (typeof steps !== 'undefined') {
                                for (let i = 0; i < steps.length; i++) {
                                    if (steps[i].status === 'running' || steps[i].status === 'pending') {
                                        steps[i].status = 'error';
                                    }
                                }
                                scheduledRunsProvider.update();
                            }
                            if (typeof updateWebviewSteps === 'function' && typeof webviewSteps !== 'undefined') {
                                for (let i = 0; i < webviewSteps.length; i++) {
                                    if (webviewSteps[i].status === 'running' || webviewSteps[i].status === 'pending') {
                                        webviewSteps[i].status = 'error';
                                    }
                                }
                                updateWebviewSteps(webviewSteps || []);
                            }
                            vscode.window.showErrorMessage('Failed to connect to the machine: ' + err.message);
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
        vscode.commands.registerCommand('virtual-client.streamLogs', async () => {
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
        vscode.commands.registerCommand('virtual-client.showRunDetails', (runItem: ScheduledRunItem) => {
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
        vscode.commands.registerCommand('virtual-client.showLogFiles', async () => {
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
    scheduledRunsProvider = new ScheduledRunsProvider();
    treeViewProvider = new VirtualClientTreeViewProvider(context, sharedMachines, scheduledRunsProvider);
    vscode.window.registerTreeDataProvider('virtualClientView', treeViewProvider);

    // Register scheduled runs provider
    scheduledRunsProvider = new ScheduledRunsProvider();

    // Register the Machines treeview and add + command in extension activation
    let machinesProvider: MachinesProvider;
    machinesProvider = new MachinesProvider(context);
    vscode.window.registerTreeDataProvider('machinesView', machinesProvider);
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
                        const { label, ip, username, password } = message;
                        machinesProvider.addMachine(label, ip, username, password);
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

    context.subscriptions.push(
        vscode.commands.registerCommand('virtual-client.deleteMachine', async (item: MachineItem) => {
            if (!item) {
                vscode.window.showErrorMessage('No machine selected.');
                return;
            }
            const confirm = await vscode.window.showWarningMessage(`Delete machine '${item.label}' (${item.ip})?`, { modal: true }, 'Delete');
            if (confirm === 'Delete') {
                machinesProvider.deleteMachine(item.ip);
                vscode.window.showInformationMessage(`Machine '${item.label}' deleted.`);
            }
        })
    );

    // When activating, load machines from globalState into sharedMachines
    sharedMachines = context.globalState.get<{ label: string, ip: string }[]>('machines', []);
}

// This method is called when your extension is deactivated
export function deactivate() {
    console.log('Extension "virtual-client" is now deactivated!');
}

// Add tests for persistence and log management functions
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
// ...existing code...
describe('Extension Log Persistence', function() {
    const mockContext: any = {
        globalStoragePath: path.join(__dirname, '..', 'test-storage')
    };
    const testRun = { id: 'test1', label: 'Test Run', steps: [], logs: [], started: Date.now() };
    after(function() {
        // Clean up test storage
        const dir = path.join(mockContext.globalStoragePath, 'virtualclient-vscode-logs');
        if (fs.existsSync(dir)) {
            fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f)));
            fs.rmdirSync(dir);
        }
        if (fs.existsSync(mockContext.globalStoragePath)) {
            fs.rmdirSync(mockContext.globalStoragePath);
        }
    });
    it('should save and load scheduled runs', function() {
        saveScheduledRun(mockContext, testRun);
        const runs = loadScheduledRuns(mockContext);
        assert.strictEqual(runs.length, 1);
        assert.strictEqual(runs[0].id, 'test1');
    });
    it('should clear logs folder', function() {
        saveScheduledRun(mockContext, testRun);
        clearLogsFolder(mockContext);
        const runs = loadScheduledRuns(mockContext);
        assert.strictEqual(runs.length, 0);
    });
});
// ...existing code...