import * as vscode from 'vscode';

export class MachineItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly ip: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
    }
}

export class VirtualClientTreeViewProvider implements vscode.TreeDataProvider<MachineItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<MachineItem | undefined | void> = new vscode.EventEmitter<MachineItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<MachineItem | undefined | void> = this._onDidChangeTreeData.event;

    private machines: MachineItem[] = [];

    constructor(private context: vscode.ExtensionContext) {}

    getTreeItem(element: MachineItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: MachineItem): Thenable<MachineItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return Promise.resolve(this.machines);
        }
    }

    addMachine(label: string, ip: string) {
        const machine = new MachineItem(label, ip, vscode.TreeItemCollapsibleState.None, 'machine');
        this.machines.push(machine);
        this._onDidChangeTreeData.fire();
    }
}

// --- Machines List Treeview ---
export class MachinesTreeViewProvider implements vscode.TreeDataProvider<MachineItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<MachineItem | undefined | void> = new vscode.EventEmitter<MachineItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<MachineItem | undefined | void> = this._onDidChangeTreeData.event;
    private machines: MachineItem[] = [];
    constructor(private context: vscode.ExtensionContext) {
        const saved = this.context.globalState.get<{label: string, ip: string}[]>('machines', []);
        this.machines = saved.map(m => new MachineItem(m.label, m.ip, vscode.TreeItemCollapsibleState.None, 'machine'));
    }
    getTreeItem(element: MachineItem): vscode.TreeItem {
        return element;
    }
    getChildren(element?: MachineItem): Thenable<MachineItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return Promise.resolve(this.machines);
        }
    }
    addMachine(label: string, ip: string) {
        this.machines.push(new MachineItem(label, ip, vscode.TreeItemCollapsibleState.None, 'machine'));
        this.context.globalState.update('machines', this.machines.map(m => ({label: m.label, ip: m.ip})));
        this._onDidChangeTreeData.fire();
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
}

export function getAddMachineWebviewContent() {
    return `
        <html>
            <body>
                <h1>Add Machine</h1>
                <form>
                    <label for="label">Label:</label>
                    <input type="text" id="label" name="label"><br><br>
                    <label for="ip">IP Address:</label>
                    <input type="text" id="ip" name="ip"><br><br>
                    <input type="submit" value="Add Machine">
                </form>
            </body>
        </html>
    `;
}

export function getRunVirtualClientWebviewContent(label: string, ip: string, lastParams: any, steps: any[]) {
    return `
        <html>
            <body>
                <h1>Run Virtual Client</h1>
                <p>Label: ${label}</p>
                <p>IP Address: ${ip}</p>
                <p>Last Parameters: ${JSON.stringify(lastParams)}</p>
                <p>Steps: ${JSON.stringify(steps)}</p>
            </body>
        </html>
    `;
}