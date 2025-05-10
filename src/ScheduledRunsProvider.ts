import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { Logger, LogLevel } from './types';

export class ScheduledRunStep {
    constructor(
        public readonly label: string,
        public status: 'pending' | 'running' | 'success' | 'error',
        public detail?: string,
        public substeps?: ScheduledRunStep[]
    ) {}
}

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

export class ScheduledRunsProvider implements vscode.TreeDataProvider<ScheduledRunItem | ScheduledRunStep> {
    private _onDidChangeTreeData: vscode.EventEmitter<ScheduledRunItem | ScheduledRunStep | undefined | void> = new vscode.EventEmitter<ScheduledRunItem | ScheduledRunStep | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ScheduledRunItem | ScheduledRunStep | undefined | void> = this._onDidChangeTreeData.event;
    private runs: ScheduledRunItem[] = [];
    private logger: Logger;

    constructor(logger?: Logger) {
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
        const label = `${runTimestamp.toLocaleString()} ${machineIp}`;
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
            this.runs.splice(index, 1);
            this._onDidChangeTreeData.fire();
        }
    }

    /**
     * Returns all scheduled runs for a given machine IP.
     */
    public getRunsForMachine(machineIp: string): ScheduledRunItem[] {
        return this.runs.filter(run => run.machineIp === machineIp);
    }
}
