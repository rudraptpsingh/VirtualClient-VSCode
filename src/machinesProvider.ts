import * as vscode from 'vscode';
import * as ssh2 from 'ssh2';
import { Logger, LogLevel } from './types';

interface SharedMachine { label: string; ip: string; platform?: string; }
type SharedMachinesType = SharedMachine[];

/**
 * Provides the tree data for the Machines view.
 */
export class MachinesProvider implements vscode.TreeDataProvider<MachineItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<MachineItem | undefined | void> = new vscode.EventEmitter<MachineItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<MachineItem | undefined | void> = this._onDidChangeTreeData.event;
    private context: vscode.ExtensionContext;
    private machineStatus: { [ip: string]: 'unknown' | 'connected' | 'unreachable' | 'fetching' } = {};
    private isRefreshing: boolean = false;
    private logger: Logger;

    constructor(context: vscode.ExtensionContext, logger?: Logger) {
        this.context = context;
        this.logger = logger || new Logger(LogLevel.Info);
    }

    getTreeItem(element: MachineItem): vscode.TreeItem {
        const status = this.machineStatus[element.ip] || 'unknown';
        if (status === 'fetching') {
            element.iconPath = new vscode.ThemeIcon('loading~spin');
        } else if (status === 'connected') {
            element.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
        } else if (status === 'unreachable') {
            element.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconFailed'));
        } else {
            element.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconQueued'));
        }
        return element;
    }

    async getChildren(): Promise<MachineItem[]> {
        const machines = this.context.globalState.get<SharedMachine[]>('machines', []);
        const machineItems: MachineItem[] = [];

        for (const machine of machines) {
            const credentials = await this.getMachineCredentials(machine.ip);
            const item = new MachineItem(
                machine.label,
                machine.ip,
                vscode.TreeItemCollapsibleState.None,
                'machine',
                credentials?.username,
                credentials?.password,
                machine.platform
            );
            item.connectionStatus = this.machineStatus[machine.ip] || 'unknown';
            machineItems.push(item);
        }

        return machineItems;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Gets the credentials for a machine by IP address.
     * @param ip The IP address of the machine.
     * @returns The credentials or undefined if not found.
     */
    async getMachineCredentials(ip: string): Promise<{ username: string; password: string } | undefined> {
        try {
            const username = await this.context.secrets.get(`machine:${ip}:username`);
            const password = await this.context.secrets.get(`machine:${ip}:password`);
            
            if (username && password) {
                return { username, password };
            }
            return undefined;
        } catch (error) {
            this.logger.error(`Failed to get credentials for machine ${ip}: ${error}`);
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

    /**
     * Adds a new machine to the global state and stores credentials securely.
     * @param label The label for the machine.
     * @param ip The IP address.
     * @param username The username.
     * @param password The password.
     * @param platform The platform (optional).
     */
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
            await this.refreshConnectionStatusForMachine(ip);
        } catch (error) {
            this.logger.error(`Failed to add machine ${label} (${ip}): ${error}`);
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
            this.logger.error(`Failed to delete machine ${ip}: ${error}`);
            throw error;
        }
    }

    async refreshConnectionStatus(): Promise<void> {
        if (this.isRefreshing) {
            return;
        }
        this.isRefreshing = true;
        try {
            const machines = this.context.globalState.get<SharedMachine[]>('machines', []);
            for (const machine of machines) {
                this.machineStatus[machine.ip] = 'fetching';
            }
            this.refresh();

            await Promise.all(machines.map(machine => this._refreshStatusForMachine(machine)));
            this.refresh();
        } finally {
            this.isRefreshing = false;
        }
    }

    private async _refreshStatusForMachine(machine: SharedMachine): Promise<void> {
        this.machineStatus[machine.ip] = 'fetching';
        const credentials = await this.getMachineCredentials(machine.ip);
        if (!credentials) {
            this.machineStatus[machine.ip] = 'unreachable';
            return;
        }
        const conn = new ssh2.Client();
        let isResolved = false;
        try {
            const isConnected = await new Promise<boolean>((resolve) => {
                conn.on('ready', () => {
                    isResolved = true;
                    conn.end();
                    resolve(true);
                });
                conn.on('error', () => {
                    if (!isResolved) {
                        isResolved = true;
                        resolve(false);
                    }
                });
                conn.on('timeout', () => {
                    if (!isResolved) {
                        isResolved = true;
                        resolve(false);
                    }
                });
                try {
                    conn.connect({
                        host: machine.ip,
                        username: credentials.username,
                        password: credentials.password,
                        readyTimeout: 5000
                    });
                } catch {
                    resolve(false);
                }
            });
            this.machineStatus[machine.ip] = isConnected ? 'connected' : 'unreachable';
        } catch {
            this.machineStatus[machine.ip] = 'unreachable';
        } finally {
            try {
                conn.end();
            } catch {}
        }
    }

    async refreshConnectionStatusForMachine(ip: string): Promise<void> {
        const machines = this.context.globalState.get<SharedMachine[]>('machines', []);
        const machine = machines.find((m: SharedMachine) => m.ip === ip);
        if (machine) {
            await this._refreshStatusForMachine(machine);
            this.refresh();
        }
    }
}

export class MachineItem extends vscode.TreeItem {
    connectionStatus: 'unknown' | 'connected' | 'unreachable' | 'fetching' = 'unknown';
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