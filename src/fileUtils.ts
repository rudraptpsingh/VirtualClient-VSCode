/**
 * File system utilities for Virtual Client extension
 */
import * as vscode from 'vscode';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { Logger } from './types';

/**
 * Check if file or directory exists
 */
export async function checkFileExists(filePath: string): Promise<boolean> {
    try {
        await fsPromises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Validate file existence and show error if not found
 */
export async function validateFileExists(
    filePath: string,
    errorMessage?: string
): Promise<void> {
    const exists = await checkFileExists(filePath);
    if (!exists) {
        const message = errorMessage || `File not found or inaccessible: ${filePath}`;
        vscode.window.showErrorMessage(message);
        throw new Error(message);
    }
}

/**
 * Open file in VS Code editor with error handling
 */
export async function openFileInEditor(
    filePath: string,
    preview: boolean = false
): Promise<void> {
    try {
        await validateFileExists(filePath);
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview });
    } catch (error) {
        const message = `Failed to open file: ${error instanceof Error ? error.message : error}`;
        vscode.window.showErrorMessage(message);
        throw error;
    }
}

/**
 * Create directory with logger support
 */
export async function ensureDirectoryExistsWithLogging(
    dirPath: string,
    logger?: Logger
): Promise<void> {
    try {
        await fsPromises.mkdir(dirPath, { recursive: true });
        logger?.debug?.(`Directory ensured: ${dirPath}`);
    } catch (error) {
        const message = `Failed to create directory ${dirPath}: ${error instanceof Error ? error.message : error}`;
        logger?.error?.(message);
        vscode.window.showErrorMessage(`Failed to create directory: ${dirPath}`);
        throw error;
    }
}

/**
 * Delete file or directory recursively with error collection
 */
export async function deletePathRecursively(
    targetPath: string,
    failedDeletes: string[]
): Promise<void> {
    try {
        await fsPromises.access(targetPath);
        const entries = await fsPromises.readdir(targetPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const curPath = path.join(targetPath, entry.name);            if (entry.isDirectory()) {
                await deletePathRecursively(curPath, failedDeletes);
                try {
                    await fsPromises.rmdir(curPath);
                } catch (e) {
                    failedDeletes.push(curPath);
                }
            } else {
                try {
                    await fsPromises.unlink(curPath);
                } catch (e) {
                    failedDeletes.push(curPath);
                }
            }
        }
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            failedDeletes.push(targetPath);
        }
    }
}

/**
 * Create safe filename from label by replacing invalid characters
 */
export function createSafeFileName(label: string, extension?: string): string {
    const safeLabel = label.replace(/[\\/:"*?<>|,\.\s]/g, '-');
    return extension ? `${safeLabel}${extension}` : safeLabel;
}

/**
 * Validate package path and return file stats
 */
export async function validatePackagePath(packagePath: string): Promise<{ isValid: boolean; error?: string }> {
    try {
        const stats = await fsPromises.stat(packagePath);
        if (!stats.isFile()) {
            return {
                isValid: false,
                error: `Local package path is not a file: ${packagePath}`
            };
        }
        return { isValid: true };
    } catch (error) {
        return {
            isValid: false,
            error: `Local package path does not exist or is not accessible: ${packagePath} - ${error instanceof Error ? error.message : error}`
        };
    }
}
