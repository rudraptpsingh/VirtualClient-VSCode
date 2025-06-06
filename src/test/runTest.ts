import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/**
 * Runs the VS Code extension tests using the test runner.
 */
async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        // The path to the extension test script (the compiled .js file)
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        await runTests({ extensionDevelopmentPath, extensionTestsPath });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();