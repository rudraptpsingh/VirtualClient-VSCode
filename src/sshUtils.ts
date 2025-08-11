/**
 * SSH and SFTP utilities for Virtual Client extension
 */
import * as ssh2 from 'ssh2';
import type { Logger } from './types';
import type { MachineCredentials } from './types';

export interface SSHCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

/**
 * Execute SSH command with standardized error handling
 */
export function executeSSHCommand(
    connection: ssh2.Client,
    command: string,
    logger?: Logger
): Promise<SSHCommandResult> {
    return new Promise((resolve, reject) => {
        logger?.debug?.(`Executing SSH command: ${command}`);

        connection.exec(command, (err: Error | undefined, stream: any) => {
            if (err) {
                logger?.error?.(`SSH command failed to start: ${err.message}`);
                return reject(err);
            }

            let stdout = '';
            let stderr = '';

            stream.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            stream.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            stream.on('close', (code: number) => {
                logger?.debug?.(`SSH command completed with exit code: ${code}`);
                resolve({ stdout, stderr, exitCode: code });
            });
        });
    });
}

/**
 * Execute SSH command with real-time output streaming
 */
export function executeSSHCommandWithStreaming(
    connection: ssh2.Client,
    command: string,
    onStdout?: (data: string) => void,
    onStderr?: (data: string) => void,
    logger?: Logger
): Promise<SSHCommandResult> {
    return new Promise((resolve, reject) => {
        logger?.debug?.(`Executing SSH command with streaming: ${command}`);

        connection.exec(command, (err: Error | undefined, stream: any) => {
            if (err) {
                logger?.error?.(`SSH command failed to start: ${err.message}`);
                return reject(err);
            }

            let stdout = '';
            let stderr = '';

            stream.on('data', (data: Buffer) => {
                const output = data.toString();
                stdout += output;
                onStdout?.(output);
            });

            stream.stderr.on('data', (data: Buffer) => {
                const output = data.toString();
                stderr += output;
                onStderr?.(output);
            });

            stream.on('close', (code: number) => {
                logger?.debug?.(`SSH command completed with exit code: ${code}`);
                resolve({ stdout, stderr, exitCode: code });
            });
        });
    });
}

/**
 * Execute SFTP operation with error handling
 */
export function executeSFTPOperation<T>(
    sftp: ssh2.SFTPWrapper,
    operation: (sftp: ssh2.SFTPWrapper) => Promise<T>,
    logger?: Logger
): Promise<T> {
    return operation(sftp).catch(error => {
        logger?.error?.(`SFTP operation failed: ${error instanceof Error ? error.message : error}`);
        throw error;
    });
}

/**
 * Setup SSH connection with standardized configuration
 */
export function setupSSHConnection(host: string, credentials: MachineCredentials): Promise<ssh2.Client> {
    return new Promise((resolve, reject) => {
        const connection = new ssh2.Client();

        connection.on('ready', () => {
            resolve(connection);
        });

        connection.on('error', (err: Error) => {
            reject(err);
        });

        connection.connect({
            host,
            username: credentials.username,
            password: credentials.password,
            algorithms: {
                cipher: ['aes128-ctr'],
            },
        });
    });
}

/**
 * Setup SFTP with error handling
 */
export function setupSFTP(connection: ssh2.Client): Promise<ssh2.SFTPWrapper> {
    return new Promise((resolve, reject) => {
        connection.sftp((err: Error | undefined, sftp: ssh2.SFTPWrapper) => {
            if (err) {
                reject(err);
            } else {
                resolve(sftp);
            }
        });
    });
}

/**
 * Check if file exists on remote system via SFTP
 */
export function checkRemoteFileExists(sftp: ssh2.SFTPWrapper, remotePath: string, logger?: Logger): Promise<boolean> {
    return new Promise(resolve => {
        sftp.stat(remotePath, (err: any) => {
            const exists = !err;
            logger?.debug?.(`Remote file check for ${remotePath}: exists=${exists}`);
            resolve(exists);
        });
    });
}

/**
 * Downloads file via SFTP
 */
export async function sftpDownloadFile(sftp: any, remotePath: string, localPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        sftp.fastGet(remotePath, localPath, (err: Error) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}
