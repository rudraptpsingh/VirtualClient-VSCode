/**
 * Template-related webview content for Virtual Client extension
 */
import * as vscode from 'vscode';
import { RunTemplate, TemplateCategory } from './templateManager';

/**
 * Generate template options HTML grouped by category
 */
export function generateTemplateOptions(templates: RunTemplate[]): string {
    if (!templates || templates.length === 0) {
        return '<option value="" disabled>No templates available</option>';
    }

    // Group templates by category
    const groupedTemplates = templates.reduce((groups: any, template: RunTemplate) => {
        const category = template.category || 'Custom';
        if (!groups[category]) {
            groups[category] = [];
        }
        groups[category].push(template);
        return groups;
    }, {});

    // Generate HTML for each category
    let optionsHtml = '';
    Object.keys(groupedTemplates).sort().forEach(category => {
        optionsHtml += `<optgroup label="${category}">`;
        groupedTemplates[category].forEach((template: RunTemplate) => {
            const escapedName = template.name.replace(/"/g, '&quot;');
            const description = template.description ? ` - ${template.description}` : '';
            optionsHtml += `<option value="${template.id}" title="${escapedName}${description}">${escapedName}</option>`;
        });
        optionsHtml += '</optgroup>';
    });

    return optionsHtml;
}

/**
 * Get additional CSS styles for template functionality
 */
export function getTemplateStyles(): string {
    return `
.template-section { 
    background: var(--vscode-editor-inactiveSelectionBackground); 
    border: 1px solid var(--vscode-input-border); 
    border-radius: 6px; 
    padding: 16px; 
    margin-bottom: 20px; 
}
.template-actions { 
    display: flex; 
    gap: 8px; 
    margin-top: 12px; 
    flex-wrap: wrap; 
}
.template-actions button { 
    margin-top: 0; 
    padding: 6px 12px; 
    font-size: 0.9em; 
}
.secondary-button { 
    background-color: var(--vscode-button-secondaryBackground); 
    color: var(--vscode-button-secondaryForeground); 
}
.secondary-button:hover:not([disabled]) { 
    background-color: var(--vscode-button-secondaryHoverBackground); 
}
.template-info { 
    font-size: 0.85em; 
    color: var(--vscode-descriptionForeground); 
    margin-top: 8px; 
}
.modal { 
    display: none; 
    position: fixed; 
    z-index: 1000; 
    left: 0; 
    top: 0; 
    width: 100%; 
    height: 100%; 
    background-color: rgba(0,0,0,0.5); 
}
.modal-content { 
    background-color: var(--vscode-editor-background); 
    margin: 5% auto; 
    padding: 20px; 
    border: 1px solid var(--vscode-input-border); 
    border-radius: 6px; 
    width: 90%; 
    max-width: 500px; 
}
.modal-header { 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
    margin-bottom: 16px; 
}
.modal-title { 
    font-size: 1.1em; 
    font-weight: 600; 
}
.close { 
    font-size: 24px; 
    font-weight: bold; 
    cursor: pointer; 
    color: var(--vscode-descriptionForeground); 
}
.close:hover { 
    color: var(--vscode-foreground); 
}
.template-item {
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 12px;
    margin-bottom: 8px;
    background: var(--vscode-input-background);
}
.template-item h4 {
    margin: 0 0 8px 0;
    color: var(--vscode-foreground);
}
.template-item .category {
    font-size: 0.8em;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    padding: 2px 6px;
    border-radius: 3px;
    display: inline-block;
    margin-bottom: 4px;
}
.template-item .description {
    font-size: 0.9em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 8px;
}
.template-item .metadata {
    font-size: 0.8em;
    color: var(--vscode-descriptionForeground);
}
.template-item-actions {
    display: flex;
    gap: 6px;
    margin-top: 8px;
}
.template-item-actions button {
    padding: 4px 8px;
    font-size: 0.8em;
    margin-top: 0;
}
`;
}

/**
 * Get template section HTML
 */
export function getTemplateSectionHtml(templateOptions: string): string {
    return `
<!-- Template Section -->
<div class="template-section">
    <div class="section-title" style="margin-top: 0;">Templates & Quick Start</div>
    <div class="form-group">
        <label for="templateSelect">Load Template:</label>
        <span class="desc">Select a saved template to populate the form with predefined settings.</span>
        <select id="templateSelect" name="templateSelect">
            <option value="">Select a template...</option>
            ${templateOptions}
        </select>
        <div class="template-info" id="templateInfo"></div>
    </div>
    <div class="template-actions">
        <button type="button" id="loadTemplateBtn" class="secondary-button" disabled>Load Template</button>
        <button type="button" id="saveTemplateBtn" class="secondary-button">Save as Template</button>
        <button type="button" id="manageTemplatesBtn" class="secondary-button">Manage Templates</button>
    </div>
</div>
`;
}

/**
 * Get template management modal HTML
 */
export function getTemplateModalsHtml(): string {    return `
<!-- Save Template Modal -->
<div id="saveTemplateModal" class="modal">
    <div class="modal-content">
        <div class="modal-header">
            <span class="modal-title">Save Template</span>
            <span class="close">&times;</span>
        </div>
        <form id="saveTemplateForm">
            <div class="form-group">
                <label for="templateName">Template Name:</label>
                <input type="text" id="templateName" name="templateName" required placeholder="e.g., CPU Performance Test">
            </div>
            <div class="form-group">
                <label for="templateDescription">Description:</label>
                <textarea id="templateDescription" name="templateDescription" placeholder="Describe what this template is used for..."></textarea>
            </div>
            <div class="form-group">
                <label for="templateCategory">Category:</label>
                <select id="templateCategory" name="templateCategory" required>
                    <option value="Performance">Performance</option>
                    <option value="Stress Testing">Stress Testing</option>
                    <option value="Security">Security</option>
                    <option value="Networking">Networking</option>
                    <option value="Storage">Storage</option>
                    <option value="Benchmarking">Benchmarking</option>
                    <option value="Custom">Custom</option>
                </select>
            </div>
            <div class="form-group">
                <label for="templateTags">Tags (optional):</label>
                <input type="text" id="templateTags" name="templateTags" placeholder="e.g., cpu, benchmark, performance">
                <span class="desc">Comma-separated tags for easy searching.</span>
            </div>
            <div class="template-actions">
                <button type="submit">Save Template</button>
                <button type="button" id="cancelSaveTemplate" class="secondary-button">Cancel</button>
            </div>
        </form>
    </div>
</div>

<!-- Manage Templates Modal -->
<div id="manageTemplatesModal" class="modal">
    <div class="modal-content" style="max-width: 700px;">
        <div class="modal-header">
            <span class="modal-title">Manage Templates</span>
            <span class="close">&times;</span>
        </div>
        <div class="template-actions">
            <button type="button" id="exportTemplatesBtn" class="secondary-button">Export Templates</button>
            <button type="button" id="importTemplatesBtn" class="secondary-button">Import Templates</button>
            <button type="button" id="refreshTemplateListBtn" class="secondary-button">Refresh</button>
        </div>
        <div id="templatesList">
            <!-- Templates will be populated here -->
        </div>
    </div>
</div>
`;
}

/**
 * Get JavaScript code for template functionality
 */
export function getTemplateJavaScript(): string {
    return `
// Template functionality
const templateSelect = document.getElementById('templateSelect');
const templateInfo = document.getElementById('templateInfo');
const loadTemplateBtn = document.getElementById('loadTemplateBtn');
const saveTemplateBtn = document.getElementById('saveTemplateBtn');
const manageTemplatesBtn = document.getElementById('manageTemplatesBtn');

// Template data cache
let availableTemplates = [];

// Initialize template functionality
function initializeTemplates() {
    // Request templates from extension
    vscode.postMessage({ command: 'getTemplates' });
}

// Template selection handler
templateSelect.addEventListener('change', function() {
    const selectedId = this.value;
    if (selectedId) {
        const template = availableTemplates.find(t => t.id === selectedId);
        if (template) {
            showTemplateInfo(template);
            loadTemplateBtn.disabled = false;
        }
    } else {
        templateInfo.innerHTML = '';
        loadTemplateBtn.disabled = true;
    }
});

// Load template button handler
loadTemplateBtn.addEventListener('click', function() {
    const selectedId = templateSelect.value;
    if (selectedId) {
        vscode.postMessage({ command: 'loadTemplate', templateId: selectedId });
    }
});

// Save template button handler
saveTemplateBtn.addEventListener('click', function() {
    document.getElementById('saveTemplateModal').style.display = 'block';
});

// Manage templates button handler
manageTemplatesBtn.addEventListener('click', function() {
    document.getElementById('manageTemplatesModal').style.display = 'block';
    refreshTemplateList();
});

// Show template information
function showTemplateInfo(template) {
    const usageText = template.metadata.usageCount > 0 
        ? \`Used \${template.metadata.usageCount} time(s)\`
        : 'Never used';
    const lastUsed = template.metadata.lastUsedDate 
        ? \`Last used: \${new Date(template.metadata.lastUsedDate).toLocaleDateString()}\`
        : '';
    
    templateInfo.innerHTML = \`
        <strong>\${template.name}</strong><br>
        <em>\${template.description || 'No description'}</em><br>
        Category: \${template.category} | \${usageText}
        \${lastUsed ? '<br>' + lastUsed : ''}
    \`;
}

// Save template modal handlers
function closeSaveTemplateModal() {
    document.getElementById('saveTemplateModal').style.display = 'none';
    document.getElementById('saveTemplateForm').reset();
}

function closeManageTemplatesModal() {
    document.getElementById('manageTemplatesModal').style.display = 'none';
}

// Set up modal close functionality
function setupModalHandlers() {
    // Close modals when clicking outside
    window.addEventListener('click', function(event) {
        const saveModal = document.getElementById('saveTemplateModal');
        const manageModal = document.getElementById('manageTemplatesModal');
        
        if (event.target === saveModal) {
            closeSaveTemplateModal();
        }
        if (event.target === manageModal) {
            closeManageTemplatesModal();
        }
    });
    
    // Set up close button handlers
    const saveCloseBtn = document.querySelector('#saveTemplateModal .close');
    const manageCloseBtn = document.querySelector('#manageTemplatesModal .close');
    
    if (saveCloseBtn) {
        saveCloseBtn.addEventListener('click', closeSaveTemplateModal);
    }
    if (manageCloseBtn) {
        manageCloseBtn.addEventListener('click', closeManageTemplatesModal);
    }
    
    // Set up cancel button handler
    const cancelSaveBtn = document.getElementById('cancelSaveTemplate');
    if (cancelSaveBtn) {
        cancelSaveBtn.addEventListener('click', closeSaveTemplateModal);
    }
    
    // Set up template management button handlers
    const exportBtn = document.getElementById('exportTemplatesBtn');
    const importBtn = document.getElementById('importTemplatesBtn');
    const refreshBtn = document.getElementById('refreshTemplateListBtn');
    
    if (exportBtn) {
        exportBtn.addEventListener('click', exportTemplates);
    }
    if (importBtn) {
        importBtn.addEventListener('click', importTemplates);
    }
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshTemplateList);
    }
    
    // Handle escape key
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            closeSaveTemplateModal();
            closeManageTemplatesModal();
        }
    });
}

// Save template form handler
document.getElementById('saveTemplateForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    console.log('Save template form submitted');
    
    const formData = new FormData(this);
    const templateData = {
        name: formData.get('templateName'),
        description: formData.get('templateDescription'),
        category: formData.get('templateCategory'),
        tags: formData.get('templateTags') ? formData.get('templateTags').split(',').map(t => t.trim()) : [],
        parameters: getFormParams() // Get current form parameters
    };
    
    console.log('Template data to save:', templateData);
    
    vscode.postMessage({ command: 'saveTemplate', templateData });
    closeSaveTemplateModal();
});

// Template management functions
function refreshTemplateList() {
    vscode.postMessage({ command: 'getTemplates' });
}

function exportTemplates() {
    vscode.postMessage({ command: 'exportTemplates' });
}

function importTemplates() {
    vscode.postMessage({ command: 'importTemplates' });
}

function deleteTemplate(templateId) {
    console.log('deleteTemplate called with ID:', templateId);
    if (confirm('Are you sure you want to delete this template?')) {
        console.log('User confirmed deletion, sending message to extension');
        vscode.postMessage({ command: 'deleteTemplate', templateId });
    } else {
        console.log('User cancelled deletion');
    }
}

// Handle messages from extension
window.addEventListener('message', function(event) {
    const message = event.data;
    
    switch (message.command) {
        case 'templatesLoaded':
            availableTemplates = message.templates;
            updateTemplateSelect(message.templates);
            updateTemplatesList(message.templates);
            break;
            
        case 'templateLoaded':
            populateFormFromTemplate(message.template);
            vscode.postMessage({ command: 'showMessage', text: \`Template "\${message.template.name}" loaded successfully\` });
            break;
            
        case 'templateSaved':
            vscode.postMessage({ command: 'showMessage', text: \`Template "\${message.template.name}" saved successfully\` });
            refreshTemplateList();
            break;
              case 'templateDeleted':
            vscode.postMessage({ command: 'showMessage', text: 'Template deleted successfully' });
            refreshTemplateList();
            break;
              case 'enableSubmit':
            submitBtn.disabled = false;
            submitBtn.textContent = 'Run Virtual Client';
            break;
    }
});

// Update template select dropdown
function updateTemplateSelect(templates) {
    const optgroups = {};
    
    // Clear existing options except the first one
    templateSelect.innerHTML = '<option value="">Select a template...</option>';
    
    // Group templates by category
    templates.forEach(template => {
        const category = template.category || 'Custom';
        if (!optgroups[category]) {
            optgroups[category] = document.createElement('optgroup');
            optgroups[category].label = category;
        }
        
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = template.name;
        option.title = \`\${template.name}\${template.description ? ' - ' + template.description : ''}\`;
        
        optgroups[category].appendChild(option);
    });
    
    // Add optgroups to select
    Object.keys(optgroups).sort().forEach(category => {
        templateSelect.appendChild(optgroups[category]);
    });
}

// Update templates list in manage modal
function updateTemplatesList(templates) {
    const templatesList = document.getElementById('templatesList');
    if (!templatesList) return;
    
    if (templates.length === 0) {
        templatesList.innerHTML = '<p>No templates available.</p>';
        return;
    }
    
    templatesList.innerHTML = templates.map(template => \`
        <div class="template-item">
            <div class="category">\${template.category}</div>
            <h4>\${template.name}</h4>
            <div class="description">\${template.description || 'No description'}</div>
            <div class="metadata">
                Created: \${new Date(template.metadata.createdDate).toLocaleDateString()} | 
                Used: \${template.metadata.usageCount} time(s)
                \${template.metadata.lastUsedDate ? ' | Last used: ' + new Date(template.metadata.lastUsedDate).toLocaleDateString() : ''}
            </div>            <div class="template-item-actions">
                <button type="button" data-action="load" data-template-id="\${template.id}" class="secondary-button">Load</button>
                <button type="button" data-action="delete" data-template-id="\${template.id}" class="secondary-button">Delete</button>
            </div>
        </div>
    \`).join('');
    
    // Set up event handlers for template action buttons
    templatesList.querySelectorAll('button[data-action]').forEach(button => {
        button.addEventListener('click', function() {
            const action = this.getAttribute('data-action');
            const templateId = this.getAttribute('data-template-id');
              switch (action) {
                case 'load':
                    loadTemplateById(templateId);
                    break;
                case 'delete':
                    deleteTemplate(templateId);
                    break;
            }
        });
    });
}

// Load template by ID
function loadTemplateById(templateId) {
    vscode.postMessage({ command: 'loadTemplate', templateId });
    closeManageTemplatesModal();
}

// Populate form from template
function populateFormFromTemplate(template) {
    const params = template.parameters;
    
    // Helper function to safely set field value
    function setFieldValue(fieldId, value) {
        const field = document.getElementById(fieldId);
        if (field && value !== undefined && value !== null) {
            field.value = value;
        }
    }
    
    // Helper function to safely set checkbox
    function setCheckboxValue(fieldId, value) {
        const field = document.getElementById(fieldId);
        if (field && value !== undefined && value !== null) {
            field.checked = Boolean(value);
        }
    }
    
    // Basic Configuration
    setFieldValue('packagePath', params.packagePath);
    setFieldValue('profile', params.profile);
    setFieldValue('system', params.system);
    
    // Execution Control
    setFieldValue('timeout', params.timeout);
    setFieldValue('iterations', params.iterations);
    setFieldValue('exitWait', params.exitWait);
    setFieldValue('dependencies', params.dependencies);
    
    // Advanced Parameters
    setFieldValue('proxyApi', params.proxyApi);
    setFieldValue('packageStore', params.packageStore);
    setFieldValue('eventHub', params.eventHub);
    setFieldValue('experimentId', params.experimentId);
    setFieldValue('clientId', params.clientId);
    setFieldValue('metadata', params.metadata);
    setFieldValue('port', params.port);
    setFieldValue('ipAddress', params.ipAddress);
    
    // File Paths
    setFieldValue('contentStore', params.contentStore);
    setFieldValue('contentPath', params.contentPath);
    setFieldValue('layoutPath', params.layoutPath);
    setFieldValue('packageDir', params.packageDir);
    setFieldValue('stateDir', params.stateDir);
    setFieldValue('logDir', params.logDir);
    setFieldValue('logRetention', params.logRetention);
    setFieldValue('seed', params.seed);
    setFieldValue('scenarios', params.scenarios);
    setFieldValue('logger', params.logger);
    setFieldValue('wait', params.wait);
    
    // Options/Checkboxes
    setCheckboxValue('logToFile', params.logToFile);
    setCheckboxValue('debug', params.debug);
    setCheckboxValue('failFast', params.failFast);
    
    // Log Level
    setFieldValue('logLevel', params.logLevel);
    
    // Additional Arguments
    setFieldValue('additionalArgs', params.additionalArgs);
      // Handle Clean Targets
    if (params.clean !== undefined) {
        // Clear all clean checkboxes first
        document.querySelectorAll('input[name="clean_targets"]').forEach(cb => {
            cb.checked = false;
        });
        
        if (params.clean === true || params.clean === 'all') {
            // Check 'all' option
            const allCheckbox = document.getElementById('clean_all');
            if (allCheckbox) allCheckbox.checked = true;
        } else if (typeof params.clean === 'string' && params.clean !== 'false') {
            // Handle comma-separated clean targets
            const cleanTargets = params.clean.split(',').map(t => t.trim());
            cleanTargets.forEach(target => {
                const checkbox = document.getElementById('clean_' + target);
                if (checkbox) checkbox.checked = true;
            });
        }
    }
    
    // Handle Parameters (dynamic parameter rows)
    if (params.parameters && typeof params.parameters === 'string') {
        const paramPairs = params.parameters.split(/[;,]+/).map(s => s.trim()).filter(Boolean).map(pair => {
            const [key, ...rest] = pair.split('=');
            return { key: key.trim(), value: rest.join('=') };
        });
        
        // Clear existing parameter rows
        const paramRows = document.getElementById('paramRows');
        if (paramRows) {
            paramRows.innerHTML = '';
            
            // Add parameter rows from template
            paramPairs.forEach(param => {
                addParameterRow(param.key, param.value);
            });
        }
    }
}

// Helper function to add parameter row
function addParameterRow(key = '', value = '') {
    const paramRows = document.getElementById('paramRows');
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = 
        '<input type="text" class="param-key" placeholder="key" value="' + key.replace(/"/g, '&quot;') + '" aria-label="Parameter key">' +
        '<input type="text" class="param-value" placeholder="value" value="' + value.replace(/"/g, '&quot;') + '" aria-label="Parameter value">' +
        '<button type="button" class="remove-param" title="Remove">&times;</button>';
    
    row.querySelector('.remove-param').onclick = function() {
        row.remove();
    };
    
    paramRows.appendChild(row);
}

// Initialize templates when page loads
initializeTemplates();

// Set up modal handlers after DOM is ready
setupModalHandlers();
`;
}

/**
 * Enhanced Run Virtual Client webview content with template support
 */
export function getEnhancedRunVirtualClientWebviewContent(
    machines: any[], 
    lastParams?: any, 
    _steps?: any[], 
    webview?: vscode.Webview, 
    templates?: RunTemplate[]
): string {
    const machineOptions = machines.map(machine => 
        `<option value="${machine.ip}" ${lastParams?.machineIp === machine.ip ? 'selected' : ''}>${machine.label} (${machine.ip})</option>`
    ).join('');
    
    const templateOptions = templates ? generateTemplateOptions(templates) : '';
    
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
.form-group textarea { width: 100%; min-height: 60px; font-family: monospace; }
.conflict-warning { color: #F44747; font-size: 0.95em; margin-top: 4px; }
${getTemplateStyles()}
</style>
</head>
<body>
<form id="runForm" autocomplete="off" novalidate>

${getTemplateSectionHtml(templateOptions)}

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
<input type="text" id="packagePath" name="packagePath" value="${lastParams?.packagePath || ''}" required aria-required="true" placeholder="C:\\\\path\\\\to\\\\VirtualClient.zip">
<div class="error-message" id="packagePathError">Please provide a valid package path.</div>
</div>
<div class="form-group">
<div style="display: flex; align-items: center; margin-top: 8px;">
<input type="checkbox" id="cleanRemotePackages" name="cleanRemotePackages" ${lastParams?.cleanRemotePackages ? 'checked' : ''}>
<label for="cleanRemotePackages" style="margin-left: 8px; font-weight: normal;">Clean remote packages before deployment</label>
</div>
<span class="desc" style="margin-left: 24px; font-size: 12px; color: var(--vscode-descriptionForeground);">
This will delete all existing Virtual Client packages and extracted folders from the VirtualClientScheduler directory on the remote machine before uploading the new package.
</span>
</div>
<div class="form-group">
<label for="profile">Profile (--profile):</label>
<span class="desc">The workload profile to execute. Example: 'PERF-CPU-OPENSSL.json'.</span>
<input type="text" id="profile" name="profile" required aria-required="true"
  placeholder="e.g. PERF-CPU-OPENSSL.json"
  value="${lastParams?.profile ? lastParams.profile.replace(/"/g, '&quot;') : ''}">
<div class="error-message" id="profileError">Please enter a profile name or path.</div>
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
<div class="form-group">
<label for="contentStore">Content Store (--content-store):</label>
<span class="desc">Azure Storage Account for uploading files/content.</span>
<input type="text" id="contentStore" name="contentStore" value="${lastParams?.contentStore || ''}">
</div>
<div class="form-group">
<label for="contentPath">Content Path (--content-path):</label>
<span class="desc">Content path format/structure for uploads.</span>
<input type="text" id="contentPath" name="contentPath" value="${lastParams?.contentPath || ''}">
</div>
<div class="form-group">
<label for="layoutPath">Layout Path (--layout-path):</label>
<span class="desc">Path to environment layout file.</span>
<input type="text" id="layoutPath" name="layoutPath" value="${lastParams?.layoutPath || ''}">
</div>
<div class="form-group">
<label for="logDir">Log Directory (--log-dir):</label>
<span class="desc">Alternate directory for log files.</span>
<input type="text" id="logDir" name="logDir" value="${lastParams?.logDir || ''}">
</div>
<div class="form-group">
<label for="logRetention">Log Retention (--log-retention):</label>
<span class="desc">Log retention period (e.g. 2880, 02.00:00:00).</span>
<input type="text" id="logRetention" name="logRetention" value="${lastParams?.logRetention || ''}">
</div>
<div class="form-group">
<label for="packageDir">Package Directory (--package-dir):</label>
<span class="desc">Alternate directory for packages.</span>
<input type="text" id="packageDir" name="packageDir" value="${lastParams?.packageDir || ''}">
</div>
<div class="form-group">
<label for="stateDir">State Directory (--state-dir):</label>
<span class="desc">Alternate directory for state files.</span>
<input type="text" id="stateDir" name="stateDir" value="${lastParams?.stateDir || ''}">
</div>
<div class="form-group">
<label for="seed">Seed (--seed):</label>
<span class="desc">Randomization seed.</span>
<input type="text" id="seed" name="seed" value="${lastParams?.seed || ''}">
</div>
<div class="form-group">
<label for="scenarios">Scenarios (--scenarios):</label>
<span class="desc">Comma-delimited list of scenarios to include/exclude.</span>
<input type="text" id="scenarios" name="scenarios" value="${lastParams?.scenarios || ''}">
</div>
<div class="form-group">
<label for="logger">Logger (--logger):</label>
<span class="desc">Logger definition string(s).</span>
<input type="text" id="logger" name="logger" value="${lastParams?.logger || ''}">
</div>
<div class="form-group">
<label for="wait">Wait (--wait/--exit-wait/--flush-wait):</label>
<span class="desc">Time to wait for completion/telemetry flush.</span>
<input type="text" id="wait" name="wait" value="${lastParams?.wait || ''}">
</div>
<div class="form-group">
<label for="additionalArgs">Additional Command Arguments:</label>
<span class="desc">Any extra CLI arguments (e.g. --parameters=foo=bar --clean=logs). If a parameter is present here and in the form, this value will be used and a warning will be shown.</span>
<textarea id="additionalArgs" name="additionalArgs">${lastParams?.additionalArgs || ''}</textarea>
<div id="conflictWarning" class="conflict-warning" style="display:none;"></div>
</div>
<div class="section-title">Options</div>
<div class="form-group">
<div class="checkbox-group">
<div class="checkbox-item">
<input type="checkbox" id="logToFile" name="logToFile" ${lastParams?.logToFile ? 'checked' : ''}>
<label for="logToFile">Log to File (--log-to-file)</label>
</div>
<div class="checkbox-item">
<label>Clean (--clean):</label>
<div class="checkbox-group" id="cleanGroup">
<div class="checkbox-item"><input type="checkbox" id="clean_logs" name="clean_targets" value="logs" ${(lastParams?.clean_targets||[]).includes('logs') ? 'checked' : ''}><label for="clean_logs">logs</label></div>
<div class="checkbox-item"><input type="checkbox" id="clean_packages" name="clean_targets" value="packages" ${(lastParams?.clean_targets||[]).includes('packages') ? 'checked' : ''}><label for="clean_packages">packages</label></div>
<div class="checkbox-item"><input type="checkbox" id="clean_state" name="clean_targets" value="state" ${(lastParams?.clean_targets||[]).includes('state') ? 'checked' : ''}><label for="clean_state">state</label></div>
<div class="checkbox-item"><input type="checkbox" id="clean_all" name="clean_targets" value="all" ${(lastParams?.clean_targets||[]).includes('all') ? 'checked' : ''}><label for="clean_all">all</label></div>
</div>
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

${getTemplateModalsHtml()}

<script>
(function() {
const vscode = acquireVsCodeApi();
const form = document.getElementById('runForm');
const machineSelect = document.getElementById('machine');
const submitBtn = document.getElementById('submitBtn');
const paramRows = document.getElementById('paramRows');
const addParamBtn = document.getElementById('addParamBtn');
const additionalArgs = document.getElementById('additionalArgs');
const conflictWarning = document.getElementById('conflictWarning');

${getTemplateJavaScript()}

// Existing functionality (parameter management, form validation, etc.)
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
      '<input type="text" class="param-value" placeholder="value" value="' + (p.value || '') + '" aria-label="Parameter value">' +      '<button type="button" class="remove-param" title="Remove">&times;</button>';
    row.querySelector('.remove-param').onclick = function() {
      params.splice(idx, 1);
      renderParamRows();
    };    paramRows.appendChild(row);
  });
};

