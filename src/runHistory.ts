import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function getPersistentRuns(context: vscode.ExtensionContext) {
    // ...existing code to get persistent runs from globalState or file...
    return [];
}

export function savePersistentRuns(context: vscode.ExtensionContext, runs: any[]) {
    // ...existing code to save persistent runs to globalState or file...
}

export function showRunDetailsWebview(context: vscode.ExtensionContext, run: any) {
    // ...existing code to show run details in a webview...
}

export {};
