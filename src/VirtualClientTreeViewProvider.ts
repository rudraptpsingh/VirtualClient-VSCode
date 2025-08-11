import * as vscode from 'vscode';
import { MachineItem } from './machinesProvider';
import { ScheduledRunItem, ScheduledRunStep, ScheduledRunsProvider } from './ScheduledRunsProvider';
import { Logger, LogLevel } from './types';

/**
 * Provides the main tree view for the Virtual Client extension, showing machines and scheduled runs.
 */
export class VirtualClientTreeViewProvider
    implements vscode.TreeDataProvider<MachineItem | ScheduledRunItem | ScheduledRunStep>
{
    private _onDidChangeTreeData: vscode.EventEmitter<
        MachineItem | ScheduledRunItem | ScheduledRunStep | undefined | void
    > = new vscode.EventEmitter<MachineItem | ScheduledRunItem | ScheduledRunStep | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<MachineItem | ScheduledRunItem | ScheduledRunStep | undefined | void> =
        this._onDidChangeTreeData.event;

    private context: vscode.ExtensionContext;
    private sharedMachines: { label: string; ip: string }[];
    private scheduledRunsProvider: ScheduledRunsProvider;
    private logger: Logger;

    constructor(
        context: vscode.ExtensionContext,
        sharedMachines: { label: string; ip: string }[],
        scheduledRunsProvider: ScheduledRunsProvider,
        logger?: Logger
    ) {
        this.context = context;
        this.sharedMachines = sharedMachines;
        this.scheduledRunsProvider = scheduledRunsProvider;
        this.logger = logger || new Logger(LogLevel.Info);
        this.scheduledRunsProvider.onDidChangeTreeData(() => this._onDidChangeTreeData.fire(undefined));
    }

    public get machines(): MachineItem[] {
        const machines = this.context.globalState.get<{ label: string; ip: string }[]>('machines', []);
        return machines.map(m => new MachineItem(m.label, m.ip, vscode.TreeItemCollapsibleState.Collapsed, 'machine'));
    }

    getTreeItem(element: MachineItem | ScheduledRunItem | ScheduledRunStep): vscode.TreeItem {
        if (element instanceof MachineItem && element.contextValue === 'addMachine') {
            element.command = {
                command: 'virtual-client.addMachineWebview',
                title: 'Add New Machine',
                arguments: [],
            };
        }
        if (element instanceof MachineItem && element.contextValue === 'machine') {
            element.command = {
                command: 'virtual-client.runVirtualClientWebview',
                title: 'Run Virtual Client',
                arguments: [element],
            };
        }
        if (element instanceof ScheduledRunItem || element instanceof ScheduledRunStep) {
            return this.scheduledRunsProvider.getTreeItem(element);
        }
        return element;
    }

    getChildren(
        element?: MachineItem | ScheduledRunItem | ScheduledRunStep
    ): Promise<(MachineItem | ScheduledRunItem | ScheduledRunStep)[]> {
        if (!element) {
            this.logger.debug('Getting root machine nodes');
            // Only show machines that have scheduled runs
            const machinesWithRuns = this.machines.filter(machine => {
                const runs = this.scheduledRunsProvider.getRunsForMachine(machine.ip);
                return runs.length > 0;
            });
            return Promise.resolve(machinesWithRuns);
        }
        if (element instanceof MachineItem && element.contextValue === 'machine') {
            this.logger.debug(`Getting scheduled runs for machine: ${element.label} (${element.ip})`);
            const runs = this.scheduledRunsProvider.getRunsForMachine(element.ip);
            return Promise.resolve(runs);
        }
        if (element instanceof ScheduledRunItem) {
            this.logger.debug(`Getting steps for run: ${element.label}`);
            return this.scheduledRunsProvider.getChildren(element) as Promise<ScheduledRunStep[]>;
        }
        if (element instanceof ScheduledRunStep && element.substeps) {
            return Promise.resolve(element.substeps);
        }
        return Promise.resolve([]);
    }

    /**
     * Refreshes the tree view.
     */
    refresh(): void {
        try {
            this._onDidChangeTreeData.fire();
        } catch (error) {
            this.logger.error(`Failed to refresh tree data: ${error}`);
        }
    }

    getTreeViewActions(): vscode.Command[] {
        return [
            {
                command: 'virtual-client.clearScheduledRuns',
                title: 'Clear',
                tooltip: 'Clear all scheduled runs and logs',
                arguments: [],
            },
        ];
    }
}
