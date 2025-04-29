import * as vscode from 'vscode';

// Fix type: SharedMachinesType should be an array of objects, not an array type alias
interface SharedMachine { label: string; ip: string; platform?: string; }
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

    async getChildren(): Promise<MachineItem[]> {
        const machines = this.context.globalState.get<SharedMachine[]>('machines', []);
        const machineItems: MachineItem[] = [];

        for (const machine of machines) {
            const credentials = await this.getMachineCredentials(machine.ip);
            machineItems.push(new MachineItem(
                machine.label,
                machine.ip,
                vscode.TreeItemCollapsibleState.None,
                'machine',
                credentials?.username,
                credentials?.password,
                machine.platform
            ));
        }

        return machineItems;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    async getMachineCredentials(ip: string): Promise<{ username: string; password: string } | undefined> {
        try {
            const username = await this.context.secrets.get(`machine:${ip}:username`);
            const password = await this.context.secrets.get(`machine:${ip}:password`);
            
            if (username && password) {
                return { username, password };
            }
            return undefined;
        } catch (error) {
            console.error(`Failed to get credentials for machine ${ip}:`, error);
            return undefined;
        }
    }

    async getMachineByIp(ip: string): Promise<MachineItem | undefined> {
        const machines = this.context.globalState.get<SharedMachine[]>('machines', []);
        const machine = machines.find(m => m.ip === ip);
        if (machine) {
            const credentials = await this.getMachineCredentials(ip);
            return new MachineItem(
                machine.label,
                machine.ip,
                vscode.TreeItemCollapsibleState.None,
                'machine',
                credentials?.username,
                credentials?.password,
                machine.platform
            );
        }
        return undefined;
    }

    async addMachine(label: string, ip: string, username?: string, password?: string, platform?: string): Promise<void> {
        try {
            const machines = this.context.globalState.get<SharedMachine[]>('machines', []);
            machines.push({ label, ip, platform });
            await this.context.globalState.update('machines', machines);
            
            if (username && password) {
                await this.context.secrets.store(`machine:${ip}:username`, username);
                await this.context.secrets.store(`machine:${ip}:password`, password);
            }
            
            this.refresh();
        } catch (error) {
            console.error(`Failed to add machine ${ip}:`, error);
            throw error;
        }
    }

    async deleteMachine(ip: string): Promise<void> {
        try {
            let machines = this.context.globalState.get<SharedMachine[]>('machines', []);
            machines = machines.filter((m) => m.ip !== ip);
            await this.context.globalState.update('machines', machines);
            
            await this.context.secrets.delete(`machine:${ip}:username`);
            await this.context.secrets.delete(`machine:${ip}:password`);
            
            this.refresh();
        } catch (error) {
            console.error(`Failed to delete machine ${ip}:`, error);
            throw error;
        }
    }
}

// Export MachineItem if not already exported elsewhere
export class MachineItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly ip: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly username?: string,
        public readonly password?: string,
        public readonly platform?: string
    ) {
        super(label, collapsibleState);
        this.description = ip;
        let tooltipParts = [];
        if (username) { tooltipParts.push(`Username: ${username}`); }
        if (platform) {tooltipParts.push(`Platform: ${platform}`); }
        this.tooltip = tooltipParts.length > 0 ? tooltipParts.join(' | ') : undefined;
    }
}