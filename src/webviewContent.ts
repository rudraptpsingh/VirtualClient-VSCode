import * as vscode from 'vscode';

export function getAddMachineWebviewContent(): string {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Add New Machine</title>
    </head>
    <body>
        <h2>Add New Machine</h2>
        <form id="machineForm">
            <label for="label">Machine Name:</label><br>
            <input type="text" id="label" name="label" required><br><br>
            <label for="ip">IP Address:</label><br>
            <input type="text" id="ip" name="ip" required><br><br>
            <label for="username">Username:</label><br>
            <input type="text" id="username" name="username" required><br><br>
            <label for="password">Password:</label><br>
            <input type="password" id="password" name="password" required><br><br>
            <label for="platform">Platform:</label><br>
            <select id="platform" name="platform" required>
                <option value="">Select platform</option>
                <option value="windows-x64">Windows x64</option>
                <option value="win-arm64">Windows ARM64</option>
                <option value="linux-x64">Linux x64</option>
                <option value="linux-arm64">Linux ARM64</option>
            </select>
            <button type="button" id="detectPlatformBtn" style="margin-left: 10px;">Detect Platform</button>
            <span id="detectPlatformSpinner" style="display:none; margin-left:5px; vertical-align:middle;">
                <svg width="18" height="18" viewBox="0 0 50 50" style="vertical-align:middle;"><circle cx="25" cy="25" r="20" fill="none" stroke="#0078d4" stroke-width="5" stroke-linecap="round" stroke-dasharray="31.415, 31.415" transform="rotate(72.0001 25 25)"><animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/></circle></svg>
            </span><br><br>
            <button type="submit">Add Machine</button>
            <button type="button" id="cancelBtn">Cancel</button>
        </form>
        <script>
            const vscode = acquireVsCodeApi();
            document.getElementById('machineForm').addEventListener('submit', (e) => {
                e.preventDefault();
                vscode.postMessage({
                    command: 'add',
                    label: document.getElementById('label').value,
                    ip: document.getElementById('ip').value,
                    username: document.getElementById('username').value,
                    password: document.getElementById('password').value,
                    platform: document.getElementById('platform').value
                });
            });
            document.getElementById('cancelBtn').addEventListener('click', () => {
                vscode.postMessage({ command: 'cancel' });
            });
            document.getElementById('detectPlatformBtn').addEventListener('click', () => {
                const ip = document.getElementById('ip').value;
                const username = document.getElementById('username').value;
                const password = document.getElementById('password').value;
                if (!ip || !username || !password) {
                    alert('Please fill in IP, username, and password before detecting platform.');
                    return;
                }
                document.getElementById('detectPlatformSpinner').style.display = '';
                vscode.postMessage({
                    command: 'detectPlatform',
                    ip,
                    username,
                    password
                });
            });
            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'platformDetected') {
                    document.getElementById('detectPlatformSpinner').style.display = 'none';
                    if (message.platform) {
                        document.getElementById('platform').value = message.platform;
                    } else {
                        alert('Failed to detect platform. Please check credentials or try again.');
                    }
                }
            });
        </script>
    </body>
    </html>
    `;
}

export function getRunVirtualClientWebviewContent(machines: any[], lastParams?: any, _steps?: any[], webview?: vscode.Webview): string {
    const machineOptions = machines.map(machine => 
        `<option value="${machine.ip}" ${lastParams?.machineIp === machine.ip ? 'selected' : ''}>${machine.label} (${machine.ip})</option>`
    ).join('');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Run Virtual Client</title>
        <style>
            body {
                padding: 20px;
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
            }
            .form-group {
                margin-bottom: 15px;
            }
            label {
                display: block;
                margin-bottom: 5px;
                font-weight: bold;
            }
            .desc {
                font-size: 0.9em;
                color: var(--vscode-descriptionForeground);
                margin-bottom: 5px;
            }
            input[type="text"], input[type="number"], select, textarea {
                width: 100%;
                padding: 8px;
                border: 1px solid var(--vscode-input-border);
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border-radius: 2px;
                box-sizing: border-box;
            }
            textarea {
                resize: vertical;
            }
            .checkbox-group {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
                margin-top: 10px;
            }
            .checkbox-item {
                display: flex;
                align-items: center;
                gap: 5px;
            }
            button {
                padding: 8px 16px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 2px;
                cursor: pointer;
                margin-top: 10px;
            }
            button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            .grid-2 {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
            }
            .section-title {
                font-size: 1.2em;
                margin-top: 25px;
                margin-bottom: 10px;
                border-bottom: 1px solid var(--vscode-settings-headerForeground);
                padding-bottom: 5px;
                font-weight: bold;
            }
        </style>
    </head>
    <body>
        <form id="runForm">
            <div class="section-title">Basic Configuration</div>
            <div class="form-group">
                <label for="machine">Target Machine:</label>
                <span class="desc">The remote machine to run Virtual Client on.</span>
                <select id="machine" name="machineIp" required>
                    <option value="">Select a machine</option>
                    ${machineOptions}
                </select>
            </div>

            <div class="form-group">
                <label for="packagePath">Local Virtual Client Package Path:</label>
                <span class="desc">Path to the Virtual Client package (e.g., .zip, .tar.gz) on your local machine to be uploaded.</span>
                <input type="text" id="packagePath" name="packagePath" value="${lastParams?.packagePath || ''}" required>
            </div>

            <div class="form-group">
                <label for="profile">Profile (--profile):</label>
                <span class="desc">The workload profile to execute. Example: 'PERF-CPU-OPENSSL.json'.</span>
                <select id="profile" name="profile" required>
                    <option value="PERF-IO-DISKSPD.json" ${lastParams?.profile === 'PERF-IO-DISKSPD.json' ? 'selected' : ''}>PERF-IO-DISKSPD.json</option>
                    <option value="custom" ${lastParams?.profile && lastParams?.profile !== 'PERF-IO-DISKSPD.json' ? 'selected' : ''}>Custom...</option>
                </select>
                <input type="text" id="profileCustom" name="profileCustom" style="display: none; margin-top: 5px;" placeholder="Enter custom profile" value="${lastParams?.profile && lastParams?.profile !== 'PERF-IO-DISKSPD.json' ? lastParams?.profile : ''}">
                <button type="button" id="loadDefaultsBtn" style="margin-left: 10px;">Load Defaults</button>
            </div>

            <div class="section-title">Execution Control</div>
            <div class="grid-2">
                <div class="form-group">
                    <label for="system">System (--system):</label>
                    <span class="desc">The system definition file to use.</span>
                    <input type="text" id="system" name="system" value="${lastParams?.system || ''}">
                </div>
            </div>

            <div class="grid-2">
                <div class="form-group">
                    <label for="timeout">Timeout (--timeout):</label>
                    <span class="desc">Timeout in minutes.</span>
                    <input type="number" id="timeout" name="timeout" value="${lastParams?.timeout || '10'}" min="1">
                </div>
                <div class="form-group">
                    <label for="iterations">Iterations (--iterations):</label>
                    <span class="desc">Number of times to run the profile.</span>
                    <input type="number" id="iterations" name="iterations" placeholder="e.g., 1" min="1" value="${lastParams?.iterations || ''}">
                </div>
                <div class="form-group">
                    <label for="exitWait">Exit Wait (--exit-wait):</label>
                    <span class="desc">Minutes to wait before exit.</span>
                    <input type="number" id="exitWait" name="exitWait" value="${lastParams?.exitWait || '2'}" min="1">
                </div>
                <div class="form-group">
                    <label for="dependencies">Dependencies (--dependencies):</label>
                    <span class="desc">Comma-separated list of dependency package names.</span>
                    <input type="text" id="dependencies" name="dependencies" placeholder="e.g., antutu.dependency,fio.dependency" value="${lastParams?.dependencies || ''}">
                </div>
            </div>

            <div class="section-title">Advanced Parameters</div>
            <div class="form-group">
                <label for="proxyApi">Proxy API (--proxy-api):</label>
                <span class="desc">Proxy API endpoint.</span>
                <input type="text" id="proxyApi" name="proxyApi" value="${lastParams?.proxyApi || ''}">
            </div>

            <div class="form-group">
                <label for="packageStore">Package Store (--package-store):</label>
                <span class="desc">Path or URI to the package store directory.</span>
                <input type="text" id="packageStore" name="packageStore" value="${lastParams?.packageStore || ''}">
            </div>

            <div class="form-group">
                <label for="eventHub">Event Hub (--event-hub):</label>
                <span class="desc">Azure Event Hub connection string or name.</span>
                <input type="text" id="eventHub" name="eventHub" value="${lastParams?.eventHub || ''}">
            </div>

            <div class="form-group">
                <label for="experimentId">Experiment Id (--experiment-id):</label>
                <span class="desc">The experiment ID for this run.</span>
                <input type="text" id="experimentId" name="experimentId" value="${lastParams?.experimentId || ''}">
            </div>

            <div class="form-group">
                <label for="clientId">Client Id (--client-id):</label>
                <span class="desc">The client ID for this run.</span>
                <input type="text" id="clientId" name="clientId" value="${lastParams?.clientId || ''}">
            </div>

            <div class="form-group">
                <label for="metadata">Metadata (--metadata):</label>
                <span class="desc">Additional metadata in key=value format, separated by ',,,' or ';'.</span>
                <input type="text" id="metadata" name="metadata" value="${lastParams?.metadata || ''}">
            </div>

            <div class="form-group">
                <label for="parameters">Parameters (--parameters):</label>
                <span class="desc">Additional parameters in key=value format, separated by ',,,' or ';'.</span>
                <input type="text" id="parameters" name="parameters" value="${lastParams?.parameters || ''}">
            </div>

            <div class="form-group">
                <label for="port">API Port (--port):</label>
                <span class="desc">Port for the Virtual Client API. Example: 4500 or 4501/Client,4502/Server</span>
                <input type="text" id="port" name="port" value="${lastParams?.port || ''}">
            </div>

            <div class="form-group">
                <label for="ipAddress">IP Address (--ip, --ip-address):</label>
                <span class="desc">Target/remote system IP address for monitoring.</span>
                <input type="text" id="ipAddress" name="ipAddress" value="${lastParams?.ipAddress || ''}">
            </div>

            <div class="section-title">Options</div>
            <div class="form-group">
                <div class="checkbox-group">
                    <div class="checkbox-item">
                        <input type="checkbox" id="logToFile" name="logToFile" ${lastParams?.logToFile ? 'checked' : ''}>
                        <label for="logToFile">Log to File (--log-to-file)</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" id="clean" name="clean" ${lastParams?.clean ? 'checked' : ''}>
                        <label for="clean">Clean (--clean)</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" id="debug" name="debug" ${lastParams?.debug ? 'checked' : ''}>
                        <label for="debug">Debug/Verbose (--debug)</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" id="failFast" name="failFast" ${lastParams?.failFast ? 'checked' : ''}>
                        <label for="failFast">Fail Fast (--fail-fast)</label>
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label for="logLevel">Log Level (--log-level):</label>
                <span class="desc">Set the minimum log level.</span>
                <select id="logLevel" name="logLevel">
                    <option value="" ${!lastParams?.logLevel ? 'selected' : ''}>Default (Information)</option>
                    <option value="Verbose" ${lastParams?.logLevel === 'Verbose' ? 'selected' : ''}>Verbose</option>
                    <option value="Debug" ${lastParams?.logLevel === 'Debug' ? 'selected' : ''}>Debug</option>
                    <option value="Information" ${lastParams?.logLevel === 'Information' ? 'selected' : ''}>Information</option>
                    <option value="Warning" ${lastParams?.logLevel === 'Warning' ? 'selected' : ''}>Warning</option>
                    <option value="Error" ${lastParams?.logLevel === 'Error' ? 'selected' : ''}>Error</option>
                    <option value="Critical" ${lastParams?.logLevel === 'Critical' ? 'selected' : ''}>Critical</option>
                </select>
            </div>

            <button type="submit">Run Virtual Client</button>
        </form>

        <script>
            const vscode = acquireVsCodeApi();
            const form = document.getElementById('runForm');
            const profileSelect = document.getElementById('profile');
            const profileCustom = document.getElementById('profileCustom');
            const loadDefaultsBtn = document.getElementById('loadDefaultsBtn');
            const machineSelect = document.getElementById('machine');

            // Show/hide custom profile input and auto-load defaults
            profileSelect.addEventListener('change', () => {
                if (profileSelect.value === 'custom') {
                    profileCustom.style.display = 'block';
                    profileCustom.required = true;
                } else {
                    profileCustom.style.display = 'none';
                    profileCustom.required = false;
                }
                // Auto-load defaults for known profiles
                if (profileSelect.value === 'PERF-IO-DISKSPD.json') {
                    document.getElementById('timeout').value = '10';
                    document.getElementById('exitWait').value = '2';
                    document.getElementById('parameters').value = '--block-size=4K --duration=60 --threads=4';
                }
                // Add more profiles here as needed
            });

            // Load Defaults button logic
            loadDefaultsBtn.addEventListener('click', () => {
                if (profileSelect.value === 'PERF-IO-DISKSPD.json') {
                    document.getElementById('timeout').value = '10';
                    document.getElementById('exitWait').value = '2';
                    document.getElementById('parameters').value = '--block-size=4K --duration=60 --threads=4';
                }
                // Add more profiles here as needed
            });

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = new FormData(form);
                const data = {};
                formData.forEach((value, key) => {
                    if (form.elements[key] && form.elements[key].type === 'checkbox') {
                        data[key] = form.elements[key].checked;
                    } else {
                        data[key] = value;
                    }
                });
                // Ensure all checkbox states are captured even if unchecked
                ['logToFile', 'clean', 'debug', 'failFast'].forEach(cbName => {
                    if (data[cbName] === undefined) data[cbName] = false;
                });
                // Use custom profile if selected
                if (profileSelect.value === 'custom') {
                    data.profile = profileCustom.value;
                } else {
                    data.profile = profileSelect.value;
                }
                vscode.postMessage({
                    command: 'run',
                    ...data
                });
            });
        </script>
    </body>
    </html>`;
}

