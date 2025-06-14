import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { Logger, LogLevel } from './types';

/**
 * Represents a step in a scheduled run.
 */
export class ScheduledRunStep {
    constructor(
        public readonly label: string,
        public status: 'pending' | 'running' | 'success' | 'error',
        public detail?: string,
        public substeps?: ScheduledRunStep[]
    ) {}
}

/**
 * Represents a scheduled run item in the tree view.
 */
export class ScheduledRunItem extends vscode.TreeItem {
    constructor(
        public readonly runId: string,
        public readonly label: string,
        public readonly machineIp: string,
        public readonly packagePath: string,
        public readonly platform: string,
        public readonly profile: string,
        public readonly system: string,
        public readonly timeout: number,
        public readonly exitWait: number,
        public readonly proxyApi: string,
        public readonly packageStore: string,
        public readonly eventHub: string,
        public readonly experimentId: string,
        public readonly clientId: string,
        public readonly metadata: string,
        public readonly parameters: string,
        public readonly port: string,
        public readonly ipAddress: string,
        public readonly logToFile: boolean,
        public readonly clean: boolean,
        public readonly debug: boolean,
        public readonly dependencies: string,
        public readonly iterations: number,
        public readonly logLevel: string,
        public readonly failFast: boolean,
        public readonly steps: ScheduledRunStep[],
        public readonly timestamp: Date,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.contextValue = 'scheduledRun';
    }
}

/**
 * Provides the tree data for scheduled runs.
 */
