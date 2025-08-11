// Utility functions for VSCode-VC extension
// Move generic helpers here for reuse across the extension
import * as ssh2 from 'ssh2';
import * as fs from 'fs';
import * as unzipper from 'unzipper';
import * as path from 'path';

/**
 * Safely quotes a string for use in shell commands.
 */
export function shQuote(str: string): string {
    if (process.platform === 'win32') {
        return `"${str.replace(/"/g, '""')}"`;
    } else {
        return `'${str.replace(/'/g, "'\\''")}'`;
    }
}

/**
 * Sanitizes a label for use as a filesystem path segment.
 */
export function sanitizeLabel(label: string): string {
    return label.replace(/[\\/:"*?<>|,]/g, '-');
}

/**
 * Recursively creates remote directories over SFTP.
 * Always operates on paths relative to SFTP root if SFTP root is not '/'.
 * Returns the relative path used for SFTP operations.
 * @param sftp The SFTP connection.
 * @param remotePath The remote directory path to create.
 * @param logger Optional logger for debug output.
 * @returns The relative path used for SFTP operations.
 */
export async function sftpMkdirRecursive(sftp: any, remotePath: string, logger?: any): Promise<string> {
    // Normalize to POSIX path, remove trailing slash
    let normPath = remotePath.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normPath === '~') {
        return '.';
    }
    // Determine SFTP root (usually user's home dir)
    let sftpRoot = '/';
    try {
        await new Promise((resolve, reject) => {
            sftp.realpath('.', (err: any, cwd: string) => {
                if (!err && logger) {
                    logger.info?.(`SFTP initial working directory: ${cwd}`);
                    sftpRoot = cwd;
                }
                resolve(true);
            });
        });
    } catch {}
    // If SFTP root is not '/', strip the root from the path if present
    let relPath = normPath;
    if (sftpRoot !== '/' && normPath.startsWith(sftpRoot)) {
        relPath = normPath.substring(sftpRoot.length).replace(/^\/+/, '');
    } else if (sftpRoot !== '/' && normPath.startsWith('/')) {
        relPath = normPath.replace(/^\/+/, '');
    }
    // Split and build path
    const parts = relPath.split('/').filter(Boolean);
    let current = '.';
    for (const part of parts) {
        if (part === '~') {
            current = path.posix.join(current, part);
            continue;
        }
        current = path.posix.join(current, part);
        try {
            await new Promise((resolve, reject) => {
                sftp.stat(current, (err: any) => {
                    if (!err) {
                        // Directory exists
                        return resolve(true);
                    }
                    // If parent does not exist, fail fast
                    const parent = path.posix.dirname(current);
                    sftp.stat(parent, (parentErr: any) => {
                        if (parentErr) {
                            logger?.error?.(`Parent directory does not exist: ${parent}`);
                            return reject(new Error(`Parent directory does not exist: ${parent}`));
                        }
                        sftp.mkdir(current, (err2: any) => {
                            if (err2) {
                                if (err2.code === 4 || err2.code === 11) {
                                    logger?.debug?.(`mkdir ${current}: already exists or generic failure, continuing`);
                                    return resolve(true);
                                }
                                logger?.debug?.(`Failed to mkdir ${current}: ${err2.message}`);
                                return reject(err2);
                            }
                            resolve(true);
                        });
                    });
                });
            });
        } catch (e) {
            logger?.debug?.(`Error in sftpMkdirRecursive at ${current}: ${e instanceof Error ? e.message : e}`);
            throw e;
        }
    }
    return current;
}

/**
 * Downloads a file via SFTP.
 * @param sftp The SFTP connection.
 * @param remotePath The remote file path.
 * @param localPath The local file path.
 */
export async function sftpDownloadFile(sftp: any, remotePath: string, localPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        sftp.fastGet(remotePath, localPath, (err: any) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Extracts a zip file locally to a target directory.
 * @param zipPath Path to the zip file.
 * @param extractTo Directory to extract to.
 */
export async function extractZip(zipPath: string, extractTo: string): Promise<void> {
    await fs.promises.mkdir(extractTo, { recursive: true });
    return new Promise((resolve, reject) => {
        fs.createReadStream(zipPath)
            .pipe(unzipper.Extract({ path: extractTo }))
            .on('close', resolve)
            .on('error', reject);
    });
}

/**
 * Detects the remote platform (Windows/Linux) via SSH.
 * @param ip The IP address of the remote machine.
 * @param credentials The credentials for SSH.
 * @returns The detected platform string or empty string if detection fails.
 */
export async function detectRemotePlatform(
    ip: string,
    credentials: { username: string; password?: string }
): Promise<string> {
    const { username, password = '' } = credentials;
    if (!ip || !username) {
        return '';
    }
    const conn = new ssh2.Client();
    return new Promise<string>(resolve => {
        conn.on('ready', () => {
            conn.exec('uname -s && uname -m || (ver & echo %PROCESSOR_ARCHITECTURE%)', (err, stream) => {
                if (err) {
                    conn.end();
                    resolve('');
                    return;
                }
                let output = '';
                stream.on('data', (data: Buffer) => {
                    output += data.toString();
                });
                stream.on('close', () => {
                    conn.end();
                    let platform = '';
                    if (/Linux/i.test(output)) {
                        if (/aarch64|arm64/i.test(output)) {
                            platform = 'linux-arm64';
                        } else if (/x86_64/i.test(output)) {
                            platform = 'linux-x64';
                        }
                    } else if (/Windows/i.test(output) || /Microsoft Windows/i.test(output)) {
                        if (/ARM64/i.test(output)) {
                            platform = 'win-arm64';
                        } else if (/AMD64/i.test(output)) {
                            platform = 'win-x64';
                        }
                    }
                    resolve(platform);
                });
            });
        });
        conn.on('error', () => {
            resolve('');
        });
        conn.on('timeout', () => {
            resolve('');
        });
        try {
            conn.connect({
                host: ip,
                username,
                password,
                readyTimeout: 7000,
            });
        } catch {
            resolve('');
        }
    });
}