export function showRunDetailsWebview(context: vscode.ExtensionContext, run: any) {
    const panel = vscode.window.createWebviewPanel(
        'runDetails',
        `Run Details: ${run.label}`,
        vscode.ViewColumn.One,
        { enableScripts: true }
    );
    const stepsHtml = run.steps.map((step: any) => `<li class="step-item ${step.status}">${step.label}: ${step.status}${step.detail ? ' - ' + step.detail : ''}</li>`).join('');
    const logsHtml = run.logs.map((line: string) => `<div style="font-family:monospace;white-space:pre;">${line}</div>`).join('');
    panel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Run Details</title>
        <style>
            body { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
            ul#stepsList { padding-left: 1.2em; }
            .step-item { font-weight: 500; margin-bottom: 0.3em; }
            .step-item.success { color: #4EC9B0; }
            .step-item.error { color: #F44747; }
            .step-item.running { color: #569CD6; }
            .step-item.pending { color: #D7BA7D; }
            .log-section { margin-top: 1em; }
        </style>
    </head>
    <body>
        <h2>${run.label}</h2>
        <div>Started: ${new Date(run.started).toLocaleString()}</div>
        ${run.finished ? `<div>Finished: ${new Date(run.finished).toLocaleString()}</div>` : ''}
        <h3>Steps</h3>
        <ul id="stepsList">${stepsHtml}</ul>
        <div class="log-section">
            <h3>Logs</h3>
            <div>${logsHtml}</div>
        </div>
    </body>
    </html>
    `;
}