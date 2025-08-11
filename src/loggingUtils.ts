/**
 * Logging utilities for Virtual Client extension
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { LogLevel, Logger } from './types';
import { LOG_FILE_EXTENSION } from './constants';
import { getExtensionConfig } from './envUtils';

export interface LoggingSetup {
    logger: Logger;
    outputChannel: vscode.OutputChannel;
    logStream: fs.WriteStream;
}

/**
 * Setup logger with file and output channel
 */
export function createRunLogger(runLabel: string, logFilePath: string, configuredLogLevel?: LogLevel): LoggingSetup {
    // Create output channel
    const outputChannel = vscode.window.createOutputChannel(`Virtual Client Logs - ${runLabel}`);
    outputChannel.show(true);

    // Create log file stream
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

    // Determine log level
    let logLevel = configuredLogLevel;
    if (!logLevel) {
        const loggerLogLevelStr = getExtensionConfig('virtualClient', 'loggerLogLevel', 'info');
        switch (loggerLogLevelStr.toLowerCase()) {
            case 'debug':
                logLevel = LogLevel.Debug;
                break;
            case 'info':
                logLevel = LogLevel.Info;
                break;
            case 'warn':
                logLevel = LogLevel.Warning;
                break;
            case 'error':
                logLevel = LogLevel.Error;
                break;
            default:
                logLevel = LogLevel.Info;
        }
    }

    // Create logger
    const logger = new Logger(logLevel, outputChannel, logStream);

    return { logger, outputChannel, logStream };
}

/**
 * Render progress bar string
 */
export function renderProgressBar(percent: number, barLength: number = 20): string {
    const filled = Math.round((percent / 100) * barLength);
    const empty = barLength - filled;
    return `[${'#'.repeat(filled)}${'-'.repeat(empty)}] ${percent}%`;
}

/**
 * Log upload progress with progress bar
 */
export function logUploadProgress(
    transferred: number,
    total: number,
    logger?: Logger,
    lastLoggedPercent?: { value: number }
): void {
    const percent = Math.floor((transferred / total) * 100);
    const totalMB = total / (1024 * 1024);
    const transferredMB = transferred / (1024 * 1024);

    // Only log every 5% or on completion
    if (!lastLoggedPercent || percent - lastLoggedPercent.value >= 5 || percent === 100) {
        if (lastLoggedPercent) {
            lastLoggedPercent.value = percent;
        }
        const progressBar = renderProgressBar(percent);
        logger?.info?.(`${progressBar} (${transferredMB.toFixed(2)} MB / ${totalMB.toFixed(2)} MB)`);
    }
}