if (paramRows.children.length === 0 && ${paramPairs.length} > 0) {
  renderParamRows();
}

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
  var profile = document.getElementById('profile');
  if (!profile.value.trim()) {
    showError('profileError', true, 'Please enter a profile name or path.');
    valid = false;
  } else {
    showError('profileError', false);
  }
  return valid;
}

function getFormParams() {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = value;
  });  ['logToFile', 'debug', 'failFast', 'cleanRemotePackages'].forEach(cb => {
    data[cb] = form[cb]?.checked || false;
  });
  const cleanTargets = Array.from(document.querySelectorAll('input[name="clean_targets"]:checked')).map(cb => cb.value);
  if (cleanTargets.includes('all')) {
    data.clean = true;
  } else if (cleanTargets.length > 0) {
    data.clean = cleanTargets.join(',');
  } else {
    data.clean = false;
  }
  const params = [];
  paramRows.querySelectorAll('.param-row').forEach(row => {
    const key = row.querySelector('.param-key').value.trim();
    const value = row.querySelector('.param-value').value.trim();
    if (key) params.push(key + '=' + value);
  });
  data.parameters = params.join(';');
  return data;
}

function parseAdditionalArgs(args) {
  const regex = /--([\w-]+)(?:[= ]([^\s]+))?/g;
  const found = {};
  let match;
  while ((match = regex.exec(args)) !== null) {
    found[match[1]] = match[2] || true;
  }
  return found;
}

