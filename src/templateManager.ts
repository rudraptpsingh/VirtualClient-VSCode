/**
 * Template management system for Virtual Client extension
 * Handles saving, loading, and managing run configuration templates
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { sanitizeLabel } from './utils';
import { TEMPLATES_DIR_NAME } from './constants';
import { ensureDirectoryExistsWithLogging } from './fileUtils';
import type { Logger } from './types';

/**
 * Interface for a run template
 */
export interface RunTemplate {
    id: string;
    name: string;
    description?: string;
    category: TemplateCategory;
    parameters: TemplateParameters;
    metadata: TemplateMetadata;
}

/**
 * Template categories for organization
 */
export enum TemplateCategory {
    Performance = 'Performance',
    Stress = 'Stress Testing',
    Security = 'Security',
    Networking = 'Networking',
    Storage = 'Storage',
    Custom = 'Custom',
    Benchmarking = 'Benchmarking'
}

/**
 * Template parameters - all the configurable options
 */
export interface TemplateParameters {
    // Basic Configuration
    packagePath?: string;
    profile: string;
    system?: string;
    
    // Execution Control
    timeout?: number;
    iterations?: number;
    exitWait?: number;
    dependencies?: string;
    
    // Advanced Parameters
    parameters?: string; // key=value pairs
    proxyApi?: string;
    packageStore?: string;
    eventHub?: string;
    experimentId?: string;
    clientId?: string;
    metadata?: string;
    port?: string;
    ipAddress?: string;
    
    // File Paths
    contentStore?: string;
    contentPath?: string;
    layoutPath?: string;
    packageDir?: string;
    stateDir?: string;
    logDir?: string;
    logRetention?: string;
    seed?: string;
    scenarios?: string;
    logger?: string;
    wait?: string;
    
    // Options/Flags
    logToFile?: boolean;
    clean?: boolean | string; // can be boolean or comma-separated values
    debug?: boolean;
    failFast?: boolean;
    logLevel?: string;
    
    // Additional Arguments
    additionalArgs?: string;
}

/**
 * Template metadata
 */
export interface TemplateMetadata {
    createdDate: string;
    lastUsedDate?: string;
    usageCount: number;
    version: string;
    author?: string;
    tags?: string[];
}

/**
 * Template manager class
 */
export class TemplateManager {
    private context: vscode.ExtensionContext;
    private logger?: Logger;
    private templates: Map<string, RunTemplate> = new Map();

    constructor(context: vscode.ExtensionContext, logger?: Logger) {
        this.context = context;
        this.logger = logger;
    }

    /**
     * Initialize the template manager and load existing templates
     */
    async initialize(): Promise<void> {
        try {
            const templatesDir = this.getTemplatesDirectory();
            await ensureDirectoryExistsWithLogging(templatesDir, this.logger);
            await this.loadTemplatesFromDisk();
            this.logger?.info?.('Template manager initialized successfully');
        } catch (error) {
            this.logger?.error?.(`Failed to initialize template manager: ${error}`);
            throw error;
        }
    }    /**
     * Save a new template
     */    async saveTemplate(
        name: string,
        description: string,        parameters: TemplateParameters,
        category: TemplateCategory,
        tags?: string[]
    ): Promise<RunTemplate> {
        try {
            // Generate unique ID
            const id = this.generateTemplateId(name);
            
            // Create template object
            const template: RunTemplate = {
                id,
                name: name.trim(),
                description: description.trim(),
                category,
                parameters,
                metadata: {
                    createdDate: new Date().toISOString(),
                    usageCount: 0,
                    version: '1.0.0',
                    author: 'user',
                    tags: tags || []                }
            };

            // Save to memory
            this.templates.set(id, template);

            // Save to disk
            await this.saveTemplateToDisk(template);

            this.logger?.info?.(`Template '${name}' saved successfully`);
            return template;
        } catch (error) {
            const message = `Failed to save template: ${error instanceof Error ? error.message : error}`;
            this.logger?.error?.(message);
            throw new Error(message);
        }
    }

    /**
     * Load a template by ID
     */
    async loadTemplate(id: string): Promise<RunTemplate | undefined> {
        try {
            const template = this.templates.get(id);
            if (template) {
                // Update usage statistics
                template.metadata.lastUsedDate = new Date().toISOString();
                template.metadata.usageCount++;
                
                // Save updated template
                await this.saveTemplateToDisk(template);
                
                this.logger?.debug?.(`Template '${template.name}' loaded successfully`);
                return template;
            }
            return undefined;
        } catch (error) {
            this.logger?.error?.(`Failed to load template: ${error}`);
            return undefined;
        }
    }

