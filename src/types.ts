/**
 * Represents credentials for a remote machine.
 */
export interface MachineCredentials {
    name: string;
    host: string;
    username: string;
    password: string;
}

/**
 * Log level for extension logging.
 */
export enum LogLevel {
    Error = 0,
    Warning = 1,
    Info = 2,
    Debug = 3
}

/**
 * Logger utility for VSCode-VC extension.
 * Filters logs by level and writes to OutputChannel and file if provided.
 */
export class Logger {
    private level: LogLevel;
    private outputChannel?: import('vscode').OutputChannel;
    private logStream?: import('fs').WriteStream;

    constructor(level: LogLevel, outputChannel?: import('vscode').OutputChannel, logStream?: import('fs').WriteStream) {
        this.level = level;
        this.outputChannel = outputChannel;
        this.logStream = logStream;
    }

    setLevel(level: LogLevel) {
        this.level = level;
    }

    setOutputChannel(channel: import('vscode').OutputChannel) {
        this.outputChannel = channel;
    }

    setLogStream(stream: import('fs').WriteStream) {
        this.logStream = stream;
    }

    error(msg: string) {
        this.log(LogLevel.Error, msg);
    }
    warn(msg: string) {
        this.log(LogLevel.Warning, msg);
    }
    info(msg: string) {
        this.log(LogLevel.Info, msg);
    }
    debug(msg: string) {
        this.log(LogLevel.Debug, msg);
    }

    log(level: LogLevel, msg: string) {
        if (level > this.level) { return; }
        const prefix = `[${LogLevel[level].toUpperCase()}]`;
        const line = `${prefix} [${new Date().toISOString()}] ${msg}`;
        if (this.outputChannel) {
            this.outputChannel.appendLine(line);
        }
        if (this.logStream) {
            this.logStream.write(line + '\n');
        }
    }
}