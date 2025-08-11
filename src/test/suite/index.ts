import * as path from 'path';
import Mocha from 'mocha';
const glob = require('glob');

/**
 * Runs all test suites using Mocha and glob.
 */
export function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
    });

    const testsRoot = path.resolve(__dirname, '..');

    return new Promise((resolve, reject) => {
        glob.glob('**/*.test.js', { cwd: testsRoot }, (err: Error | null, files: string[]) => {
            if (err) {
                return reject(err);
            }
            files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));
            try {
                mocha.run((failures: number) => {
                    if (failures > 0) {
                        reject(new Error(`${failures} tests failed.`));
                    } else {
                        resolve();
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    });
}
