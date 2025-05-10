import * as vscode from 'vscode';

/**
 * Returns the HTML content for the Add Machine webview.
 */
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

/**
 * Returns the HTML content for the Run Virtual Client webview.
 * @param machines List of available machines.
 * @param lastParams Last used parameters.
 * @param _steps Steps for the run.
 * @param webview The webview instance.
 */
export function getRunVirtualClientWebviewContent(machines: any[], lastParams?: any, _steps?: any[], webview?: vscode.Webview): string {
    const machineOptions = machines.map(machine => 
        `<option value="${machine.ip}" ${lastParams?.machineIp === machine.ip ? 'selected' : ''}>${machine.label} (${machine.ip})</option>`
    ).join('');
    // Prepare parameters for dynamic rows
    const paramPairs = (lastParams?.parameters || '').split(/[;,]+/).map((s: string) => s.trim()).filter(Boolean).map((pair: string) => {
        const [key, ...rest] = pair.split('=');
        return { key: key.trim(), value: rest.join('=') };
    });
    const paramRowsHtml = paramPairs.map((p: {key: string, value: string}, idx: number) =>
        `<div class="param-row"><input type="text" class="param-key" placeholder="key" value="${p.key.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" aria-label="Parameter key">
        <input type="text" class="param-value" placeholder="value" value="${p.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" aria-label="Parameter value">
        <button type="button" class="remove-param" title="Remove">&times;</button></div>`
    ).join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Run Virtual Client</title>
<style>
body { padding: 24px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background-color: var(--vscode-editor-background); max-width: 700px; margin: 0 auto; }
.form-group { margin-bottom: 18px; }
label { display: block; margin-bottom: 5px; font-weight: 600; }
.desc { font-size: 0.92em; color: var(--vscode-descriptionForeground); margin-bottom: 5px; }
input[type="text"], input[type="number"], select, textarea { width: 100%; padding: 8px; border: 1px solid var(--vscode-input-border); background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; box-sizing: border-box; font-size: 1em; }
input:invalid, select:invalid { border-color: var(--vscode-inputValidation-errorBorder); }
.error-message { color: var(--vscode-inputValidation-errorForeground); background: var(--vscode-inputValidation-errorBackground); padding: 4px 8px; border-radius: 3px; font-size: 0.95em; margin-top: 2px; display: none; }
.checkbox-group { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
.checkbox-item { display: flex; align-items: center; gap: 5px; }
button { padding: 8px 18px; background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; margin-top: 10px; font-size: 1em; transition: background 0.2s; }
button[disabled] { opacity: 0.6; cursor: not-allowed; }
button:hover:not([disabled]) { background-color: var(--vscode-button-hoverBackground); }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.section-title { font-size: 1.15em; margin-top: 28px; margin-bottom: 12px; border-bottom: 1px solid var(--vscode-settings-headerForeground); padding-bottom: 5px; font-weight: bold; }
.param-row { display: flex; gap: 8px; margin-bottom: 6px; }
.param-row input { flex: 1 1 45%; }
.param-row button { padding: 0 8px; margin-top: 0; height: 32px; }
@media (max-width: 600px) { .grid-2 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<form id="runForm" autocomplete="off" novalidate>
<div class="section-title">Basic Configuration</div>
<div class="form-group">
<label for="machine">Target Machine:</label>
<span class="desc">The remote machine to run Virtual Client on.</span>
<select id="machine" name="machineIp" required aria-required="true">
<option value="">Select a machine</option>
${machineOptions}
</select>
<div class="error-message" id="machineError">Please select a machine.</div>
</div>
<div class="form-group">
<label for="packagePath">Local Virtual Client Package Path:</label>
<span class="desc">Path to the Virtual Client package (e.g., .zip, .tar.gz) on your local machine to be uploaded.</span>
<input type="text" id="packagePath" name="packagePath" value="${lastParams?.packagePath || ''}" required aria-required="true" placeholder="C:\\path\\to\\VirtualClient.zip">
<div class="error-message" id="packagePathError">Please provide a valid package path.</div>
</div>
<div class="form-group">
<label for="profile">Profile (--profile):</label>
<span class="desc">The workload profile to execute. Example: 'PERF-CPU-OPENSSL.json'.</span>
<select id="profile" name="profile" required aria-required="true">
<option value="PERF-IO-DISKSPD.json" ${lastParams?.profile === 'PERF-IO-DISKSPD.json' ? 'selected' : ''}>PERF-IO-DISKSPD.json</option>
<option value="custom" ${lastParams?.profile && lastParams?.profile !== 'PERF-IO-DISKSPD.json' ? 'selected' : ''}>Custom...</option>
</select>
<input type="text" id="profileCustom" name="profileCustom" style="display: none; margin-top: 5px;" placeholder="Enter custom profile" value="${lastParams?.profile && lastParams?.profile !== 'PERF-IO-DISKSPD.json' ? lastParams?.profile : ''}">
<div class="error-message" id="profileError">Please select or enter a profile.</div>
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
<label>Parameters (--parameters):
<span class="desc" title="Add key-value pairs for additional parameters. Use the + button to add more.">Additional parameters as key-value pairs.</span>
</label>
<div id="paramRows">${paramRowsHtml}</div>
<button type="button" id="addParamBtn" title="Add parameter row">+ Add Parameter</button>
</div>
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
<option value="Trace" ${lastParams?.logLevel === 'Trace' ? 'selected' : ''}>Trace</option>
<option value="Debug" ${lastParams?.logLevel === 'Debug' ? 'selected' : ''}>Debug</option>
<option value="Information" ${lastParams?.logLevel === 'Information' ? 'selected' : ''}>Information</option>
<option value="Warning" ${lastParams?.logLevel === 'Warning' ? 'selected' : ''}>Warning</option>
<option value="Error" ${lastParams?.logLevel === 'Error' ? 'selected' : ''}>Error</option>
<option value="Critical" ${lastParams?.logLevel === 'Critical' ? 'selected' : ''}>Critical</option>
</select>
</div>
<button type="submit" id="submitBtn">Run Virtual Client</button>
</form>
<script>
(function() {
const vscode = acquireVsCodeApi();
const form = document.getElementById('runForm');
const profileSelect = document.getElementById('profile');
const profileCustom = document.getElementById('profileCustom');
const loadDefaultsBtn = document.getElementById('loadDefaultsBtn');
const machineSelect = document.getElementById('machine');
const submitBtn = document.getElementById('submitBtn');
const paramRows = document.getElementById('paramRows');
const addParamBtn = document.getElementById('addParamBtn');
function getParamList() {
  const rows = paramRows.querySelectorAll('.param-row');
  const params = [];
  rows.forEach(row => {
    const key = row.querySelector('.param-key').value.trim();
    const value = row.querySelector('.param-value').value.trim();
    if (key) params.push({ key, value });
  });
  return params;
}
function renderParamRows() {
  // Re-render all rows
  const params = getParamList();
  paramRows.innerHTML = '';
  params.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = '<input type="text" class="param-key" placeholder="key" value="' + (p.key || '') + '" aria-label="Parameter key">' +
      '<input type="text" class="param-value" placeholder="value" value="' + (p.value || '') + '" aria-label="Parameter value">' +
      '<button type="button" class="remove-param" title="Remove">&times;</button>';
    row.querySelector('.remove-param').onclick = function() {
      params.splice(idx, 1);
      paramRows.innerHTML = '';
      params.forEach((p2, i2) => {
        const r2 = document.createElement('div');
        r2.className = 'param-row';
        r2.innerHTML = '<input type="text" class="param-key" placeholder="key" value="' + (p2.key || '') + '" aria-label="Parameter key">' +
          '<input type="text" class="param-value" placeholder="value" value="' + (p2.value || '') + '" aria-label="Parameter value">' +
          '<button type="button" class="remove-param" title="Remove">&times;</button>';
        r2.querySelector('.remove-param').onclick = function() {
          params.splice(i2, 1);
          renderParamRows();
        };
        paramRows.appendChild(r2);
      });
    };
    paramRows.appendChild(row);
  });
}
addParamBtn.onclick = function() {
  const params = getParamList();
  params.push({ key: '', value: '' });
  paramRows.innerHTML = '';
  params.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = '<input type="text" class="param-key" placeholder="key" value="' + (p.key || '') + '" aria-label="Parameter key">' +
      '<input type="text" class="param-value" placeholder="value" value="' + (p.value || '') + '" aria-label="Parameter value">' +
      '<button type="button" class="remove-param" title="Remove">&times;</button>';
    row.querySelector('.remove-param').onclick = function() {
      params.splice(idx, 1);
      renderParamRows();
    };
    paramRows.appendChild(row);
  });
};
// Initial render if any
if (paramRows.children.length === 0 && ${paramPairs.length} > 0) {
  renderParamRows();
}
profileSelect.addEventListener('change', function() {
  if (profileSelect.value === 'custom') {
    profileCustom.style.display = 'block';
    profileCustom.required = true;
  } else {
    profileCustom.style.display = 'none';
    profileCustom.required = false;
  }
  if (profileSelect.value === 'PERF-IO-DISKSPD.json') {
    document.getElementById('timeout').value = '10';
    document.getElementById('exitWait').value = '2';
  }
});
loadDefaultsBtn.addEventListener('click', function() {
  if (profileSelect.value === 'PERF-IO-DISKSPD.json') {
    document.getElementById('timeout').value = '10';
    document.getElementById('exitWait').value = '2';
  }
});
function showError(id, show, msg) {
  var el = document.getElementById(id);
  if (!el) return;
  el.style.display = show ? '' : 'none';
  if (msg) el.textContent = msg;
}
function validate() {
  var valid = true;
  if (!machineSelect.value) {
    showError('machineError', true);
    valid = false;
  } else {
    showError('machineError', false);
  }
  var pkg = document.getElementById('packagePath');
  if (!pkg.value.trim()) {
    showError('packagePathError', true);
    valid = false;
  } else {
    showError('packagePathError', false);
  }
  if (profileSelect.value === 'custom' && !profileCustom.value.trim()) {
    showError('profileError', true, 'Please enter a custom profile.');
    valid = false;
  } else if (!profileSelect.value) {
    showError('profileError', true, 'Please select a profile.');
    valid = false;
  } else {
    showError('profileError', false);
  }
  return valid;
}
form.addEventListener('submit', function(e) {
  e.preventDefault();
  if (!validate()) return;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Running...';
  var formData = new FormData(form);
  var data = {};
  formData.forEach(function(value, key) {
    var el = form.elements[key];
    if (el && el.type === 'checkbox') {
      data[key] = el.checked;
    } else {
      data[key] = value;
    }
  });
  ['logToFile', 'clean', 'debug', 'failFast'].forEach(function(cbName) {
    if (typeof data[cbName] === 'undefined') data[cbName] = false;
  });
  if (profileSelect.value === 'custom') {
    data.profile = profileCustom.value;
  } else {
    data.profile = profileSelect.value;
  }
  // Collect parameters from paramRows
  var params = getParamList();
  data.parameters = params.filter(function(p) { return p.key; }).map(function(p) { return p.key + '=' + p.value; }).join(';');
  vscode.postMessage({ command: 'run', ...data });
});
window.addEventListener('message', function(event) {
  if (event.data && event.data.command === 'enableSubmit') {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Run Virtual Client';
  }
});
})();
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