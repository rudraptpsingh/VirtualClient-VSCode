import * as vscode from 'vscode';
import { MachineItem } from './machinesProvider';
import { ScheduledRunItem, ScheduledRunStep, ScheduledRunsProvider } from './ScheduledRunsProvider';

export class VirtualClientTreeViewProvider implements vscode.TreeDataProvider<MachineItem | ScheduledRunItem | ScheduledRunStep> {
    private _onDidChangeTreeData: vscode.EventEmitter<MachineItem | ScheduledRunItem | ScheduledRunStep | undefined | void> = new vscode.EventEmitter<MachineItem | ScheduledRunItem | ScheduledRunStep | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<MachineItem | ScheduledRunItem | ScheduledRunStep | undefined | void> = this._onDidChangeTreeData.event;

    private context: vscode.ExtensionContext;
    private sharedMachines: { label: string, ip: string }[];
    private scheduledRunsProvider: ScheduledRunsProvider;

    constructor(context: vscode.ExtensionContext, sharedMachines: { label: string, ip: string }[], scheduledRunsProvider: ScheduledRunsProvider) {
        this.context = context;
        this.sharedMachines = sharedMachines;
        this.scheduledRunsProvider = scheduledRunsProvider;
        // Ensure tree view refreshes when provider updates
        this.scheduledRunsProvider.onDidChangeTreeData(() => this._onDidChangeTreeData.fire(undefined));
    }

    private logToFile(msg: string) {
        const logDir = this.context.globalStoragePath;
        const logFile = require('path').join(logDir, 'virtualClientTreeViewProvider.log');
        const fs = require('fs');
        const line = `[${new Date().toISOString()}] ${msg}\n`;
        try {
            fs.appendFileSync(logFile, line);
        } catch {}
    }

    public get machines(): MachineItem[] {
        // Always fetch the latest machines from global state
        const machines = this.context.globalState.get<{ label: string, ip: string }[]>('machines', []);
        return machines.map(m => new MachineItem(m.label, m.ip, vscode.TreeItemCollapsibleState.None, 'machine'));
    }

    getTreeItem(element: MachineItem | ScheduledRunItem | ScheduledRunStep): vscode.TreeItem {
        if (element instanceof MachineItem && element.contextValue === 'addMachine') {
            element.command = {
                command: 'virtual-client.addMachineWebview',
                title: 'Add New Machine',
                arguments: []
            };
        }
        if (element instanceof MachineItem && element.contextValue === 'machine') {
            element.command = {
                command: 'virtual-client.runVirtualClientWebview',
                title: 'Run Virtual Client',
                arguments: [element]
            };
        }
        if (element instanceof ScheduledRunItem || element instanceof ScheduledRunStep) {
            return this.scheduledRunsProvider.getTreeItem(element);
        }
        return element;
    }

    getChildren(element?: MachineItem | ScheduledRunItem | ScheduledRunStep): Promise<(MachineItem | ScheduledRunItem | ScheduledRunStep)[]> {
        if (!element) {
            this.logToFile('Getting root children');
            // Only show Scheduled Runs node in Virtual Client view
            const scheduledRunsNode = new MachineItem('Scheduled Runs', '', vscode.TreeItemCollapsibleState.Collapsed, 'scheduledRunsRoot');
            // Cast to ScheduledRunItem | ScheduledRunStep to satisfy type
            return Promise.resolve([scheduledRunsNode as unknown as ScheduledRunItem]);
        }
        if (element instanceof MachineItem && element.contextValue === 'scheduledRunsRoot') {
            this.logToFile('Getting scheduled runs');
            // Return scheduled runs as children
            return this.scheduledRunsProvider.getChildren() as Promise<ScheduledRunItem[]>;
        }
        if (element instanceof ScheduledRunItem) {
            this.logToFile(`Getting steps for run: ${element.label}`);
            return this.scheduledRunsProvider.getChildren(element) as Promise<ScheduledRunStep[]>;
        }
        if (element instanceof ScheduledRunStep && element.substeps) {
            return Promise.resolve(element.substeps);
        }
        return Promise.resolve([]);
    }

    refresh(): void {
        try {
            this._onDidChangeTreeData.fire();
        } catch (error) {
            this.logToFile(`Failed to refresh tree data: ${error}`);
        }
    }

    getTreeViewActions(): vscode.Command[] {
        return [
            {
                command: 'virtual-client.clearScheduledRuns',
                title: 'Clear',
                tooltip: 'Clear all scheduled runs and logs',
                arguments: []
            }
        ];
    }
}