export class ScheduledRunsProvider implements vscode.TreeDataProvider<ScheduledRunItem | ScheduledRunStep> {
    private _onDidChangeTreeData: vscode.EventEmitter<ScheduledRunItem | ScheduledRunStep | undefined | void> = new vscode.EventEmitter<ScheduledRunItem | ScheduledRunStep | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ScheduledRunItem | ScheduledRunStep | undefined | void> = this._onDidChangeTreeData.event;
    private runs: ScheduledRunItem[] = [];
    private logger: Logger;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext, logger?: Logger) {
        this.context = context;
        this.logger = logger || new Logger(LogLevel.Info);
    }

    getTreeItem(element: ScheduledRunItem | ScheduledRunStep): vscode.TreeItem {
        if (element instanceof ScheduledRunItem) {
            return element;
        } else {
            const item = new vscode.TreeItem(
                element.label,
                element.substeps && element.substeps.length > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None
            );
            item.description = element.status;
            item.iconPath = new vscode.ThemeIcon(
                element.status === 'success' ? 'check' :
                element.status === 'error' ? 'error' :
                element.status === 'running' ? 'loading~spin' : 'clock'
            );
            if (element.detail) { item.tooltip = element.detail; }
            if (element.label === 'Logs') {
                item.command = {
                    title: 'Open Log File',
                    command: 'virtual-client.openLogFile',
                    arguments: [element]
                };
                item.iconPath = new vscode.ThemeIcon('output');
            }
            if (element.label && element.label.startsWith('Log: ')) {
                item.command = {
                    title: 'Open Log File',
                    command: 'virtual-client.openLogFile',
                    arguments: [element]
                };
                item.iconPath = new vscode.ThemeIcon('file');
            }
            if (element.label === 'Extract Logs Locally') {
                item.command = {
                    title: 'Download logs.zip',
                    command: 'virtual-client.downloadLogsZip',
                    arguments: [element]
                };
                item.iconPath = new vscode.ThemeIcon('cloud-download');
            }
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
        if (element instanceof ScheduledRunStep && element.substeps) {
            return Promise.resolve(element.substeps);
        }
        return Promise.resolve([]);
    }

    /**
     * Helper to generate run label (timestamp + IP, with dots in IP, safe for filesystem)
     */
    public static getRunLabel(date: Date, ip: string): string {
        const y = date.getFullYear();
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const d = date.getDate().toString().padStart(2, '0');
        const h = date.getHours().toString().padStart(2, '0');
        const min = date.getMinutes().toString().padStart(2, '0');
        const s = date.getSeconds().toString().padStart(2, '0');
        // Only remove forbidden filename chars, keep dots in IP
        const safeIp = ip.replace(/[^\d.]/g, '');
        return `${y}${m}${d}_${h}${min}${s}_${safeIp}`;
    }

    addRun(
        machineIp: string,
        packagePath: string,
        platform: string,
        profile: string,
        system: string,
        timeout: number,
        exitWait: number,
        proxyApi: string,
        packageStore: string,
        eventHub: string,
        experimentId: string,
        clientId: string,
        metadata: string,
        parameters: string,
        port: string,
        ipAddress: string,
        logToFile: boolean,
        clean: boolean,
        debug: boolean,
        dependencies: string,
        iterations: number,
        logLevel: string,
        failFast: boolean,
        steps?: ScheduledRunStep[],
        timestamp?: Date
    ): ScheduledRunItem {
        const runTimestamp = timestamp || new Date();
        const runSteps = steps || [
            new ScheduledRunStep('Initialize Run', 'pending'),
            new ScheduledRunStep('Prepare Remote Environment', 'pending'),
            new ScheduledRunStep('Upload & Extract Package', 'pending'),
            new ScheduledRunStep('Execute Virtual Client', 'pending'),
            new ScheduledRunStep('Logs', 'pending')
        ];
        // Use unified label logic
        const label = ScheduledRunsProvider.getRunLabel(runTimestamp, machineIp);
        const runId = uuidv4();
        const run = new ScheduledRunItem(
            runId,
            label,
            machineIp,
            packagePath,
            platform,
            profile,
            system,
            timeout,
            exitWait,
            proxyApi,
            packageStore,
            eventHub,
            experimentId,
            clientId,
            metadata,
            parameters,
            port,
            ipAddress,
            logToFile,
            clean,
            debug,
            dependencies,
            iterations,
            logLevel,
            failFast,
            runSteps,
            runTimestamp,
            vscode.TreeItemCollapsibleState.Expanded
        );
        this.runs.unshift(run);
        this._onDidChangeTreeData.fire();
        return run;
    }

    /**
     * Updates the tree view.
     */
    update(): void {
        try {
            this._onDidChangeTreeData.fire();
        } catch (error) {
            this.logger.error(`Failed to update tree data: ${error}`);
        }
    }

    clear(): void {
        this.runs = [];
        this._onDidChangeTreeData.fire(undefined);
    }

    getRun(runId: string): ScheduledRunItem | undefined {
        return this.runs.find(run => run.runId === runId);
    }

    removeRun(runId: string): void {
        const index = this.runs.findIndex(run => run.runId === runId);
        if (index !== -1) {
            const run = this.runs[index];
            this.runs.splice(index, 1);
            this._onDidChangeTreeData.fire();
            // --- Remove log file and log folder using unified label logic ---
            const path = require('path');
            const fsPromises = require('fs').promises;
            (async () => {
                try {
                    // Use the logsDir from the extension context
                    const logsDir = path.join(this.context.globalStorageUri.fsPath, 'logs');
                    const logLabel = ScheduledRunsProvider.getRunLabel(run.timestamp, run.machineIp);
                    const logFilePath = path.join(logsDir, `${logLabel}.log`);
                    try { await fsPromises.unlink(logFilePath); } catch (e) { this.logger.warn(`Could not delete log file: ${logFilePath}`); }
                    // Remove log folder (recursively)
                    const logFolderPath = path.join(logsDir, logLabel);
                    async function deleteDirRecursive(dir: string) {
                        try {
                            const entries = await fsPromises.readdir(dir, { withFileTypes: true });
                            for (const entry of entries) {
                                const fullPath = path.join(dir, entry.name);
                                if (entry.isDirectory()) {
                                    await deleteDirRecursive(fullPath);
                                    await fsPromises.rmdir(fullPath).catch(() => {});
                                } else {
                                    await fsPromises.unlink(fullPath).catch(() => {});
                                }
                            }
                            await fsPromises.rmdir(dir).catch(() => {});
                        } catch (err) {
                            // Directory may not exist, ignore
                        }
                    }
                    await deleteDirRecursive(logFolderPath);
                } catch (err) {
                    this.logger.warn('Failed to delete log file/folder for removed run: ' + err);
                }
            })();
        }
    }

    /**
     * Returns all scheduled runs for a given machine IP.
     */
    public getRunsForMachine(machineIp: string): ScheduledRunItem[] {
        return this.runs.filter(run => run.machineIp === machineIp);
    }
}
