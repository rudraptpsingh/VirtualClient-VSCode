/**
 * Environment and UI utilities for Virtual Client extension
 */
import * as vscode from 'vscode';
import { TEST_ENV_VARS } from './constants';

/**
 * Detect if running in test environment
 */
export function isTestEnvironment(): boolean {
    return TEST_ENV_VARS.some(envVar => 
        process.env[envVar] === 'test' || 
        process.env[envVar] === '1' || 
        process.env[envVar] === 'true'
    );
}

/**
 * Show confirmation dialog (skip in test environment)
 */
export async function showConfirmationDialog(
    message: string,
    confirmLabel: string,
    modal: boolean = true
): Promise<string | undefined> {
    if (isTestEnvironment()) {
        return confirmLabel; // Auto-confirm in test environment
    }
    
    return await vscode.window.showWarningMessage(
        message,
        { modal },
        confirmLabel
    );
}

/**
 * Standardized error message display
 */
export function showErrorMessage(
    error: Error | string,
    context?: string
): void {
    const message = formatErrorMessage(error, context);
    vscode.window.showErrorMessage(message);
}

/**
 * Standardized warning message display
 */
export async function showWarningMessage(
    message: string,
    ...actions: string[]
): Promise<string | undefined> {
    return await vscode.window.showWarningMessage(message, ...actions);
}

/**
 * Convert error to user-friendly message
 */
export function formatErrorMessage(
    error: Error | unknown,
    context?: string
): string {
    const baseMessage = error instanceof Error ? error.message : String(error);
    return context ? `${context}: ${baseMessage}` : baseMessage;
}

/**
 * Get VS Code configuration with defaults
 */
export function getExtensionConfig<T>(
    section: string,
    key: string,
    defaultValue: T
): T {
    const config = vscode.workspace.getConfiguration(section);
    return config.get<T>(key, defaultValue);
}
