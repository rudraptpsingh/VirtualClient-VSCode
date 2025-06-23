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
    if (isWindowsPlatform(platform)) {
        return WINDOWS_DEFAULT_REMOTE_DIR;
    } else {
        // For Linux systems, use the actual username provided
        // Don't use hardcoded usernames like 'coder'
        const actualUsername = username && username !== 'coder' ? username : 'vclientuser';
        return `${LINUX_DEFAULT_REMOTE_DIR}/${actualUsername}/VirtualClientScheduler`;
    }
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
 * Supports both --option=value and --option value formats
 */
export function parseCommandLineArgs(args: string): Record<string, string | boolean> {
    const found: Record<string, string | boolean> = {};
    
    // Handle --option=value format
    const equalsRegex = /--([\w-]+)=([^\s]+)/g;
    let match;
    while ((match = equalsRegex.exec(args)) !== null) {
        found[match[1]] = match[2];
    }
    
    // Handle --option value format (but skip if already found with equals)
    const spaceRegex = /--([\w-]+)(?!\s*=)\s+([^\s-][^\s]*)/g;
    while ((match = spaceRegex.exec(args)) !== null) {
        if (!(match[1] in found)) { // Don't override equals format
            found[match[1]] = match[2];
        }
    }
    
    // Handle flags (--option without value)
    const flagRegex = /--([\w-]+)(?![=\s]*[^\s-])/g;
    while ((match = flagRegex.exec(args)) !== null) {
        if (!(match[1] in found)) { // Don't override previous assignments
            found[match[1]] = true;
        }
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
                vcCmd += ` --${cliKey}=${shQuote(String(value))}`;
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
