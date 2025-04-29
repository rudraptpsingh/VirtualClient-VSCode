import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ssh2 from 'ssh2';
import { MachineItem } from './machinesProvider';
import { ScheduledRunItem, ScheduledRunsProvider, ScheduledRunStep } from './ScheduledRunsProvider';
import { getAddMachineWebviewContent, getRunVirtualClientWebviewContent, showRunDetailsWebview } from './webviewContent';
import { MachinesProvider } from './machinesProvider';
import { scheduledRunsProvider } from './extension';

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
            try { this.readStream.destroy(); } catch {}
            this.readStream = null;
        }
        if (this.writeStream) {
            try { this.writeStream.destroy(); } catch {}
            this.writeStream = null;
        }
        if (this.sftp) {
            try { this.sftp.end(); } catch {}
            this.sftp = null;
        }
        if (this.conn) {
            try { this.conn.end(); } catch {}
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
export function cleanupResources(resources: ActiveResources) {
    if (resources.readStream) {
        try { resources.readStream.destroy(); } catch {}
        resources.readStream = null;
    }
    if (resources.writeStream) {
        try { resources.writeStream.destroy(); } catch {}
        resources.writeStream = null;
    }
    if (resources.sftp) {
        try { resources.sftp.end(); } catch {}
        resources.sftp = null;
    }
    if (resources.conn) {
        try { resources.conn.end(); } catch {}
        resources.conn = null;
    }
}

// Command handlers
export async function handleAddMachine(
    context: vscode.ExtensionContext,
    machinesProvider: any
): Promise<void> {
    const resources: ActiveResources = {
        panel: undefined,
        conn: null,
        sftp: null,
        readStream: null,
        writeStream: null
    };

    try {
        resources.panel = vscode.window.createWebviewPanel(
            'addMachine',
            'Add New Machine',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

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
                    vscode.window.showErrorMessage(`Failed to add machine: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            },
            undefined,
            context.subscriptions
        );

        resources.panel.onDidDispose(() => {
            cleanupResources(resources);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create add machine panel: ${error instanceof Error ? error.message : 'Unknown error'}`);
        cleanupResources(resources);
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
        vscode.window.showErrorMessage(`Failed to delete machine: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function handleShowRunDetails(
    context: vscode.ExtensionContext,
    runItem: ScheduledRunItem
): Promise<void> {
    try {
        const persistentRuns = context.globalState.get<any[]>('persistentRuns', []);
        const found = persistentRuns.find(r => r.id === runItem.label);
        
        if (found) {
            await showRunDetailsWebview(context, found);
        } else {
            vscode.window.showWarningMessage('Run details not found.');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to show run details: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function handleStreamLogs(context: vscode.ExtensionContext): Promise<void> {
    try {
        const platform = await vscode.window.showQuickPick(
            ['win-x64', 'win-arm64'],
            { placeHolder: 'Select the platform' }
        );

        if (!platform) {
            vscode.window.showInformationMessage('Platform selection cancelled.');
            return;
        }

        // ... implement log streaming logic ...
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to stream logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function handleShowLogFiles(context: vscode.ExtensionContext): Promise<void> {
    try {
        const logType = await vscode.window.showQuickPick([
            { label: 'Traces', ext: '.traces' },
            { label: 'Metrics', ext: '.metrics' },
            { label: 'Events', ext: '.events' }
        ], { placeHolder: 'Select log type to view' });

        if (!logType) {
            return;
        }

        const logsDir = path.join(context.globalStoragePath, 'logs');
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
            placeHolder: `Select a ${logType.label.toLowerCase()} file`
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
        vscode.window.showErrorMessage(`Failed to show log files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
} 