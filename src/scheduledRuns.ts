import * as vscode from 'vscode';

export class ScheduledRunStep {
    constructor(
        public label: string,
        public status: string,
        public detail?: string
    ) {}
}

export class ScheduledRunItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly steps: ScheduledRunStep[],
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

    getTreeItem(element: ScheduledRunItem | ScheduledRunStep): vscode.TreeItem {
        if (element instanceof ScheduledRunItem) {
            return element;
        } else {
            return new vscode.TreeItem(element.label);
        }
    }

    getChildren(element?: ScheduledRunItem | ScheduledRunStep): Thenable<(ScheduledRunItem | ScheduledRunStep)[]> {
        if (!element) {
            return Promise.resolve(this.runs);
        }
        if (element instanceof ScheduledRunItem) {
            return Promise.resolve(element.steps);
        }
        return Promise.resolve([]);
    }

    addRun(label: string, steps: ScheduledRunStep[]): ScheduledRunItem {
        const run = new ScheduledRunItem(label, steps, vscode.TreeItemCollapsibleState.Collapsed);
        this.runs.push(run);
        this._onDidChangeTreeData.fire();
        return run;
    }

    update() {
        this._onDidChangeTreeData.fire();
    }
}

export {};
