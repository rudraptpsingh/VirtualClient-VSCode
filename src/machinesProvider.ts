import * as vscode from 'vscode';

// Fix type: SharedMachinesType should be an array of objects, not an array type alias
interface SharedMachine { label: string; ip: string; }
type SharedMachinesType = SharedMachine[];
declare global {
    var sharedMachines: SharedMachinesType | undefined;
    var treeViewProvider: { refresh?: () => void } | undefined;
}

export class MachinesProvider implements vscode.TreeDataProvider<MachineItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<MachineItem | undefined | void> = new vscode.EventEmitter<MachineItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<MachineItem | undefined | void> = this._onDidChangeTreeData.event;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    getTreeItem(element: MachineItem): vscode.TreeItem {
        return element;
    }

    getChildren(): MachineItem[] {
        const machines = this.context.globalState.get<SharedMachine[]>('machines', []);
        return machines.map((m) => new MachineItem(m.label, m.ip, vscode.TreeItemCollapsibleState.None, 'machine'));
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    addMachine(label: string, ip: string, username?: string, password?: string): void {
        const machines = this.context.globalState.get<SharedMachine[]>('machines', []);
        machines.push({ label, ip });
        this.context.globalState.update('machines', machines);
        this.refresh();
        if (username && password) {
            this.context.secrets.store(`machine:${ip}:username`, username);
            this.context.secrets.store(`machine:${ip}:password`, password);
        }
    }

    deleteMachine(ip: string): void {
        let machines = this.context.globalState.get<SharedMachine[]>('machines', []);
        machines = machines.filter((m) => m.ip !== ip);
        this.context.globalState.update('machines', machines);
        this.refresh();
        this.context.secrets.delete(`machine:${ip}:username`);
        this.context.secrets.delete(`machine:${ip}:password`);
    }
}

// Export MachineItem if not already exported elsewhere
export class MachineItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly ip: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string
    ) {
        super(label, collapsibleState);
    }
}