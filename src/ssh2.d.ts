declare module 'ssh2' {
    import { EventEmitter } from 'events';
    export class Client extends EventEmitter {
        connect(config: any): void;
        end(): void;
        exec(command: string, callback: (err: Error | undefined, stream: any) => void): void;
        sftp(callback: (err: Error | undefined, sftp: any) => void): void;
    }
    export type SFTPWrapper = any;
} 