    /**
     * Get all templates
     */
    getAllTemplates(): RunTemplate[] {
        return Array.from(this.templates.values()).sort((a, b) => {
            // Sort by category, then by name
            if (a.category !== b.category) {
                return a.category.localeCompare(b.category);
            }
            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Get templates by category
     */
    getTemplatesByCategory(category: TemplateCategory): RunTemplate[] {
        return this.getAllTemplates().filter(t => t.category === category);
    }    /**
     * Delete a template
     */
    async deleteTemplate(id: string): Promise<boolean> {
        try {
            this.logger?.info?.(`Attempting to delete template with ID: ${id}`);
            this.logger?.info?.(`Available template IDs: ${Array.from(this.templates.keys()).join(', ')}`);
            
            const template = this.templates.get(id);
            if (!template) {
                this.logger?.warn?.(`Template with ID '${id}' not found in memory`);
                return false;
            }

            // Remove from memory
            this.templates.delete(id);

            // Remove from disk
            await this.deleteTemplateFromDisk(id);

            this.logger?.info?.(`Template '${template.name}' deleted successfully`);
            return true;
        } catch (error) {
            this.logger?.error?.(`Failed to delete template: ${error}`);
            return false;
        }
    }

    /**
     * Update an existing template
     */
    async updateTemplate(id: string, updates: Partial<RunTemplate>): Promise<RunTemplate | undefined> {
        try {
            const template = this.templates.get(id);
            if (!template) {
                return undefined;
            }

            // Update template
            const updatedTemplate = {
                ...template,
                ...updates,
                id, // Ensure ID doesn't change
                metadata: {
                    ...template.metadata,
                    ...updates.metadata
                }
            };

            // Save to memory
            this.templates.set(id, updatedTemplate);

            // Save to disk
            await this.saveTemplateToDisk(updatedTemplate);

            this.logger?.info?.(`Template '${template.name}' updated successfully`);
            return updatedTemplate;
        } catch (error) {
            this.logger?.error?.(`Failed to update template: ${error}`);
            return undefined;
        }
    }    /**
     * Export template(s) to JSON file
     */
    async exportTemplates(templateIds: string[], exportPath: string): Promise<boolean> {
        try {
            const templatesToExport = templateIds
                .map(id => this.templates.get(id))
                .filter((t): t is RunTemplate => t !== undefined);

            if (templatesToExport.length === 0) {
                throw new Error('No valid templates found to export');
            }

            const exportData = {
                version: '1.0.0',
                exportDate: new Date().toISOString(),
                templates: templatesToExport
            };

            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(exportPath),
                Buffer.from(JSON.stringify(exportData, null, 2), 'utf8')
            );

            this.logger?.info?.(`Exported ${templatesToExport.length} template(s) to ${exportPath}`);
            return true;
        } catch (error) {
            this.logger?.error?.(`Failed to export templates: ${error}`);
            return false;
        }
    }

    /**
     * Import templates from JSON file
     */
    async importTemplates(importPath: string, overwrite: boolean = false): Promise<number> {
        try {
            const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(importPath));
            const importData = JSON.parse(fileContent.toString());

            if (!importData.templates || !Array.isArray(importData.templates)) {
                throw new Error('Invalid template file format');
            }

            let importCount = 0;
            for (const templateData of importData.templates) {
                const existingTemplate = this.templates.get(templateData.id);
                
                if (existingTemplate && !overwrite) {
                    // Skip if template exists and overwrite is false
                    continue;
                }

                // Update metadata for import
                templateData.metadata = {
                    ...templateData.metadata,
                    createdDate: existingTemplate?.metadata.createdDate || new Date().toISOString(),
                    usageCount: existingTemplate?.metadata.usageCount || 0
                };

                this.templates.set(templateData.id, templateData);
                await this.saveTemplateToDisk(templateData);
                importCount++;
            }

            this.logger?.info?.(`Imported ${importCount} template(s) from ${importPath}`);
            return importCount;
        } catch (error) {
            this.logger?.error?.(`Failed to import templates: ${error}`);
            return 0;
        }
    }

    // Private helper methods

    private getTemplatesDirectory(): string {
        return path.join(this.context.globalStorageUri.fsPath, TEMPLATES_DIR_NAME);
    }

    private generateTemplateId(name: string): string {
        const sanitizedName = sanitizeLabel(name);
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 5);
        return `${sanitizedName}_${timestamp}_${random}`;
    }

    private async loadTemplatesFromDisk(): Promise<void> {
        try {
            const templatesDir = this.getTemplatesDirectory();
            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(templatesDir));
            
            for (const [fileName, fileType] of files) {
                if (fileType === vscode.FileType.File && fileName.endsWith('.json')) {
                    try {
                        const filePath = path.join(templatesDir, fileName);
                        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
                        const template: RunTemplate = JSON.parse(content.toString());
                        
                        // Validate template structure
                        if (this.isValidTemplate(template)) {
                            this.templates.set(template.id, template);
                        } else {
                            this.logger?.warn?.(`Invalid template file: ${fileName}`);
                        }
                    } catch (error) {
                        this.logger?.warn?.(`Failed to load template file ${fileName}: ${error}`);
                    }
                }
            }

            this.logger?.debug?.(`Loaded ${this.templates.size} template(s) from disk`);
        } catch (error) {
            this.logger?.error?.(`Failed to load templates from disk: ${error}`);
        }
    }

    private async saveTemplateToDisk(template: RunTemplate): Promise<void> {
        const templatesDir = this.getTemplatesDirectory();
        const fileName = `${template.id}.json`;
        const filePath = path.join(templatesDir, fileName);

        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(filePath),
            Buffer.from(JSON.stringify(template, null, 2), 'utf8')
        );
    }

    private async deleteTemplateFromDisk(id: string): Promise<void> {
        const templatesDir = this.getTemplatesDirectory();
        const fileName = `${id}.json`;
        const filePath = path.join(templatesDir, fileName);

        try {
            await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
        } catch (error) {
            // File might not exist, which is fine
            this.logger?.debug?.(`Template file ${fileName} not found on disk`);
        }
    }

    private isValidTemplate(template: any): template is RunTemplate {
        return (
            template &&
            typeof template.id === 'string' &&
            typeof template.name === 'string' &&
            typeof template.category === 'string' &&
            template.parameters &&
            template.metadata &&
            typeof template.parameters.profile === 'string'
        );
    }
}