function checkConflicts(formData, additionalArgsObj) {
  const conflicts = [];
  Object.keys(formData).forEach(key => {
    let cliKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    if (cliKey.startsWith('-')) cliKey = cliKey.slice(1);
    if (additionalArgsObj[cliKey]) {
      conflicts.push('Parameter --' + cliKey + ' is set in both the form and additional arguments. The value from additional arguments will be used.');
    }
  });
  return conflicts;
}

form.addEventListener('submit', function(e) {
  e.preventDefault();
  if (!validate()) return;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Running...';
  const formData = getFormParams();
  const additionalArgsVal = additionalArgs.value.trim();
  let additionalArgsObj = {};
  if (additionalArgsVal) {
    additionalArgsObj = parseAdditionalArgs(additionalArgsVal);
  }
  const conflicts = checkConflicts(formData, additionalArgsObj);
  if (conflicts.length > 0) {
    conflictWarning.style.display = '';
    conflictWarning.innerHTML = conflicts.map(function(c) { return '<div>' + c + '</div>'; }).join('');
  } else {
    conflictWarning.style.display = 'none';
  }
  Object.keys(additionalArgsObj).forEach(key => {
    formData[key] = additionalArgsObj[key];
  });
  vscode.postMessage({ command: 'run', ...formData, additionalArgs: additionalArgsVal });
});

})();
</script>
</body>
</html>`;
}
