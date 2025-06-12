/**
 * Platform-specific utilities for Virtual Client extension
 */
import * as path from 'path';
import { WINDOWS_DEFAULT_REMOTE_DIR, LINUX_DEFAULT_REMOTE_DIR } from './constants';

/**
 * Check if the given platform is Windows
 */
export function isWindowsPlatform(platform: string | undefined | null): boolean {
    return Boolean(platform) && String(platform).toLowerCase().startsWith('win');
}

/**
 * Get platform-appropriate remote path by joining segments
 */
export function getRemotePath(platform: string, ...segments: string[]): string {
    return isWindowsPlatform(platform)
        ? path.win32.join(...segments)
        : path.posix.join(...segments);
}

/**
 * Get default remote target directory for the platform
 */
export function getDefaultRemoteTargetDir(platform: string, username: string): string {
    return isWindowsPlatform(platform)
        ? WINDOWS_DEFAULT_REMOTE_DIR
        : `${LINUX_DEFAULT_REMOTE_DIR}/${username}/VirtualClientScheduler`;
}

/**
 * Get platform-specific tool executable name
 */
export function getToolExecutableName(platform: string, baseName: string = 'VirtualClient'): string {
    if (isWindowsPlatform(platform)) {
        return `${baseName}.exe`;
    } else if (platform.toLowerCase().startsWith('linux')) {
        return baseName;
    } else {
        return baseName; // Default fallback
    }
}

/**
 * Parse command line arguments string into key-value object
 */
export function parseCommandLineArgs(args: string): Record<string, string | boolean> {
    const regex = /--([\w-]+)(?:[= ]([^\s]+))?/g;
    const found: Record<string, string | boolean> = {};
    let match;
    while ((match = regex.exec(args)) !== null) {
        found[match[1]] = match[2] || true;
    }
    return found;
}

/**
 * Build Virtual Client command line from form data and additional args
 */
export function buildVirtualClientCommand(
    formData: any,
    additionalArgs?: string,
    shQuoteFunction?: (str: string) => string
): string {
    const shQuote = shQuoteFunction || ((str: string) => `"${str}"`);
    let vcCmd = '';
    
    // Helper to parse additionalArgs string into an object
    const additionalArgsObj = additionalArgs ? parseCommandLineArgs(additionalArgs) : {};
    
    // Helper to add argument if not overridden by additionalArgs
    function addArg(cliKey: string, value: any, isFlag = false) {
        if (cliKey in additionalArgsObj) {
            return; // overridden
        }
        if (value !== undefined && value !== null && value !== '' && value !== false) {
            if (isFlag) {
                vcCmd += ` --${cliKey}`;
            } else {
                vcCmd += ` --${cliKey} ${shQuote(String(value))}`;
            }
        }
    }

    addArg('profile', formData.profile);
    addArg('system', formData.system);
    addArg('timeout', formData.timeout);
    addArg('exit-wait', formData.exitWait);
    addArg('proxy-api', formData.proxyApi);
    addArg('package-store', formData.packageStore);
    addArg('event-hub', formData.eventHub);
    addArg('experiment-id', formData.experimentId);
    addArg('client-id', formData.clientId);
    addArg('metadata', formData.metadata);
    addArg('parameters', formData.parameters);
    addArg('port', formData.port);
    addArg('ip-address', formData.ipAddress);
    addArg('dependencies', formData.dependencies);
    addArg('iterations', formData.iterations);
    addArg('log-level', formData.logLevel);
    addArg('fail-fast', formData.failFast, true);
    addArg('log-to-file', formData.logToFile, true);
    
    // Handle clean targets specially
    if (!('clean' in additionalArgsObj)) {
        if (Array.isArray(formData.clean_targets) && formData.clean_targets.length > 0) {
            // If 'all' is selected, use --clean (no value)
            if (formData.clean_targets.includes('all')) {
                vcCmd += ' --clean';
            } else {
                vcCmd += ' --clean=' + formData.clean_targets.join(',');
            }
        }
    }
    
    addArg('debug', formData.debug, true);
    
    // Now append additionalArgs (as-is, after all form fields)
    if (additionalArgs && additionalArgs.trim()) {
        vcCmd += ' ' + additionalArgs.trim();
    }
    
    return vcCmd;
}
