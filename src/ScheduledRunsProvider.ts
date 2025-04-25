import * as vscode from 'vscode';

export class ScheduledRunStep {
    constructor(
        public readonly label: string,
        public status: 'pending' | 'running' | 'success' | 'error',
        public detail?: string
    ) {}
}

export class ScheduledRunItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public steps: ScheduledRunStep[],
        public readonly timestamp: Date,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(`${label} (${timestamp.toLocaleString()})`, collapsibleState);
        this.contextValue = 'scheduledRun';
    }
}

export class ScheduledRunsProvider implements vscode.TreeDataProvider<ScheduledRunItem | ScheduledRunStep> {
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

    addRun(machineLabel: string, machineIp: string, steps: ScheduledRunStep[]): ScheduledRunItem {
        const timestamp = new Date();
        const label = `${timestamp.toLocaleString()} ${machineLabel}(${machineIp})`;
        const run = new ScheduledRunItem(label, steps, timestamp, vscode.TreeItemCollapsibleState.Expanded);
        this.runs.unshift(run);
        this._onDidChangeTreeData.fire();
        return run;
    }

    update(): void {
        this._onDidChangeTreeData.fire();
    }
}
