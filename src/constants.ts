/**
 * Constants for the Virtual Client VS Code extension
 */

// Directory and file names
export const LOGS_DIR_NAME = 'logs';
export const LOGS_SUBDIR = 'logs';
export const TEMPLATES_DIR_NAME = 'templates';
export const LOG_FILE_EXTENSION = '.log';
export const JSON_FILE_EXTENSION = '.json';
export const LOGS_ZIP = 'logs.zip';
export const LOGS_TAR = 'logs.tar.gz';

// Default remote directories
export const WINDOWS_DEFAULT_REMOTE_DIR = 'C:\\VirtualClientScheduler';
export const LINUX_DEFAULT_REMOTE_DIR = '/home';

// UI labels
export const REMOVE_ALL_LABEL = 'Remove All';
export const REMOVE_LABEL = 'Remove';
export const LOG_LABEL_PREFIX = 'Log: ';

// Default values
export const UNKNOWN_LABEL = 'unknown_label';
export const UNKNOWN_IP = 'unknown_ip';

// AI Log Analysis
export const MAX_LOG_CONTENT_SIZE_BYTES = 100 * 1024; // 100KB limit for LLM token constraints

// Step statuses
export type StepStatus = 'pending' | 'running' | 'success' | 'error';

// Test environment variables
export const TEST_ENV_VARS = ['NODE_ENV', 'VSC_JEST_WORKER', 'VSCODE_TEST'] as const;
