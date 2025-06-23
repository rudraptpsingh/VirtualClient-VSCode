/**
 * Archive utilities for Virtual Client extension
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { Client } from 'ssh2';
import { promises as fsPromises } from 'fs';
import { LOGS_ZIP, LOGS_TAR, LOGS_SUBDIR, LOGS_DIR_NAME } from './constants';
import { getRemotePath, isWindowsPlatform } from './platformUtils';
import { ensureDirectoryExistsWithLogging } from './fileUtils';
import { executeSSHCommand } from './sshUtils';
import { extractZip, sanitizeLabel } from './utils';

export interface ArchiveOperationOptions {
    conn: Client;
    sftp: any;
    platform: string;
    extractDestDir: string;
    credentials: { password: string };
    logger?: any;
    shQuote: (str: string) => string;
}

export interface LogTransferOptions extends ArchiveOperationOptions {
    context: vscode.ExtensionContext;
    runLabel: string;
}

/**
 * Creates archive command for different platforms
 */
export function createArchiveCommand(
    platform: string,
    remoteLogsDir: string,
    remoteArchivePath: string,
    shQuote: (str: string) => string
): { command: string; isTar: boolean } {
    const isWindows = isWindowsPlatform(platform);
    
    if (isWindows) {
        return {
            command: `powershell -Command "Compress-Archive -Path '${remoteLogsDir}/*' -DestinationPath '${remoteArchivePath}' -Force"`,
            isTar: false
        };
    } else {
        return {
            command: `tar -czf ${shQuote(remoteArchivePath)} -C ${shQuote(remoteLogsDir)} .`,
            isTar: true
        };
    }
}

/**
 * Gets remote archive paths for logs
 */
export function getRemoteArchivePaths(platform: string, extractDestDir: string) {
    const remoteLogsDir = getRemotePath(platform, extractDestDir, 'content', platform, LOGS_SUBDIR);
    const isWindows = isWindowsPlatform(platform);
    const archiveFileName = isWindows ? LOGS_ZIP : LOGS_TAR;
    const remoteArchivePath = getRemotePath(platform, extractDestDir, 'content', platform, archiveFileName);
    
    return {
        remoteLogsDir,
        remoteArchivePath,
        isTar: !isWindows
    };
}

/**
 * Executes archive command on remote machine
 */
export async function executeArchiveCommand(
    conn: Client,
    archiveCommand: string,
    logger?: any
): Promise<void> {
    return new Promise((resolve, reject) => {
        conn.exec(archiveCommand, (err: Error | undefined, stream: any) => {
            if (err) {
                logger?.debug(`Error starting archive command: ${err.message}`);
                return reject(err);
            }
            
            let stderr = '';
            let stdout = '';
            
            stream.on('data', (data: Buffer) => {
                stdout += data.toString();
                logger?.info(`Archive stdout: ${data.toString()}`);
            });
            
            stream.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
                logger?.warn(`Archive stderr: ${data.toString()}`);
            });
            
            stream.on('close', (code: number) => {
                logger?.debug(`Archive command exited with code ${code}`);
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Archive failed with code ${code}: ${stderr}`));
                }
            });
        });
    });
}

/**
 * Downloads file via SFTP
 */
export async function sftpDownloadFile(
    sftp: any,
    remotePath: string,
    localPath: string
): Promise<void> {
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

/**
 * Downloads and extracts logs archive
 */
export async function downloadAndExtractLogs(
    sftp: any,
    remoteArchivePath: string,
    localLogsDir: string,
    isTar: boolean,
    logger?: any
): Promise<void> {
    await ensureDirectoryExistsWithLogging(localLogsDir);
    const archiveFileName = isTar ? LOGS_TAR : LOGS_ZIP;
    const localArchivePath = path.join(localLogsDir, archiveFileName);
    
    // Download the archive
    await sftpDownloadFile(sftp, remoteArchivePath, localArchivePath);
    
    // Extract the archive
    if (isTar) {
        await extractTarArchive(localArchivePath, localLogsDir, logger);
    } else {
        await extractZip(localArchivePath, localLogsDir);
    }
}

/**
 * Extracts tar archive
 */
export async function extractTarArchive(
    localArchivePath: string,
    localLogsDir: string,
    logger?: any
): Promise<void> {
    const { exec } = require('child_process');
    const tarCmd = process.platform === 'win32'
        ? `tar.exe -xzf "${localArchivePath}" -C "${localLogsDir}"`
        : `tar -xzf "${localArchivePath}" -C "${localLogsDir}"`;
    
    return new Promise((resolve, reject) => {
        exec(tarCmd, (error: any, stdout: string, stderr: string) => {
            if (error) {                logger?.error(`Error extracting logs.tar.gz: ${stderr}`);
                return reject(new Error(`Failed to extract logs.tar.gz: ${stderr}`));
            }
            logger?.debug(`Extracted logs.tar.gz: ${stdout}`);
            resolve();
        });
    });
}

/**
 * Cleans up remote archive file
 */
export async function cleanupRemoteArchive(
    conn: Client,
    remoteArchivePath: string,
    platform: string,
    shQuote: (str: string) => string
): Promise<void> {
    const isWindows = isWindowsPlatform(platform);
    const cleanupCommand = isWindows
        ? `powershell -Command "Remove-Item -Path '${remoteArchivePath.replace(/'/g, "''")}' -Force"`
        : `rm -f ${shQuote(remoteArchivePath)}`;
    
    return new Promise((resolve) => {
        conn.exec(cleanupCommand, (err: Error | undefined, stream: any) => {
            if (err) {
                resolve(); // Don't fail the run if cleanup fails
                return;
            }
            stream.on('close', () => resolve());
            stream.on('data', () => {});
            stream.stderr.on('data', () => {});
        });
    });
}

/**
 * Complete log transfer operation
 */
export async function transferLogs(options: LogTransferOptions): Promise<string> {
    const { context, runLabel, platform, extractDestDir, conn, sftp, shQuote, logger } = options;
    
    // Get archive paths
    const { remoteLogsDir, remoteArchivePath, isTar } = getRemoteArchivePaths(platform, extractDestDir);
      logger?.debug('Starting log archiving...');
    logger?.debug(`Remote logs directory: ${remoteLogsDir}`);
    logger?.debug(`Remote archive path: ${remoteArchivePath}`);
      // Create archive command
    const { command: archiveCmd } = createArchiveCommand(platform, remoteLogsDir, remoteArchivePath, shQuote);
    
    // Execute archive command
    await executeArchiveCommand(conn, archiveCmd, logger);
    logger?.debug('Log archiving completed');// Download and extract logs
    const localLogsDir = path.join(context.globalStorageUri.fsPath, LOGS_DIR_NAME, sanitizeLabel(runLabel));
    await downloadAndExtractLogs(sftp, remoteArchivePath, localLogsDir, isTar, logger);
    
    // Cleanup remote archive
    await cleanupRemoteArchive(conn, remoteArchivePath, platform, shQuote);
      return localLogsDir;
}
