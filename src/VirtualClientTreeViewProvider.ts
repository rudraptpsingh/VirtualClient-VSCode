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
            // Only show Scheduled Runs node in Virtual Client view
            const scheduledRunsNode = new MachineItem('Scheduled Runs', '', vscode.TreeItemCollapsibleState.Collapsed, 'scheduledRunsRoot');
            // Cast to ScheduledRunItem | ScheduledRunStep to satisfy type
            return Promise.resolve([scheduledRunsNode as unknown as ScheduledRunItem]);
        }
        if (element instanceof MachineItem && element.contextValue === 'scheduledRunsRoot') {
            // Return scheduled runs as children
            return this.scheduledRunsProvider.getChildren() as Promise<ScheduledRunItem[]>;
        }
        if (element instanceof ScheduledRunItem) {
            return this.scheduledRunsProvider.getChildren(element) as Promise<ScheduledRunStep[]>;
        }
        return Promise.resolve([]);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }
}
