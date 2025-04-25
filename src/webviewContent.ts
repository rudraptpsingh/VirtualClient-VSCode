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
                    password: document.getElementById('password').value
                });
            });
            document.getElementById('cancelBtn').addEventListener('click', () => {
                vscode.postMessage({ command: 'cancel' });
            });
        </script>
    </body>
    </html>
    `;
}

export function getRunVirtualClientWebviewContent(machines: any[], lastParams?: any, steps?: { label: string, status: string, detail?: string }[]): string {
    const stepsHtml = (steps ?? []).map(step => `<li class="step-item ${step.status}">${step.label}: ${step.status}${step.detail ? ' - ' + step.detail : ''}</li>`).join('');
    const machineOptions = machines.map(m => `<option value="${m.ip}">${m.label} (${m.ip})</option>`).join('');
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Run Virtual Client</title>
        <style>
            body { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family, 'Segoe UI', Arial, sans-serif); margin: 0; padding: 0 0 20px 0; }
            h2 { margin-top: 16px; }
            form#runForm { max-width: 700px; margin: 0 auto; background: var(--vscode-editorWidget-background); border-radius: 4px; box-shadow: 0 1px 4px 0 var(--vscode-widget-shadow, rgba(0,0,0,0.04)); padding: 18px 20px 14px 20px; border: 1px solid var(--vscode-panel-border); }
            fieldset { border: 1px solid var(--vscode-panel-border); border-radius: 3px; margin-bottom: 18px; padding: 10px 14px 10px 14px; }
            legend { font-weight: bold; color: var(--vscode-editor-foreground); }
            label { display: block; margin-bottom: 2px; font-size: 0.97em; font-weight: 500; color: var(--vscode-editor-foreground); }
            .desc { font-size: 0.92em; color: var(--vscode-descriptionForeground, #888); margin-bottom: 4px; }
            input[type="text"], input[type="number"], select { width: 100%; padding: 4px 7px; border-radius: 2px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-size: 0.97em; margin-bottom: 8px; box-sizing: border-box; transition: border 0.2s; }
            input[type="text"]:focus, input[type="number"]:focus, select:focus { border: 1.5px solid var(--vscode-focusBorder); outline: none; }
            button[type="submit"], button[type="button"] { padding: 6px 16px; margin-right: 8px; margin-top: 8px; border: none; border-radius: 2px; font-size: 1em; font-weight: 600; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; transition: background 0.15s, box-shadow 0.15s; box-shadow: 0 1px 4px 0 var(--vscode-widget-shadow, rgba(0,120,212,0.06)); }
            button[type="button"] { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
            button[type="submit"]:hover, button[type="button"]:hover { filter: brightness(1.08); box-shadow: 0 2px 8px 0 var(--vscode-widget-shadow, rgba(0,120,212,0.10)); }
            ul#stepsList { padding-left: 1.2em; margin-top: 14px; margin-bottom: 0; max-width: 650px; margin-left: auto; margin-right: auto; }
            .step-item { font-weight: 500; margin-bottom: 0.2em; padding: 6px 8px; border-radius: 2px; font-size: 0.98em; background: var(--vscode-editorWidget-background); border-left: 3px solid var(--vscode-panel-border); transition: background 0.2s, border-color 0.2s; }
            .step-item.success { color: #4EC9B0; border-left-color: #4EC9B0; background: rgba(78,201,176,0.08); }
            .step-item.error { color: #F44747; border-left-color: #F44747; background: rgba(244,71,71,0.08); }
            .step-item.running { color: #569CD6; border-left-color: #569CD6; background: rgba(86,156,214,0.08); }
            .step-item.pending { color: #D7BA7D; border-left-color: #D7BA7D; background: rgba(215,186,125,0.08); }
        </style>
    </head>
    <body>
        <h2>Run Virtual Client</h2>
        <form id="runForm">
            <fieldset>
                <legend>Target</legend>
                <label for="machineIp">Select Machine:</label>
                <span class="desc">The remote machine to run Virtual Client on.</span>
                <select id="machineIp" name="machineIp" required>
                    ${machineOptions}
                </select>
                <label for="packagePath">Virtual Client Package Path:</label>
                <span class="desc">Path to the Virtual Client package on the remote machine.</span>
                <input type="text" id="packagePath" name="packagePath" placeholder="/home/user/VirtualClient" value="${lastParams?.packagePath ?? ''}" required>
                <label for="platform">Platform:</label>
                <span class="desc">Target platform for the Virtual Client package.</span>
                <select id="platform" name="platform" required>
                    <option value="win-x64" ${lastParams?.platform === 'win-x64' ? 'selected' : ''}>win-x64</option>
                    <option value="win-arm64" ${lastParams?.platform === 'win-arm64' ? 'selected' : ''}>win-arm64</option>
                    <option value="linux-x64" ${lastParams?.platform === 'linux-x64' ? 'selected' : ''}>linux-x64</option>
                    <option value="linux-arm64" ${lastParams?.platform === 'linux-arm64' ? 'selected' : ''}>linux-arm64</option>
                </select>
            </fieldset>
            <fieldset>
                <legend>Priority Parameters</legend>
                <label for="profile">Profile (--profile):</label>
                <span class="desc">The workload profile to execute. Example: 'PERF-CPU-OPENSSL.json'.</span>
                <input type="text" id="profile" name="profile" placeholder="PERF-CPU-OPENSSL.json" value="${lastParams?.profile ?? ''}">
                <label for="system">System (--system):</label>
                <span class="desc">The system definition file to use.</span>
                <input type="text" id="system" name="system" placeholder="system.json" value="${lastParams?.system ?? ''}">
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                    <div>
                        <label for="timeout">Timeout (--timeout):</label>
                        <span class="desc">Timeout in minutes for the run.</span>
                        <input type="number" id="timeout" name="timeout" placeholder="180" value="${lastParams?.timeout ?? ''}">
                    </div>
                    <div>
                        <label for="iterations">Iterations (--iterations):</label>
                        <span class="desc">Number of times to run the workload.</span>
                        <input type="number" id="iterations" name="iterations" placeholder="1" value="${lastParams?.iterations ?? ''}">
                    </div>
                    <div>
                        <label for="exitWait">Exit Wait (--exit-wait):</label>
                        <span class="desc">Minutes to wait before exit.</span>
                        <input type="number" id="exitWait" name="exitWait" placeholder="5" value="${lastParams?.exitWait ?? ''}">
                    </div>
                </div>
                <div style="margin-top:10px;">
                    <label for="logger">Logger (--logger):</label>
                    <span class="desc">Logger type (e.g., Console, File, EventHub).</span>
                    <input type="text" id="logger" name="logger" placeholder="Console,File,EventHub" value="${lastParams?.logger ?? ''}">
                </div>
                <div style="margin-top:10px;">
                    <label class="checkbox-label">
                        <input type="checkbox" id="logToFile" name="logToFile" ${lastParams?.logToFile ? 'checked' : ''}>
                        <span style="margin-left: 5px;">Log to File (--log-to-file)</span>
                    </label>
                    <label class="checkbox-label" style="margin-left:20px;">
                        <input type="checkbox" id="debug" name="debug" ${lastParams?.debug ? 'checked' : ''}>
                        <span style="margin-left: 5px;">Debug/Verbose (--debug)</span>
                    </label>
                    <label class="checkbox-label" style="margin-left:20px;">
                        <input type="checkbox" id="cleanFlag" name="cleanFlag" ${lastParams?.cleanFlag ? 'checked' : ''}>
                        <span style="margin-left: 5px;">Clean (--clean)</span>
                    </label>
                </div>
                <label for="proxyApi">Proxy API (--proxy-api):</label>
                <span class="desc">Proxy API endpoint.</span>
                <input type="text" id="proxyApi" name="proxyApi" placeholder="e.g., http://localhost:4501" value="${lastParams?.proxyApi ?? ''}">
                <label for="packageStore">Package Store (--package-store):</label>
                <span class="desc">Path or URI to the package store directory.</span>
                <input type="text" id="packageStore" name="packageStore" placeholder="/home/user/packages or SAS URI" value="${lastParams?.packageStore ?? ''}">
                <label for="eventHub">Event Hub (--event-hub):</label>
                <span class="desc">Azure Event Hub connection string or name.</span>
                <input type="text" id="eventHub" name="eventHub" placeholder="Event Hub connection string or name" value="${lastParams?.eventHub ?? ''}">
            </fieldset>
            <fieldset>
                <legend>Other Parameters</legend>
                <label for="experimentId">Experiment Id (--experiment-id):</label>
                <span class="desc">The experiment ID for this run.</span>
                <input type="text" id="experimentId" name="experimentId" placeholder="b9fd4dce-eb3b-455f-bc81-2a394d1ff849" value="${lastParams?.experimentId ?? ''}">
                <label for="clientId">Client Id (--client-id):</label>
                <span class="desc">The client ID for this run.</span>
                <input type="text" id="clientId" name="clientId" placeholder="cluster01,eb3fc2d9-157b-4efc-b39c-a454a0779a5b,VCTest4-01" value="${lastParams?.clientId ?? ''}">
                <label for="metadata">Metadata (--metadata):</label>
                <span class="desc">Additional metadata in key=value format, separated by ',,,' or ';'.</span>
                <input type="text" id="metadata" name="metadata" placeholder="experimentGroup=Group A,,,cluster=cluster01" value="${lastParams?.metadata ?? ''}">
                <label for="parameters">Parameters (--parameters):</label>
                <span class="desc">Additional parameters in key=value format, separated by ',,,' or ';'.</span>
                <input type="text" id="parameters" name="parameters" placeholder="property1=value1,,,property2=value2" value="${lastParams?.parameters ?? ''}">
                <label for="port">API Port (--port):</label>
                <span class="desc">Port for the Virtual Client API. Example: 4500 or 4501/Client,4502/Server</span>
                <input type="text" id="port" name="port" placeholder="4500 or 4501/Client,4502/Server" value="${lastParams?.port ?? ''}">
                <label for="ipAddress">IP Address (--ip, --ip-address):</label>
                <span class="desc">Target/remote system IP address for monitoring.</span>
                <input type="text" id="ipAddress" name="ipAddress" placeholder="1.2.3.4" value="${lastParams?.ipAddress ?? ''}">
            </fieldset>
            <fieldset>
                <legend>Flags</legend>
                <label><input type="checkbox" id="debug" name="debug" ${lastParams?.debug ? 'checked' : ''}> Debug (--debug, --verbose)</label>
                <span class="desc">Request verbose logging output to the console.</span><br>
                <label><input type="checkbox" id="diag" name="diag" ${lastParams?.diag ? 'checked' : ''}> Diagnostics (--diag)</label>
                <span class="desc">Enable diagnostics output.</span><br>
                <label><input type="checkbox" id="help" name="help" ${lastParams?.help ? 'checked' : ''}> Help (-?, -h, --help)</label>
                <span class="desc">Show help and usage information.</span><br>
                <label><input type="checkbox" id="version" name="version" ${lastParams?.version ? 'checked' : ''}> Version (--version)</label>
                <span class="desc">Show Virtual Client version and exit.</span><br>
                <label><input type="checkbox" id="monitor" name="monitor" ${lastParams?.monitor ? 'checked' : ''}> Monitor (--mon, --monitor)</label>
                <span class="desc">Monitor the API service locally or at the specified IP address.</span><br>
            </fieldset>
            <fieldset>
                <legend>Other Additional Arguments</legend>
                <label for="additionalArgs">Other Additional Arguments</label>
                <span class="desc">Specify any other arguments (e.g., --log-level=Trace). One per line.</span>
                <textarea id="additionalArgs" name="additionalArgs" placeholder="--log-level=Trace\n--some-other-flag" style="width:98%;height:60px;">${lastParams?.additionalArgs ?? ''}</textarea>
            </fieldset>
            <button type="submit">Run Virtual Client</button>
            <button type="button" id="cancelBtn">Cancel</button>
        </form>
        <h3>Steps</h3>
        <ul id="stepsList">
            ${stepsHtml}
        </ul>
        <script>
            const vscode = acquireVsCodeApi();
            function buildCommandLine() {
                let args = [];
                if(document.getElementById('profile').value) args.push('--profile=' + document.getElementById('profile').value);
                if(document.getElementById('system').value) args.push('--system=' + document.getElementById('system').value);
                if(document.getElementById('timeout').value) args.push('--timeout=' + document.getElementById('timeout').value);
                if(document.getElementById('iterations').value) args.push('--iterations=' + document.getElementById('iterations').value);
                if(document.getElementById('exitWait').value) args.push('--exit-wait=' + document.getElementById('exitWait').value);
                if(document.getElementById('logger').value) args.push('--logger=' + document.getElementById('logger').value);
                if(document.getElementById('logToFile').checked) args.push('--log-to-file');
                if(document.getElementById('cleanFlag').checked) args.push('--clean');
                if(document.getElementById('debug').checked) args.push('--debug');
                if(document.getElementById('proxyApi').value) args.push('--proxy-api=' + document.getElementById('proxyApi').value);
                if(document.getElementById('packageStore').value) args.push('--package-store=' + document.getElementById('packageStore').value);
                if(document.getElementById('eventHub').value) args.push('--event-hub=' + document.getElementById('eventHub').value);
                if(document.getElementById('experimentId').value) args.push('--experiment-id=' + document.getElementById('experimentId').value);
                if(document.getElementById('clientId').value) args.push('--client-id=' + document.getElementById('clientId').value);
                if(document.getElementById('metadata').value) args.push('--metadata=' + document.getElementById('metadata').value);
                if(document.getElementById('parameters').value) args.push('--parameters=' + document.getElementById('parameters').value);
                if(document.getElementById('port').value) args.push('--port=' + document.getElementById('port').value);
                if(document.getElementById('ipAddress').value) args.push('--ip-address=' + document.getElementById('ipAddress').value);
                if(document.getElementById('diag').checked) args.push('--diag');
                if(document.getElementById('help').checked) args.push('--help');
                if(document.getElementById('version').checked) args.push('--version');
                if(document.getElementById('monitor').checked) args.push('--monitor');
                let additional = document.getElementById('additionalArgs').value;
                if(additional) {
                    args = args.concat(additional.split('\n').map(x => x.trim()).filter(x => x));
                }
                document.getElementById('toolArgs').value = args.join(' ');
            }
            document.getElementById('profile').addEventListener('input', buildCommandLine);
            document.getElementById('system').addEventListener('input', buildCommandLine);
            document.getElementById('timeout').addEventListener('input', buildCommandLine);
            document.getElementById('iterations').addEventListener('input', buildCommandLine);
            document.getElementById('exitWait').addEventListener('input', buildCommandLine);
            document.getElementById('logger').addEventListener('input', buildCommandLine);
            document.getElementById('logToFile').addEventListener('change', buildCommandLine);
            document.getElementById('cleanFlag').addEventListener('change', buildCommandLine);
            document.getElementById('debug').addEventListener('change', buildCommandLine);
            document.getElementById('proxyApi').addEventListener('input', buildCommandLine);
            document.getElementById('packageStore').addEventListener('input', buildCommandLine);
            document.getElementById('eventHub').addEventListener('input', buildCommandLine);
            document.getElementById('experimentId').addEventListener('input', buildCommandLine);
            document.getElementById('clientId').addEventListener('input', buildCommandLine);
            document.getElementById('metadata').addEventListener('input', buildCommandLine);
            document.getElementById('parameters').addEventListener('input', buildCommandLine);
            document.getElementById('port').addEventListener('input', buildCommandLine);
            document.getElementById('ipAddress').addEventListener('input', buildCommandLine);
            document.getElementById('diag').addEventListener('change', buildCommandLine);
            document.getElementById('help').addEventListener('change', buildCommandLine);
            document.getElementById('version').addEventListener('change', buildCommandLine);
            document.getElementById('monitor').addEventListener('change', buildCommandLine);
            document.getElementById('additionalArgs').addEventListener('input', buildCommandLine);
            buildCommandLine();
            document.getElementById('runForm').addEventListener('submit', function(e) {
                e.preventDefault();
                vscode.postMessage({
                    command: 'run',
                    machineIp: document.getElementById('machineIp').value,
                    packagePath: document.getElementById('packagePath').value,
                    platform: document.getElementById('platform').value,
                    toolArgs: document.getElementById('toolArgs').value.trim()
                });
            });
            document.getElementById('cancelBtn').addEventListener('click', function() {
                vscode.postMessage({ command: 'cancel' });
            });
            window.addEventListener('message', function(event) {
                var message = event.data;
                if (message.command === 'updateSteps') {
                    var stepsList = document.getElementById('stepsList');
                    var html = '';
                    for (var i = 0; i < message.steps.length; i++) {
                        var step = message.steps[i];
                        html += '<li class="step-item ' + step.status + '">' + step.label + ': ' + step.status + (step.detail ? ' - ' + step.detail : '') + '</li>';
                    }
                    stepsList.innerHTML = html;
                }
            });
        </script>
    </body>
    </html>
    `;
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