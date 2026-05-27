/**
 * Bidirectional Folgezettel Plugin for Obsidian
 * 
 * Translated from org-roam-folgezettel.el by Blaine Mooers.
 * 
 * When you create a new note with a folgezettel in its title, this plugin
 * will automatically:
 * 1. Parse the folgezettel to identify the parent note's address
 * 2. Search the vault for the parent note
 * 3. Insert a backlink to the parent note in the new note's content
 * 4. Optionally insert a forward link in the parent note
 * 
 * Additionally, the plugin supports automatic bidirectional cross-linking
 * when you manually create links between notes.
 * 
 * Supports both wikilink and markdown-style links.
 */

import {
    App,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    TAbstractFile,
    TFolder,
    Notice,
    MarkdownView,
    Modal,
    TextComponent,
    Editor
} from 'obsidian';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Result of validating a folgezettel address.
 * Contains whether the address is valid and any error messages.
 */
interface ValidationResult {
    valid: boolean;
    error: string | null;
}

/**
 * Result of validating an address including duplicate checking.
 */
interface AddressValidationResult {
    isValid: boolean;
    isDuplicate: boolean;
    existingFile: TFile | null;
    message: string;
}

/**
 * Characters that are invalid in file names across operating systems.
 */
const INVALID_FILENAME_CHARS = /[\/\\:|<>"?*!;&${}`,'\[\]]/;

/**
 * Human-readable list of invalid characters for error messages.
 */
const INVALID_CHARS_DISPLAY = '/ \\ : | < > " ? * ! ; & $ { } ` , \' [ ]';

/**
 * Link style options.
 */
type LinkStyle = 'wikilink' | 'markdown';

/**
 * Plugin settings interface.
 */
interface FolgezettelSettings {
    /** Whether to automatically process new notes */
    autoProcess: boolean;
    /** Whether to show notifications for link operations */
    showNotifications: boolean;
    /** Whether to automatically create bidirectional cross-links */
    autoBidirectionalLinks: boolean;
    /** Description text for parent links */
    parentLinkDescription: string;
    /** Description text for child links */
    childLinkDescription: string;
    /** Heading under which to insert parent backlinks */
    backlinkHeading: string;
    /** Heading under which to insert child forward links */
    forwardLinkHeading: string;
    /** Heading under which to insert cross-links */
    crossLinkHeading: string;
    /** Regular expression pattern for folgezettel addresses */
    folgezettelRegex: string;
    /** Path to template folder for general templates */
    templateFolder: string;
    /** Path to default template for new notes */
    defaultTemplate: string;
    
    // Child Note Template Settings
    /** Path to template file for child notes (core Templates plugin) */
    childNoteTemplatePath: string;
    /** Path to template file for child notes (Templater plugin) */
    childNoteTemplaterPath: string;
    /** Which template system to use for child notes: 'core', 'templater', or 'none' */
    childNoteTemplateSource: 'core' | 'templater' | 'none';
    
    // Link Style Setting
    /** Style of links to generate: 'wikilink' or 'markdown' */
    linkStyle: LinkStyle;
}

/**
 * Parsed folgezettel address structure.
 */
interface ParsedAddress {
    segments: (number | string)[];
    raw: string;
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: FolgezettelSettings = {
    autoProcess: true,
    showNotifications: true,
    autoBidirectionalLinks: true,
    parentLinkDescription: 'Parent',
    childLinkDescription: '',
    backlinkHeading: 'Related Notes',
    forwardLinkHeading: 'Child Notes',
    crossLinkHeading: 'Related Notes',
    folgezettelRegex: '([0-9]+(?:[.][0-9]+)*(?:[a-z]+(?:[0-9]+)?)*)',
    templateFolder: 'Templates',
    defaultTemplate: '',
    
    // Child Note Template Defaults
    childNoteTemplatePath: '',
    childNoteTemplaterPath: '',
    childNoteTemplateSource: 'none',
    
    // Link Style Default
    linkStyle: 'wikilink'
};

// ============================================================================
// Modal Classes
// ============================================================================

/**
 * Modal for confirming creation of a note with a duplicate address.
 */
class DuplicateAddressModal extends Modal {
    private address: string;
    private existingFile: TFile;
    private onConfirm: () => void;
    private onCancel: () => void;

    constructor(
        app: App,
        address: string,
        existingFile: TFile,
        onConfirm: () => void,
        onCancel: () => void
    ) {
        super(app);
        this.address = address;
        this.existingFile = existingFile;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Duplicate Address Warning' });

        contentEl.createEl('p', {
            text: `A note with address "${this.address}" already exists:`
        });

        contentEl.createEl('p', {
            text: this.existingFile.path,
            cls: 'mod-warning'
        });

        contentEl.createEl('p', {
            text: 'Do you want to create this note anyway?'
        });

        const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.marginTop = '20px';

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => {
            this.close();
            this.onCancel();
        });

        const confirmButton = buttonContainer.createEl('button', {
            text: 'Create Anyway',
            cls: 'mod-warning'
        });
        confirmButton.style.backgroundColor = 'var(--interactive-accent)';
        confirmButton.style.color = 'var(--text-on-accent)';
        confirmButton.addEventListener('click', () => {
            this.close();
            this.onConfirm();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Modal for warning about duplicate addresses after file creation/rename.
 */
class DuplicateAddressWarningModal extends Modal {
    private address: string;
    private newFile: TFile;
    private existingFile: TFile;

    constructor(app: App, address: string, newFile: TFile, existingFile: TFile) {
        super(app);
        this.address = address;
        this.newFile = newFile;
        this.existingFile = existingFile;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: '⚠️ Duplicate Folgezettel Address' });

        contentEl.createEl('p', {
            text: `The address "${this.address}" is already used by another note.`
        });

        contentEl.createEl('p', { text: 'New file:' });
        contentEl.createEl('code', { text: this.newFile.path });

        contentEl.createEl('p', { text: 'Existing file:' });
        contentEl.createEl('code', { text: this.existingFile.path });

        contentEl.createEl('p', {
            text: 'Consider renaming one of these files to maintain unique addresses.',
            cls: 'mod-warning'
        });

        const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.marginTop = '20px';

        const closeButton = buttonContainer.createEl('button', { text: 'OK' });
        closeButton.addEventListener('click', () => {
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * The two headings available in the 00.0 index of indices.
 * Root notes are filed under one of these categories.
 */
const INDEX_HEADINGS = ['Subject Matter', 'Project Support'] as const;
type IndexHeading = typeof INDEX_HEADINGS[number];

/**
 * Modal for choosing which heading in the 00.0 index of indices
 * a new root note should be filed under.
 */
class IndexHeadingModal extends Modal {
    private onSelect: (heading: string) => void;
    private onCancel: () => void;

    constructor(
        app: App,
        onSelect: (heading: string) => void,
        onCancel: () => void
    ) {
        super(app);
        this.onSelect = onSelect;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Index Heading' });
        contentEl.createEl('p', {
            text: 'Under which heading in the 00.0 index should this root note be listed?'
        });

        const optionsContainer = contentEl.createEl('div');
        optionsContainer.style.display = 'flex';
        optionsContainer.style.flexDirection = 'column';
        optionsContainer.style.gap = '10px';
        optionsContainer.style.marginTop = '15px';

        for (const heading of INDEX_HEADINGS) {
            const btn = optionsContainer.createEl('button', { text: heading });
            btn.style.padding = '10px';
            btn.addEventListener('click', () => {
                this.close();
                this.onSelect(heading);
            });
        }

        const cancelContainer = contentEl.createEl('div');
        cancelContainer.style.marginTop = '15px';
        cancelContainer.style.textAlign = 'right';

        const cancelButton = cancelContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => {
            this.close();
            this.onCancel();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Modal for text input (e.g., note name).
 */
class TextInputModal extends Modal {
    private title: string;
    private placeholder: string;
    private onSubmit: (value: string) => void;
    private inputEl: HTMLInputElement | null = null;

    constructor(
        app: App,
        title: string,
        placeholder: string,
        onSubmit: (value: string) => void
    ) {
        super(app);
        this.title = title;
        this.placeholder = placeholder;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: this.title });

        this.inputEl = contentEl.createEl('input', {
            type: 'text',
            placeholder: this.placeholder
        });
        this.inputEl.style.width = '100%';
        this.inputEl.style.padding = '8px';
        this.inputEl.style.marginBottom = '15px';

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.submit();
            } else if (e.key === 'Escape') {
                this.close();
            }
        });

        const buttonContainer = contentEl.createEl('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.gap = '10px';

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => this.close());

        const submitButton = buttonContainer.createEl('button', { text: 'Create' });
        submitButton.style.backgroundColor = 'var(--interactive-accent)';
        submitButton.style.color = 'var(--text-on-accent)';
        submitButton.addEventListener('click', () => this.submit());

        // Focus the input
        setTimeout(() => this.inputEl?.focus(), 10);
    }

    private submit() {
        const value = this.inputEl?.value.trim();
        if (value) {
            this.close();
            this.onSubmit(value);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Modal for selecting a template file.
 */
class TemplatePicker extends Modal {
    private plugin: BidirectionalFolgezettelPlugin;
    private onSelect: (template: TFile | null) => void;
    private templates: TFile[] = [];

    constructor(
        app: App,
        plugin: BidirectionalFolgezettelPlugin,
        onSelect: (template: TFile | null) => void
    ) {
        super(app);
        this.plugin = plugin;
        this.onSelect = onSelect;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Select Template' });

        // Get templates from folder
        this.templates = await this.getTemplates();

        if (this.templates.length === 0) {
            contentEl.createEl('p', {
                text: 'No templates found. Configure the template folder in settings.'
            });
        } else {
            const list = contentEl.createEl('div');
            list.style.maxHeight = '300px';
            list.style.overflowY = 'auto';

            // No template option
            const noTemplateItem = list.createEl('div', {
                text: '(No template)',
                cls: 'suggestion-item'
            });
            noTemplateItem.style.padding = '8px';
            noTemplateItem.style.cursor = 'pointer';
            noTemplateItem.addEventListener('click', () => {
                this.close();
                this.onSelect(null);
            });
            noTemplateItem.addEventListener('mouseenter', () => {
                noTemplateItem.style.backgroundColor = 'var(--background-modifier-hover)';
            });
            noTemplateItem.addEventListener('mouseleave', () => {
                noTemplateItem.style.backgroundColor = '';
            });

            // Template options
            for (const template of this.templates) {
                const item = list.createEl('div', {
                    text: template.basename,
                    cls: 'suggestion-item'
                });
                item.style.padding = '8px';
                item.style.cursor = 'pointer';
                item.addEventListener('click', () => {
                    this.close();
                    this.onSelect(template);
                });
                item.addEventListener('mouseenter', () => {
                    item.style.backgroundColor = 'var(--background-modifier-hover)';
                });
                item.addEventListener('mouseleave', () => {
                    item.style.backgroundColor = '';
                });
            }
        }

        const cancelButton = contentEl.createEl('button', { text: 'Cancel' });
        cancelButton.style.marginTop = '15px';
        cancelButton.addEventListener('click', () => this.close());
    }

    private async getTemplates(): Promise<TFile[]> {
        const templateFolder = this.plugin.settings.templateFolder;
        if (!templateFolder) return [];

        const folder = this.app.vault.getAbstractFileByPath(templateFolder);
        if (!folder || !(folder instanceof TFolder)) return [];

        const templates: TFile[] = [];
        const collectTemplates = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFile && child.extension === 'md') {
                    templates.push(child);
                } else if (child instanceof TFolder) {
                    collectTemplates(child);
                }
            }
        };

        collectTemplates(folder);
        return templates.sort((a, b) => a.basename.localeCompare(b.basename));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// ============================================================================
// Main Plugin Class
// ============================================================================

export default class BidirectionalFolgezettelPlugin extends Plugin {
    settings: FolgezettelSettings;
    private fileContentCache: Map<string, Set<string>> = new Map();
    private processingFiles: Set<string> = new Set();
    private recentlyCreatedFiles: Set<string> = new Set();
    private folgezettelRegexCompiled: RegExp | null = null;

    // Timestamp tracking for recently created files to prevent cross-link interference
    private fileCreationTimes: Map<string, number> = new Map();
    private readonly CREATION_GRACE_PERIOD = 5000; // 5 seconds

    // Guard: true only after Obsidian's layout is fully ready.
    // Prevents modals from firing during the vault-indexing phase of startup.
    private layoutReady = false;

    async onload() {
        await this.loadSettings();
        this.compileRegex();

        // Mark layout as ready once Obsidian finishes loading.
        this.app.workspace.onLayoutReady(() => {
            this.layoutReady = true;
        });

        // Register commands
        this.addCommand({
            id: 'add-backlink-to-parent',
            name: 'Add backlink to parent note',
            callback: () => this.addBacklinkToParent()
        });

        this.addCommand({
            id: 'create-first-child',
            name: 'Create first child note',
            callback: () => this.createFirstChild()
        });

        this.addCommand({
            id: 'create-next-child',
            name: 'Create next child note',
            callback: () => this.createNextChild()
        });

        this.addCommand({
            id: 'suggest-next-child',
            name: 'Suggest next child address',
            callback: () => this.suggestNextChildCommand()
        });

        this.addCommand({
            id: 'select-template-new-note',
            name: 'Select template for new note',
            callback: () => this.selectTemplateAndCreateNote()
        });

        this.addCommand({
            id: 'create-folgezettel-note',
            name: 'Create new folgezettel note',
            callback: () => this.promptForFolgezettelalNote()
        });

        // Add ribbon icon
        this.addRibbonIcon('link', 'Folgezettel: Add parent link', () => {
            this.addBacklinkToParent();
        });

        // Register event handlers for new file creation.
        // The layoutReady guard prevents processing during Obsidian's
        // startup vault-indexing phase, which fires 'create' for every
        // existing file and would otherwise open modals before the UI
        // is ready.
        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (!this.layoutReady) return;
                if (file instanceof TFile) {
                    this.recentlyCreatedFiles.add(file.path);
                    this.fileCreationTimes.set(file.path, Date.now());
                    this.checkForDuplicateAddress(file);
                    if (this.settings.autoProcess) {
                        this.processNewFile(file);
                    }
                }
            })
        );

        // Event handler for file rename
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (!this.layoutReady) return;
                if (file instanceof TFile) {
                    if (this.recentlyCreatedFiles.has(oldPath)) {
                        this.recentlyCreatedFiles.delete(oldPath);
                        this.recentlyCreatedFiles.add(file.path);
                    }
                    if (this.fileCreationTimes.has(oldPath)) {
                        const time = this.fileCreationTimes.get(oldPath)!;
                        this.fileCreationTimes.delete(oldPath);
                        this.fileCreationTimes.set(file.path, time);
                    }
                    this.checkForDuplicateAddress(file);
                    if (this.settings.autoProcess) {
                        this.processNewFile(file);
                    }
                }
            })
        );

        // Event handler for bidirectional cross-linking
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (!this.layoutReady) return;
                if (this.settings.autoBidirectionalLinks && file instanceof TFile) {
                    this.onFileModify(file);
                }
            })
        );

        // Add settings tab
        this.addSettingTab(new FolgezettelSettingTab(this.app, this));
    }

    onunload() {
        this.fileContentCache.clear();
        this.recentlyCreatedFiles.clear();
        this.processingFiles.clear();
        this.fileCreationTimes.clear();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * Compile the folgezettel regex from settings.
     */
    private compileRegex() {
        try {
            this.folgezettelRegexCompiled = new RegExp(this.settings.folgezettelRegex);
        } catch (e) {
            console.error('Invalid folgezettel regex:', e);
            this.folgezettelRegexCompiled = new RegExp(DEFAULT_SETTINGS.folgezettelRegex);
        }
    }

    /**
     * Check if a file is within the creation grace period.
     * During this period, cross-link detection is suppressed.
     */
    private isWithinCreationGracePeriod(filePath: string): boolean {
        const creationTime = this.fileCreationTimes.get(filePath);
        if (!creationTime) return false;
        return (Date.now() - creationTime) < this.CREATION_GRACE_PERIOD;
    }

    // ========================================================================
    // Link Generation Methods
    // ========================================================================

    /**
     * Generate a link to a file using the configured link style.
     * 
     * @param targetFile - The file to link to
     * @param description - The link description/alias
     * @param sourceFile - The file containing the link (needed for relative paths in markdown)
     * @returns Formatted link string
     */
    generateLink(targetFile: TFile, description: string, sourceFile?: TFile): string {
        if (this.settings.linkStyle === 'markdown') {
            return this.generateMarkdownLink(targetFile, description, sourceFile);
        } else {
            return this.generateWikilink(targetFile, description);
        }
    }

    /**
     * Generate a wikilink to a file.
     * Format: [[filename|description]] or [[filename]] if no description
     */
    private generateWikilink(targetFile: TFile, description?: string): string {
        if (description && description !== targetFile.basename) {
            return `[[${targetFile.basename}|${description}]]`;
        }
        return `[[${targetFile.basename}]]`;
    }

    /**
     * Generate a markdown-style link to a file.
     * Format: [description](filename.md) or [filename](filename.md)
     * 
     * @param targetFile - The file to link to
     * @param description - The link description
     * @param sourceFile - The source file (for calculating relative paths)
     */
    private generateMarkdownLink(targetFile: TFile, description?: string, sourceFile?: TFile): string {
        const linkText = description || targetFile.basename;
        
        // Calculate relative path if source file is provided
        let linkPath: string;
        if (sourceFile && sourceFile.parent && targetFile.parent) {
            linkPath = this.getRelativePath(sourceFile, targetFile);
        } else {
            // Use just the filename with extension
            linkPath = targetFile.name;
        }
        
        // URL encode spaces and special characters in the path
        const encodedPath = linkPath.split('/').map(part => encodeURIComponent(part)).join('/');
        
        return `[${linkText}](${encodedPath})`;
    }

    /**
     * Calculate the relative path from source file to target file.
     */
    private getRelativePath(sourceFile: TFile, targetFile: TFile): string {
        const sourceParts = sourceFile.parent?.path.split('/').filter(p => p) || [];
        const targetParts = targetFile.parent?.path.split('/').filter(p => p) || [];
        
        // Find common prefix length
        let commonLength = 0;
        while (commonLength < sourceParts.length && 
               commonLength < targetParts.length && 
               sourceParts[commonLength] === targetParts[commonLength]) {
            commonLength++;
        }
        
        // Build relative path
        const upCount = sourceParts.length - commonLength;
        const downParts = targetParts.slice(commonLength);
        
        let relativePath = '';
        if (upCount === 0 && downParts.length === 0) {
            // Same folder
            relativePath = targetFile.name;
        } else {
            // Go up directories
            for (let i = 0; i < upCount; i++) {
                relativePath += '../';
            }
            // Go down directories
            if (downParts.length > 0) {
                relativePath += downParts.join('/') + '/';
            }
            relativePath += targetFile.name;
        }
        
        return relativePath;
    }

    /**
     * Extract link targets from content, supporting both wikilinks and markdown links.
     */
    private extractLinks(content: string): Set<string> {
        const links = new Set<string>();
        
        // Match wikilinks: [[link]] or [[link|alias]]
        const wikilinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        let match;
        while ((match = wikilinkRegex.exec(content)) !== null) {
            const linkTarget = match[1].trim();
            const basename = linkTarget.split('/').pop()?.replace(/\.md$/, '') || linkTarget;
            links.add(basename);
        }
        
        // Match markdown links: [text](path.md) or [text](path)
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        while ((match = markdownLinkRegex.exec(content)) !== null) {
            const linkPath = match[2].trim();
            // Decode URL encoding and extract basename
            const decodedPath = decodeURIComponent(linkPath);
            const basename = decodedPath.split('/').pop()?.replace(/\.md$/, '') || decodedPath;
            links.add(basename);
        }
        
        return links;
    }

    /**
     * Check if content already contains a link to the target file.
     * Supports both wikilinks and markdown links.
     */
    private contentContainsLinkTo(content: string, targetBasename: string): boolean {
        // Check for wikilink
        const wikilinkPattern = new RegExp(`\\[\\[${this.escapeRegex(targetBasename)}(\\|[^\\]]+)?\\]\\]`);
        if (wikilinkPattern.test(content)) {
            return true;
        }
        
        // Check for markdown link (with or without .md extension)
        const markdownPattern1 = new RegExp(`\\[[^\\]]+\\]\\([^)]*${this.escapeRegex(targetBasename)}\\.md\\)`);
        const markdownPattern2 = new RegExp(`\\[[^\\]]+\\]\\([^)]*${this.escapeRegex(encodeURIComponent(targetBasename))}\\.md\\)`);
        
        return markdownPattern1.test(content) || markdownPattern2.test(content);
    }

    /**
     * Escape special regex characters in a string.
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ========================================================================
    // Address Parsing and Validation
    // ========================================================================

    /**
     * Extract folgezettel address from a note title.
     */
    extractFromTitle(title: string): string | null {
        if (!this.folgezettelRegexCompiled) {
            this.compileRegex();
        }
        const match = title.match(this.folgezettelRegexCompiled!);
        return match ? match[1] : null;
    }

    /**
     * Parse a folgezettel address into segments.
     */
    parseAddress(address: string): ParsedAddress | null {
        const segments: (number | string)[] = [];
        let remaining = address;

        while (remaining.length > 0) {
            // Try to match a number (possibly with dot prefix)
            const numMatch = remaining.match(/^\.?(\d+)/);
            if (numMatch) {
                segments.push(parseInt(numMatch[1], 10));
                remaining = remaining.slice(numMatch[0].length);
                continue;
            }

            // Try to match letters
            const letterMatch = remaining.match(/^([a-z]+)/);
            if (letterMatch) {
                segments.push(letterMatch[1]);
                remaining = remaining.slice(letterMatch[0].length);
                continue;
            }

            // If we cannot match anything, the address is invalid
            return null;
        }

        if (segments.length === 0) {
            return null;
        }

        return { segments, raw: address };
    }

    /**
     * Get the parent address from a folgezettel address.
     * Root integer notes (e.g., "20") are children of the "00.0" index of indices.
     * The "00.0" index itself has no parent.
     */
    getParentAddress(address: string): string | null {
        // The 00.0 index of indices has no parent
        if (address === '00.0') {
            return null;
        }

        const parsed = this.parseAddress(address);
        if (!parsed) return null;

        if (parsed.segments.length <= 1) {
            // Root integer notes (e.g., "1", "20") are children of 00.0
            if (parsed.segments.length === 1 && typeof parsed.segments[0] === 'number') {
                return '00.0';
            }
            return null;
        }

        // Remove the last segment to get parent
        const parentSegments = parsed.segments.slice(0, -1);
        return this.segmentsToAddress(parentSegments);
    }

    /**
     * Convert segments back to an address string.
     */
    private segmentsToAddress(segments: (number | string)[]): string {
        let result = '';
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (typeof seg === 'number') {
                // Add dot before numbers (except first)
                if (i > 0 && typeof segments[i - 1] === 'number') {
                    result += '.';
                }
                result += seg.toString();
            } else {
                result += seg;
            }
        }
        return result;
    }

    /**
     * Validate a folgezettel address format.
     */
    validateAddressFormat(address: string): ValidationResult {
        if (!address || address.trim() === '') {
            return { valid: false, error: 'Address cannot be empty' };
        }

        // Check for invalid characters
        if (INVALID_FILENAME_CHARS.test(address)) {
            return {
                valid: false,
                error: `Address contains invalid characters. Avoid: ${INVALID_CHARS_DISPLAY}`
            };
        }

        // Check for consecutive periods
        if (/\.\./.test(address)) {
            return { valid: false, error: 'Address cannot contain consecutive periods' };
        }

        // Check for leading/trailing periods
        if (address.startsWith('.') || address.endsWith('.')) {
            return { valid: false, error: 'Address cannot start or end with a period' };
        }

        // Try to parse the address
        const parsed = this.parseAddress(address);
        if (!parsed) {
            return { valid: false, error: 'Address format is invalid' };
        }

        // Validate alternation rules
        for (let i = 1; i < parsed.segments.length; i++) {
            const prev = parsed.segments[i - 1];
            const curr = parsed.segments[i];

            // Skip alternation check for dot-notation (number.number)
            if (typeof prev === 'number' && typeof curr === 'number') {
                // This is allowed for dot notation like "1.2"
                continue;
            }

            // Letters must follow numbers (except at start)
            if (typeof prev === 'string' && typeof curr === 'string') {
                return {
                    valid: false,
                    error: 'Letters cannot directly follow letters (must alternate with numbers)'
                };
            }
        }

        return { valid: true, error: null };
    }

    /**
     * Validate an address and check for duplicates in the vault.
     */
    validateAddress(address: string): AddressValidationResult {
        const formatResult = this.validateAddressFormat(address);

        if (!formatResult.valid) {
            return {
                isValid: false,
                isDuplicate: false,
                existingFile: null,
                message: formatResult.error || 'Invalid address format'
            };
        }

        // Check for duplicates
        const existingFile = this.findFileByAddress(address);
        if (existingFile) {
            return {
                isValid: true,
                isDuplicate: true,
                existingFile,
                message: `Address already exists: ${existingFile.path}`
            };
        }

        return {
            isValid: true,
            isDuplicate: false,
            existingFile: null,
            message: 'Valid address'
        };
    }

    /**
     * Find a file in the vault by its folgezettel address.
     */
    findFileByAddress(address: string): TFile | null {
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            const fileAddress = this.extractFromTitle(file.basename);
            if (fileAddress === address) {
                return file;
            }
        }
        return null;
    }

    /**
     * Find the parent file for a given address.
     */
    findParentFile(address: string): TFile | null {
        const parentAddress = this.getParentAddress(address);
        if (!parentAddress) return null;
        return this.findFileByAddress(parentAddress);
    }

    /**
     * Check for duplicate addresses and show warning if found.
     */
    checkForDuplicateAddress(file: TFile): void {
        const address = this.extractFromTitle(file.basename);
        if (!address) return;

        const files = this.app.vault.getMarkdownFiles();
        for (const otherFile of files) {
            if (otherFile.path === file.path) continue;

            const otherAddress = this.extractFromTitle(otherFile.basename);
            if (otherAddress === address) {
                new DuplicateAddressWarningModal(
                    this.app,
                    address,
                    file,
                    otherFile
                ).open();
                return;
            }
        }
    }

    // ========================================================================
    // Child Address Generation
    // ========================================================================

    /**
     * Suggest the next root-note integer for 00.0 based on the links that
     * already appear under a specific heading in the 00.0 file.
     *
     * Reads the 00.0 file content, locates the section for `heading`,
     * extracts every wikilink/markdown-link whose address is a plain
     * integer, and returns max + 1.  Falls back to the vault-wide
     * suggestNextChild when the file cannot be read or the heading is
     * not found.
     */
    async suggestNextChildForHeading(heading: string): Promise<string> {
        const indexFile = this.findFileByAddress('00.0');
        if (!indexFile) {
            return this.suggestNextChild('00.0');
        }

        try {
            const content = await this.app.vault.read(indexFile);
            const lines = content.split('\n');

            // Find the heading line
            const headingRegex = new RegExp(
                `^##?#?\\s*${this.escapeRegex(heading.replace(/^#+\s*/, ''))}\\s*$`,
                'i'
            );
            let headingIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (headingRegex.test(lines[i])) {
                    headingIndex = i;
                    break;
                }
            }

            if (headingIndex === -1) {
                return this.suggestNextChild('00.0');
            }

            // Collect root-integer addresses from links in this section
            const rootIntegers: number[] = [];
            // Pattern matches [[NNN ...]] or [text](NNN ...) where NNN is integer
            const wikilinkPattern = /\[\[(\d+)\s*[^\]]*\]\]/g;
            const mdlinkPattern = /\[.*?\]\((\d+)[^)]*\)/g;

            for (let i = headingIndex + 1; i < lines.length; i++) {
                // Stop at next heading
                if (/^#+\s/.test(lines[i])) break;

                let match: RegExpExecArray | null;
                wikilinkPattern.lastIndex = 0;
                while ((match = wikilinkPattern.exec(lines[i])) !== null) {
                    const n = parseInt(match[1], 10);
                    if (!isNaN(n)) rootIntegers.push(n);
                }
                mdlinkPattern.lastIndex = 0;
                while ((match = mdlinkPattern.exec(lines[i])) !== null) {
                    const n = parseInt(match[1], 10);
                    if (!isNaN(n)) rootIntegers.push(n);
                }
            }

            if (rootIntegers.length === 0) {
                // No links under that heading yet – fall back to vault-wide
                return this.suggestNextChild('00.0');
            }

            const maxNum = Math.max(...rootIntegers);
            return (maxNum + 1).toString();
        } catch {
            return this.suggestNextChild('00.0');
        }
    }

    /**
     * Suggest the next child address for a given parent address.
     * For "00.0" (index of indices), children are root integers (e.g., 1, 2, 20).
     * For root integers (e.g., "20"), children use dot notation (e.g., 20.1).
     */
    suggestNextChild(parentAddress: string): string {
        // Special case: 00.0 index's children are root integers
        if (parentAddress === '00.0') {
            const existingChildren = this.findChildrenOf('00.0');
            const rootIntegers = existingChildren
                .map(addr => parseInt(addr, 10))
                .filter(n => !isNaN(n));
            const maxNum = rootIntegers.length > 0 ? Math.max(...rootIntegers) : 0;
            return (maxNum + 1).toString();
        }

        // Special case: root integer parents only use dot notation children
        if (/^[0-9]+$/.test(parentAddress)) {
            const dotChild = this.suggestDotNotationChild(parentAddress);
            return dotChild || `${parentAddress}.1`;
        }

        const parsed = this.parseAddress(parentAddress);
        if (!parsed) return parentAddress + 'a';

        const lastSegment = parsed.segments[parsed.segments.length - 1];

        // If parent ends with a number, next child is a letter
        if (typeof lastSegment === 'number') {
            // Find existing children to get next available letter
            const existingChildren = this.findChildrenOf(parentAddress);
            const letterChildren = existingChildren
                .map(addr => {
                    const suffix = addr.substring(parentAddress.length);
                    const match = suffix.match(/^([a-z]+)/);
                    return match ? match[1] : null;
                })
                .filter((l): l is string => l !== null);

            return parentAddress + this.nextLetterSequence(letterChildren);
        }

        // If parent ends with a letter, next child is a number
        const existingChildren = this.findChildrenOf(parentAddress);
        const numberChildren = existingChildren
            .map(addr => {
                const suffix = addr.substring(parentAddress.length);
                const match = suffix.match(/^(\d+)/);
                return match ? parseInt(match[1], 10) : null;
            })
            .filter((n): n is number => n !== null);

        const maxNum = numberChildren.length > 0 ? Math.max(...numberChildren) : 0;
        return parentAddress + (maxNum + 1).toString();
    }

    /**
     * Compute the *first* child address for a parent address, independent of
     * any children that may already exist. This is the address a brand-new
     * child list should begin with.
     *
     * The kind of the first child is fixed by the parent's last segment so the
     * number/letter alternation rule is preserved:
     * - "00.0" (index of indices) -> root integer "1"
     * - root integer "N" -> dot-number "N.1" (a bare "Na" would be ambiguous
     *   against multi-digit root numbering)
     * - parent ending in a number (e.g. "1.2") -> letter child "1.2a"
     * - parent ending in a letter (e.g. "1.2a") -> number child "1.2a1"
     *
     * Returns null when the address cannot be parsed. Note this differs from
     * suggestNextChild, which returns the next *available* child given the
     * children already in the vault; firstChildAddress always points at the
     * very first slot.
     */
    firstChildAddress(parentAddress: string): string | null {
        // Special case: 00.0 index's first child is the first root integer.
        if (parentAddress === '00.0') {
            return '1';
        }

        // Special case: root integer parents start their children at dot-1.
        if (/^[0-9]+$/.test(parentAddress)) {
            return `${parentAddress}.1`;
        }

        const parsed = this.parseAddress(parentAddress);
        if (!parsed || parsed.segments.length === 0) return null;

        const lastSegment = parsed.segments[parsed.segments.length - 1];

        // Parent ends with a number -> first child is the letter "a".
        if (typeof lastSegment === 'number') {
            return `${parentAddress}a`;
        }

        // Parent ends with a letter -> first child is the number "1".
        return `${parentAddress}1`;
    }

    /**
     * Suggest a dot-notation child (for root numbers only).
     */
    suggestDotNotationChild(parentAddress: string): string | null {
        if (!/^[0-9]+$/.test(parentAddress)) {
            return null;
        }

        const existingChildren = this.findChildrenOf(parentAddress);
        const dotChildren = existingChildren
            .map(addr => {
                const match = addr.match(new RegExp(`^${parentAddress}\\.(\\d+)`));
                return match ? parseInt(match[1], 10) : null;
            })
            .filter((n): n is number => n !== null);

        const maxNum = dotChildren.length > 0 ? Math.max(...dotChildren) : 0;
        return `${parentAddress}.${maxNum + 1}`;
    }

    /**
     * Find all children of a given address.
     * For "00.0" (index of indices), children are root integer notes.
     */
    findChildrenOf(parentAddress: string): string[] {
        const children: string[] = [];
        const files = this.app.vault.getMarkdownFiles();

        // Special case: 00.0 index's children are root integer notes
        if (parentAddress === '00.0') {
            for (const file of files) {
                const address = this.extractFromTitle(file.basename);
                if (address && /^[0-9]+$/.test(address)) {
                    children.push(address);
                }
            }
            return children;
        }

        for (const file of files) {
            const address = this.extractFromTitle(file.basename);
            if (address && address.startsWith(parentAddress) && address !== parentAddress) {
                children.push(address);
            }
        }

        return children;
    }

    /**
     * Get the next letter sequence (a, b, c, ... z, aa, ab, ...).
     */
    private nextLetterSequence(existing: string[]): string {
        if (existing.length === 0) return 'a';

        const sorted = existing.sort((a, b) => {
            if (a.length !== b.length) return a.length - b.length;
            return a.localeCompare(b);
        });

        const last = sorted[sorted.length - 1];
        return this.incrementLetters(last);
    }

    /**
     * Increment a letter sequence (a -> b, z -> aa, az -> ba).
     */
    private incrementLetters(letters: string): string {
        const chars = letters.split('');
        let i = chars.length - 1;

        while (i >= 0) {
            if (chars[i] === 'z') {
                chars[i] = 'a';
                i--;
            } else {
                chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
                return chars.join('');
            }
        }

        return 'a' + chars.join('');
    }

    // ========================================================================
    // Sibling Inference (cursor-aware next-sibling addressing)
    // ========================================================================

    /**
     * Compute the next sibling of a folgezettel address by incrementing its
     * last segment in kind. A letter advances to the next letter (z -> aa);
     * a number advances to the next number. Because only the last segment
     * changes and its kind is preserved, the alternation rule (numbers follow
     * letters and letters follow numbers) is never violated. Root integers
     * such as "7" advance to "8"; dot-numbers such as "7.1" advance to "7.2".
     * Returns null when the address cannot be parsed.
     */
    nextSiblingAddress(address: string): string | null {
        const parsed = this.parseAddress(address);
        if (!parsed || parsed.segments.length === 0) return null;

        const segments = parsed.segments.slice();
        const lastIndex = segments.length - 1;
        const last = segments[lastIndex];

        if (typeof last === 'number') {
            segments[lastIndex] = last + 1;
        } else {
            segments[lastIndex] = this.incrementLetters(last);
        }

        return this.segmentsToAddress(segments);
    }

    /**
     * Compare two sibling addresses by their last segment. Numbers compare
     * numerically; letter runs compare by length first then lexicographically
     * so that "z" < "aa". Returns negative when a < b, positive when a > b,
     * and 0 when equal or incomparable. Intended for addresses that share a
     * parent; mixed kinds (a defensive case) sort numbers before letters.
     */
    private compareSiblingAddresses(a: string, b: string): number {
        const pa = this.parseAddress(a);
        const pb = this.parseAddress(b);
        if (!pa || !pb) return 0;

        const la = pa.segments[pa.segments.length - 1];
        const lb = pb.segments[pb.segments.length - 1];
        const aNum = typeof la === 'number';
        const bNum = typeof lb === 'number';

        if (aNum && bNum) return (la as number) - (lb as number);
        if (!aNum && !bNum) {
            const sa = la as string;
            const sb = lb as string;
            if (sa.length !== sb.length) return sa.length - sb.length;
            return sa.localeCompare(sb);
        }
        return aNum ? -1 : 1;
    }

    /**
     * Return the maximal address among a set of siblings, or null when the
     * set is empty. "Maximal" uses compareSiblingAddresses, so it reflects the
     * highest index rather than document order. Editing a child-link list can
     * leave it out of numeric order, so callers should rely on the max rather
     * than the last line.
     */
    maxSiblingAddress(addresses: string[]): string | null {
        if (addresses.length === 0) return null;
        return addresses.reduce((best, candidate) =>
            this.compareSiblingAddresses(candidate, best) > 0 ? candidate : best
        );
    }

    /**
     * Extract the folgezettel address from a single list line such as
     * "- [[1.2a3 Some Title]]" or "- [Some Title](1.2a3 Some Title.md)".
     * Returns null when the line carries no recognizable address.
     */
    extractAddressFromLinkLine(line: string): string | null {
        return this.extractFromTitle(line);
    }

    /**
     * Inspect the cursor's surroundings in a note's body and, when the cursor
     * sits inside a list of links to child notes, return the addresses found
     * in that contiguous list block together with the heading the block sits
     * under. Operates on plain lines and a cursor line index so it can be unit
     * tested without a live editor. Returns null when the cursor is not inside
     * a list that contains at least one folgezettel-addressed item.
     */
    findSiblingListContext(
        lines: string[],
        cursorLine: number
    ): { items: string[]; headingText: string | null } | null {
        if (cursorLine < 0 || cursorLine >= lines.length) return null;
        if (!this.isListItem(lines[cursorLine])) return null;

        // Expand to the contiguous block of list items around the cursor.
        let start = cursorLine;
        while (start > 0 && this.isListItem(lines[start - 1])) start--;
        let end = cursorLine;
        while (end < lines.length - 1 && this.isListItem(lines[end + 1])) end++;

        const items: string[] = [];
        for (let i = start; i <= end; i++) {
            const address = this.extractAddressFromLinkLine(lines[i]);
            if (address) items.push(address);
        }
        if (items.length === 0) return null;

        // Find the nearest heading above the block, if any.
        let headingText: string | null = null;
        for (let i = start - 1; i >= 0; i--) {
            const m = lines[i].match(/^#+\s+(.*)$/);
            if (m) {
                headingText = m[1].trim();
                break;
            }
        }

        return { items, headingText };
    }

    /**
     * Scan a parent note's content for the list item that links to a given
     * child (matched by its folgezettel address) and return the heading that
     * item sits under. Used to infer the 00.0 index heading for a new sibling
     * when the cursor was not inside a child-link list. Returns null when the
     * child link is not found under any heading.
     */
    findHeadingOfChildLink(content: string, childAddress: string): string | null {
        const lines = content.split('\n');
        let currentHeading: string | null = null;
        for (const line of lines) {
            const headingMatch = line.match(/^#+\s+(.*)$/);
            if (headingMatch) {
                currentHeading = headingMatch[1].trim();
                continue;
            }
            if (this.isListItem(line)) {
                const address = this.extractAddressFromLinkLine(line);
                if (address === childAddress) {
                    return currentHeading;
                }
            }
        }
        return null;
    }

    // ========================================================================
    // Template Processing
    // ========================================================================

    /**
     * Process template variables in content.
     */
    processTemplateVariables(content: string, file: TFile): string {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0];

        // Extract parent address from the file's folgezettel
        const childAddress = this.extractFromTitle(file.basename);
        const parentAddress = childAddress ? this.getParentAddress(childAddress) : '';

        return content
            .replace(/\{\{title\}\}/g, file.basename)
            .replace(/\{\{date\}\}/g, dateStr)
            .replace(/\{\{time\}\}/g, timeStr)
            .replace(/\{\{datetime\}\}/g, `${dateStr} ${timeStr}`)
            .replace(/\{\{folder\}\}/g, file.parent?.path || '')
            .replace(/\{\{parent\}\}/g, parentAddress || '');
    }

    /**
     * Get the default template file.
     */
    async getDefaultTemplate(): Promise<TFile | null> {
        const templatePath = this.settings.defaultTemplate;
        if (!templatePath) return null;

        const file = this.app.vault.getAbstractFileByPath(templatePath);
        if (file && file instanceof TFile) {
            return file;
        }
        return null;
    }

    /**
     * Apply a template to a file.
     */
    async applyTemplate(file: TFile, template: TFile | null): Promise<void> {
        if (!template) return;

        try {
            const templateContent = await this.app.vault.read(template);
            const processedContent = this.processTemplateVariables(templateContent, file);
            await this.app.vault.modify(file, processedContent);
        } catch (error) {
            console.error('Failed to apply template:', error);
            if (this.settings.showNotifications) {
                new Notice(`Failed to apply template: ${error}`);
            }
        }
    }

    /**
     * Apply the configured template to a newly created note.
     * Supports both core Templates plugin and Templater plugin.
     * Falls back to defaultTemplate if childNoteTemplateSource is 'none'.
     */
    async applyChildNoteTemplate(file: TFile): Promise<boolean> {
        const source = this.settings.childNoteTemplateSource;

        if (source === 'core') {
            return await this.applyCoreTemplate(file);
        } else if (source === 'templater') {
            return await this.applyTemplaterTemplate(file);
        } else {
            // source === 'none' - try to apply default template
            return await this.applyDefaultTemplate(file);
        }
    }

    /**
     * Apply the default template to a file.
     */
    private async applyDefaultTemplate(file: TFile): Promise<boolean> {
        const templatePath = this.settings.defaultTemplate;
        
        if (!templatePath) {
            return false;
        }

        const templateFile = this.app.vault.getAbstractFileByPath(templatePath);

        if (!templateFile || !(templateFile instanceof TFile)) {
            if (this.settings.showNotifications) {
                new Notice(`Default template file not found: ${templatePath}`);
            }
            return false;
        }

        try {
            const templateContent = await this.app.vault.read(templateFile);
            const processedContent = this.processTemplateVariables(templateContent, file);
            await this.app.vault.modify(file, processedContent);

            if (this.settings.showNotifications) {
                new Notice(`Applied default template to ${file.basename}`);
            }
            return true;
        } catch (error) {
            console.error('Failed to apply default template:', error);
            if (this.settings.showNotifications) {
                new Notice(`Failed to apply default template: ${error}`);
            }
            return false;
        }
    }

    /**
     * Apply template using the core Templates plugin approach.
     */
    private async applyCoreTemplate(file: TFile): Promise<boolean> {
        const templatePath = this.settings.childNoteTemplatePath;

        if (!templatePath) {
            if (this.settings.showNotifications) {
                new Notice('No core template path configured for child notes');
            }
            return false;
        }

        const templateFile = this.app.vault.getAbstractFileByPath(templatePath);

        if (!templateFile || !(templateFile instanceof TFile)) {
            if (this.settings.showNotifications) {
                new Notice(`Template file not found: ${templatePath}`);
            }
            return false;
        }

        try {
            const templateContent = await this.app.vault.read(templateFile);
            const processedContent = this.processTemplateVariables(templateContent, file);
            await this.app.vault.modify(file, processedContent);

            if (this.settings.showNotifications) {
                new Notice(`Applied template to ${file.basename}`);
            }
            return true;
        } catch (error) {
            console.error('Failed to apply core template:', error);
            if (this.settings.showNotifications) {
                new Notice(`Failed to apply template: ${error}`);
            }
            return false;
        }
    }

    /**
     * Apply template using the Templater plugin.
     */
    private async applyTemplaterTemplate(file: TFile): Promise<boolean> {
        const templatePath = this.settings.childNoteTemplaterPath;

        if (!templatePath) {
            if (this.settings.showNotifications) {
                new Notice('No Templater template path configured for child notes');
            }
            return false;
        }

        // Access Templater plugin via Obsidian's plugin API
        const templaterPlugin = (this.app as any).plugins?.plugins?.['templater-obsidian'];

        if (!templaterPlugin) {
            if (this.settings.showNotifications) {
                new Notice('Templater plugin is not installed or enabled');
            }
            return false;
        }

        const templateFile = this.app.vault.getAbstractFileByPath(templatePath);

        if (!templateFile || !(templateFile instanceof TFile)) {
            if (this.settings.showNotifications) {
                new Notice(`Templater template file not found: ${templatePath}`);
            }
            return false;
        }

        try {
            // Use Templater's API to apply the template
            const templater = templaterPlugin.templater;

            if (templater && typeof templater.write_template_to_file === 'function') {
                await templater.write_template_to_file(templateFile, file);

                if (this.settings.showNotifications) {
                    new Notice(`Applied Templater template to ${file.basename}`);
                }
                return true;
            } else if (templater && typeof templater.overwrite_file_commands === 'function') {
                // Alternative Templater API method
                await templater.overwrite_file_commands(file, templateFile);

                if (this.settings.showNotifications) {
                    new Notice(`Applied Templater template to ${file.basename}`);
                }
                return true;
            } else {
                // Fallback: Open file and use append_template_to_active_file
                const leaf = this.app.workspace.getLeaf();
                await leaf.openFile(file);

                if (templater && typeof templater.append_template_to_active_file === 'function') {
                    await templater.append_template_to_active_file(templateFile);

                    if (this.settings.showNotifications) {
                        new Notice(`Applied Templater template to ${file.basename}`);
                    }
                    return true;
                } else {
                    throw new Error('Templater API methods not available');
                }
            }
        } catch (error) {
            console.error('Failed to apply Templater template:', error);
            if (this.settings.showNotifications) {
                new Notice(`Failed to apply Templater template: ${error}`);
            }
            return false;
        }
    }

    // ========================================================================
    // Commands and Actions
    // ========================================================================

    /**
     * Check whether a given address is a root integer (i.e. its parent is 00.0).
     */
    isRootIntegerAddress(address: string): boolean {
        return /^[0-9]+$/.test(address);
    }

    /**
     * Prompt the user to choose an index heading for a root note in the 00.0 file.
     * Returns a Promise that resolves to the chosen heading, or null if cancelled.
     */
    promptForIndexHeading(): Promise<string | null> {
        return new Promise(resolve => {
            new IndexHeadingModal(
                this.app,
                (heading: string) => resolve(heading),
                () => resolve(null)
            ).open();
        });
    }

    /**
     * Command: Add backlink to parent note.
     */
    async addBacklinkToParent() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || !activeView.file) {
            new Notice('No active note');
            return;
        }

        const file = activeView.file;
        const address = this.extractFromTitle(file.basename);

        if (!address) {
            new Notice('No folgezettel address found in note title');
            return;
        }

        const parentFile = this.findParentFile(address);
        if (!parentFile) {
            new Notice('Parent note not found');
            return;
        }

        // If this is a root integer note, prompt for which 00.0 heading to use
        let headingOverride: string | undefined;
        if (this.isRootIntegerAddress(address)) {
            const chosen = await this.promptForIndexHeading();
            if (!chosen) {
                new Notice('Backlink cancelled');
                return;
            }
            headingOverride = chosen;
        }

        await this.insertBacklink(file, parentFile);
        await this.insertForwardLink(parentFile, file, headingOverride);
    }

    /**
     * Command: Suggest next child address.
     */
    suggestNextChildCommand() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || !activeView.file) {
            new Notice('No active note');
            return;
        }

        const address = this.extractFromTitle(activeView.file.basename);
        if (!address) {
            new Notice('No folgezettel address found in note title');
            return;
        }

        const nextChild = this.suggestNextChild(address);
        const validation = this.validateAddress(nextChild);

        if (validation.isDuplicate) {
            new Notice(`Next child: ${nextChild} (WARNING: already exists)`);
        } else {
            new Notice(`Next child address: ${nextChild}`);
        }
    }

    /**
     * Command: Create the next sibling note, inferred from the cursor.
     *
     * When the cursor sits inside a list of links to child notes, the new note
     * becomes the next sibling of the highest-indexed child in that list (a new
     * child of the current note) and its forward link appends to the bottom of
     * that same list, under the same heading. This removes the old Subject
     * Matter / Project Support prompt because the cursor's heading already
     * encodes the scheme.
     *
     * When the cursor is not inside such a list, the new note becomes the next
     * top-level sibling of the current note itself. Either way the new note's
     * title and filename are seeded with the inferred index, so there is
     * nothing to backspace over and no address dialog is shown.
     */
    /**
     * Start a new list of child notes under the active note and create its
     * first child.
     *
     * Where "Create next child note" appends the next sibling to an existing
     * list, this command bootstraps the list itself: it computes the first
     * child address for the active note (see firstChildAddress), writes the
     * forward link under the forward-link heading (creating the heading when it
     * is absent), writes the matching backlink into the new child, and opens
     * the child with its index already in the title.
     *
     * The active note must carry a folgezettel address and must not already
     * have children; when children exist the first slot is taken, so the
     * command defers to "Create next child note" instead of clobbering them.
     */
    async createFirstChild() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || !activeView.file) {
            new Notice('No active note');
            return;
        }

        const currentAddress = this.extractFromTitle(activeView.file.basename);
        if (!currentAddress) {
            new Notice('No folgezettel address found in note title');
            return;
        }

        // Refuse to start a new list when one already exists; the first child
        // would collide with an existing note. Point the user at the append
        // command instead.
        if (this.findChildrenOf(currentAddress).length > 0) {
            new Notice('This note already has child notes; use "Create next child note" to extend the list');
            return;
        }

        const address = this.firstChildAddress(currentAddress);
        if (!address) {
            new Notice('Could not determine the first child address');
            return;
        }

        // The 00.0 index files its root-integer children under a named index
        // heading rather than the generic forward-link heading.
        const headingOverride =
            currentAddress === '00.0' ? INDEX_HEADINGS[0] : undefined;

        await this.createSiblingFromPlan({
            address,
            parentFile: activeView.file,
            headingOverride
        });
    }

    async createNextChild() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || !activeView.file) {
            new Notice('No active note');
            return;
        }

        const plan = await this.resolveSiblingPlan(activeView.file, activeView.editor);
        if (!plan) {
            new Notice('No folgezettel address found in note title');
            return;
        }

        await this.createSiblingFromPlan(plan);
    }

    /**
     * Resolve the next folgezettel address to create from the cursor position,
     * together with the parent file the new note should link to and the heading
     * its forward link belongs under.
     *
     * - Cursor inside a list of child links: the new note is the next sibling
     *   of the highest-indexed child in that list (a new child of the current
     *   note), appended under that list's heading.
     * - Otherwise: the new note is the next top-level sibling of the current
     *   note itself, linked under the current note's parent.
     *
     * parentFile is null when no parent exists in the vault, in which case the
     * note is created without bidirectional links. Returns null when no address
     * can be inferred (the active note has no folgezettel address).
     */
    private async resolveSiblingPlan(
        activeFile: TFile,
        editor: Editor
    ): Promise<{ address: string; parentFile: TFile | null; headingOverride?: string } | null> {
        const currentAddress = this.extractFromTitle(activeFile.basename);
        if (!currentAddress) return null;

        // Case A: cursor inside a list of child links -> next child of this note.
        const cursor = editor.getCursor();
        const lines = editor.getValue().split('\n');
        const ctx = this.findSiblingListContext(lines, cursor.line);
        if (ctx) {
            const children = ctx.items.filter(
                addr => this.getParentAddress(addr) === currentAddress
            );
            const maxChild = this.maxSiblingAddress(children);
            if (maxChild) {
                const address = this.nextSiblingAddress(maxChild);
                if (address) {
                    return {
                        address,
                        parentFile: activeFile,
                        headingOverride: ctx.headingText ?? undefined
                    };
                }
            }
        }

        // Case B (fallback): next top-level sibling of the current note itself.

        // The 00.0 index of indices has no sibling of its own; its "next
        // sibling" is the next root-integer child instead.
        if (currentAddress === '00.0') {
            const rootAddress = this.suggestNextChild('00.0');
            const heading = INDEX_HEADINGS[0];
            new Notice(`Listing ${rootAddress} under "${heading}"`);
            return { address: rootAddress, parentFile: activeFile, headingOverride: heading };
        }

        const address = this.nextSiblingAddress(currentAddress);
        if (!address) return null;

        const parentAddress = this.getParentAddress(currentAddress);
        const parentFile = parentAddress ? this.findFileByAddress(parentAddress) : null;

        let headingOverride: string | undefined;
        if (parentFile && parentAddress === '00.0') {
            // New root-integer sibling: file it under the same 00.0 heading the
            // current note already lives under, defaulting to the first heading.
            const content = await this.app.vault.read(parentFile);
            const inferred = this.findHeadingOfChildLink(content, currentAddress);
            if (inferred) {
                headingOverride = inferred;
            } else {
                headingOverride = INDEX_HEADINGS[0];
                new Notice(`Could not infer index heading; using "${headingOverride}"`);
            }
        }

        return { address, parentFile, headingOverride };
    }

    /**
     * Execute a sibling-creation plan: validate the address, guard against
     * duplicates, then create the note. When a parent file is known the note is
     * created with bidirectional links; otherwise it is created on its own. The
     * note title and filename are both seeded with the inferred index.
     */
    private async createSiblingFromPlan(
        plan: { address: string; parentFile: TFile | null; headingOverride?: string }
    ): Promise<void> {
        const { address, parentFile, headingOverride } = plan;
        const validation = this.validateAddress(address);
        if (!validation.isValid) {
            new Notice(`Cannot create note: ${validation.message}`);
            return;
        }

        const create = async () => {
            if (parentFile) {
                await this.createChildNoteWithAddress(address, parentFile, headingOverride, address);
            } else {
                const activeFile = this.app.workspace.getActiveFile();
                await this.createNoteWithAddress(address, activeFile?.parent ?? null);
            }
        };

        if (validation.isDuplicate && validation.existingFile) {
            new DuplicateAddressModal(
                this.app,
                address,
                validation.existingFile,
                async () => { await create(); },
                () => { new Notice('Note creation cancelled'); }
            ).open();
        } else {
            await create();
        }
    }

    /**
     * Create a child note with the given folgezettel address.
     * This method handles the full child note creation workflow:
     * 1. Creates the note file
     * 2. Applies template
     * 3. Inserts backlink to parent
     * 4. Inserts forward link in parent (under headingOverride if provided)
     * 5. Opens the file and positions cursor
     *
     * @param address - The folgezettel address for the new note
     * @param parentFile - The parent file
     * @param forwardLinkHeading - Optional heading override for the forward link in the parent
     */
    async createChildNoteWithAddress(address: string, parentFile: TFile, forwardLinkHeading?: string, noteTitle?: string): Promise<void> {
        const fileName = `${noteTitle || address}.md`;
        const parentFolder = parentFile.parent;
        const filePath = parentFolder
            ? `${parentFolder.path}/${fileName}`
            : fileName;

        try {
            // Mark files as being processed to prevent cross-link interference
            this.processingFiles.add(filePath);
            if (parentFile) {
                this.processingFiles.add(parentFile.path);
            }

            // Create the file
            const newFile = await this.app.vault.create(filePath, '');
            
            // Track creation time for grace period
            this.fileCreationTimes.set(newFile.path, Date.now());
            this.recentlyCreatedFiles.add(newFile.path);

            // Apply the child note template if configured
            await this.applyChildNoteTemplate(newFile);

            // Insert bidirectional links
            await this.insertBacklink(newFile, parentFile);
            await this.insertForwardLink(parentFile, newFile, forwardLinkHeading);

            // Open the new file and position cursor at end of title
            const leaf = this.app.workspace.getLeaf();
            await leaf.openFile(newFile);
            
            // Position cursor at end of title for user to continue typing
            this.positionCursorAtEndOfTitle(address);

            if (this.settings.showNotifications) {
                new Notice(`Created child note: ${address}`);
            }
        } catch (error) {
            console.error('Failed to create child note:', error);
            if (this.settings.showNotifications) {
                new Notice(`Failed to create child note: ${error}`);
            }
        } finally {
            // Clear processing flags after a delay
            setTimeout(() => {
                this.processingFiles.delete(filePath);
                if (parentFile) {
                    this.processingFiles.delete(parentFile.path);
                }
            }, 1000);
        }
    }

    /**
     * Create a new note with the given folgezettel address (general method).
     * Applies the configured child note template if set.
     */
    async createNoteWithAddress(address: string, parentFolder: TFolder | null): Promise<void> {
        const fileName = `${address}.md`;
        const filePath = parentFolder
            ? `${parentFolder.path}/${fileName}`
            : fileName;

        try {
            // Mark file as being processed
            this.processingFiles.add(filePath);
            
            const newFile = await this.app.vault.create(filePath, '');
            
            // Track creation time
            this.fileCreationTimes.set(newFile.path, Date.now());
            this.recentlyCreatedFiles.add(newFile.path);

            // Apply the child note template if configured
            await this.applyChildNoteTemplate(newFile);

            // Open the new file
            const leaf = this.app.workspace.getLeaf();
            await leaf.openFile(newFile);
            
            // Position cursor at end of title
            this.positionCursorAtEndOfTitle(address);

            if (this.settings.showNotifications) {
                new Notice(`Created note: ${address}`);
            }
        } catch (error) {
            console.error('Failed to create note:', error);
            if (this.settings.showNotifications) {
                new Notice(`Failed to create note: ${error}`);
            }
        } finally {
            // Clear processing flag after a delay
            setTimeout(() => {
                this.processingFiles.delete(filePath);
            }, 1000);
        }
    }

    /**
     * Position the cursor at the end of the title in the active editor.
     * This allows the user to continue typing after the folgezettel address.
     */
    private positionCursorAtEndOfTitle(address: string): void {
        // Use setTimeout to ensure the editor is ready
        setTimeout(() => {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView || !activeView.editor) return;

            const editor = activeView.editor;
            
            // In Obsidian, the title is the filename, not in the editor content.
            // We need to focus on the title element or put cursor at start of content.
            // For the inline title feature, we can try to focus on it.
            
            // Try to focus the inline title element
            const titleEl = activeView.containerEl.querySelector('.inline-title') as HTMLElement;
            if (titleEl && titleEl.isContentEditable) {
                titleEl.focus();
                
                // Move cursor to end of title
                const selection = window.getSelection();
                if (selection) {
                    const range = document.createRange();
                    range.selectNodeContents(titleEl);
                    range.collapse(false); // Collapse to end
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            } else {
                // Fallback: put cursor at beginning of document
                editor.setCursor({ line: 0, ch: 0 });
                editor.focus();
            }
        }, 100);
    }

    /**
     * Command: Select template and create new note.
     */
    async selectTemplateAndCreateNote() {
        new TemplatePicker(this.app, this, async (template) => {
            await this.createNoteWithTemplate(template);
        }).open();
    }

    /**
     * Create a new note with the selected template.
     */
    async createNoteWithTemplate(template: TFile | null): Promise<void> {
        const name = await this.promptForNoteName();
        if (!name) return;

        const fileName = `${name}.md`;
        const activeFile = this.app.workspace.getActiveFile();
        const folder = activeFile?.parent;
        const filePath = folder ? `${folder.path}/${fileName}` : fileName;

        try {
            // Mark file as being processed
            this.processingFiles.add(filePath);
            
            const newFile = await this.app.vault.create(filePath, '');
            
            // Track creation time
            this.fileCreationTimes.set(newFile.path, Date.now());
            this.recentlyCreatedFiles.add(newFile.path);

            if (template) {
                await this.applyTemplate(newFile, template);
            }

            await this.app.workspace.getLeaf().openFile(newFile);
            
            // Position cursor at end of title
            this.positionCursorAtEndOfTitle(name);

            if (this.settings.showNotifications) {
                new Notice(`Created note: ${name}`);
            }
        } catch (error) {
            console.error('Failed to create note:', error);
            if (this.settings.showNotifications) {
                new Notice(`Failed to create note: ${error}`);
            }
        } finally {
            setTimeout(() => {
                this.processingFiles.delete(filePath);
            }, 1000);
        }
    }

    /**
     * Prompt user for a note name.
     */
    promptForNoteName(): Promise<string | null> {
        return new Promise((resolve) => {
            new TextInputModal(
                this.app,
                'New Note Name',
                'Enter note name...',
                (value) => resolve(value)
            ).open();

            // Handle modal close without submit
            setTimeout(() => {
                // Guard for non-DOM environments (e.g. the test runner).
                if (typeof document === 'undefined') return;
                const modal = document.querySelector('.modal-container');
                if (modal) {
                    const observer = new MutationObserver(() => {
                        if (!document.body.contains(modal)) {
                            observer.disconnect();
                            resolve(null);
                        }
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                }
            }, 100);
        });
    }

    /**
     * Command: Create new folgezettel note.
     *
     * When the active note carries a folgezettel address, the next sibling
     * index is inferred from the cursor position (the same logic the "Create
     * next child note" command uses) and the note is seeded with it, so no
     * typing is required. The free-text name dialog is used only as a last
     * resort, when no address can be inferred (no active note, or the active
     * note has no folgezettel address).
     */
    async promptForFolgezettelalNote(): Promise<void> {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.file) {
            const plan = await this.resolveSiblingPlan(activeView.file, activeView.editor);
            if (plan) {
                await this.createSiblingFromPlan(plan);
                return;
            }
        }

        // Fallback: no address to infer from, so ask for one by hand.
        const name = await this.promptForNoteName();
        if (!name) return;

        const validation = this.validateAddress(name);

        if (!validation.isValid) {
            new Notice(`Invalid folgezettel address: ${validation.message}`);
            return;
        }

        if (validation.isDuplicate && validation.existingFile) {
            new DuplicateAddressModal(
                this.app,
                name,
                validation.existingFile,
                async () => {
                    await this.createFolgezettelNote(name);
                },
                () => {
                    new Notice('Note creation cancelled');
                }
            ).open();
        } else {
            await this.createFolgezettelNote(name);
        }
    }

    /**
     * Create a folgezettel note with default template.
     */
    private async createFolgezettelNote(address: string): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        const folder = activeFile?.parent || null;
        await this.createNoteWithAddress(address, folder);
    }

    // ========================================================================
    // Link Insertion
    // ========================================================================

    /**
     * Insert a backlink to the parent note.
     */
    async insertBacklink(childFile: TFile, parentFile: TFile): Promise<void> {
        // Mark files as being processed
        this.processingFiles.add(childFile.path);
        
        try {
            const link = this.generateLink(parentFile, this.settings.parentLinkDescription, childFile);
            await this.insertLinkUnderHeading(childFile, link, this.settings.backlinkHeading, parentFile.basename);

            if (this.settings.showNotifications) {
                new Notice(`Added backlink to ${parentFile.basename}`);
            }
        } finally {
            setTimeout(() => {
                this.processingFiles.delete(childFile.path);
            }, 500);
        }
    }

    /**
     * Insert a forward link to the child note in the parent.
     * @param parentFile - The parent file to insert the link into
     * @param childFile - The child file being linked to
     * @param headingOverride - Optional heading to use instead of the default forwardLinkHeading
     */
    async insertForwardLink(parentFile: TFile, childFile: TFile, headingOverride?: string): Promise<void> {
        // Mark files as being processed
        this.processingFiles.add(parentFile.path);

        try {
            // Use child link description, or fall back to child's basename
            const description = this.settings.childLinkDescription || childFile.basename;
            const link = this.generateLink(childFile, description, parentFile);

            // Use headingOverride if provided, otherwise fall back to forwardLinkHeading
            const heading = headingOverride || this.settings.forwardLinkHeading;
            await this.insertLinkUnderHeading(parentFile, link, heading, childFile.basename);

            if (this.settings.showNotifications) {
                new Notice(`Added forward link to ${childFile.basename}`);
            }
        } finally {
            setTimeout(() => {
                this.processingFiles.delete(parentFile.path);
            }, 500);
        }
    }

    /**
     * Check if a line is a list item (unordered or ordered).
     * Handles various formats: "- item", "* item", "1. item", etc.
     */
    private isListItem(line: string): boolean {
        const trimmed = line.trim();
        // Unordered list: starts with - or * followed by space
        if (/^[-*]\s/.test(trimmed)) {
            return true;
        }
        // Also match without space after dash/asterisk for robustness
        if (/^[-*]\[/.test(trimmed)) {
            return true;
        }
        // Ordered list: starts with number followed by . or ) and space
        if (/^\d+[.)]\s/.test(trimmed)) {
            return true;
        }
        return false;
    }

    /**
     * Insert a link under a specific heading in a file.
     * Adds to the END of the list (bottom) without extra blank lines.
     * 
     * @param file - The file to modify
     * @param link - The formatted link to insert
     * @param heading - The heading to insert under (null = beginning of file)
     * @param targetBasename - The basename of the target file (for duplicate checking)
     */
    private async insertLinkUnderHeading(
        file: TFile,
        link: string,
        heading: string | null,
        targetBasename: string
    ): Promise<void> {
        const content = await this.app.vault.read(file);
        
        // Check if link already exists (supports both wikilinks and markdown links)
        if (this.contentContainsLinkTo(content, targetBasename)) {
            return; // Link already exists
        }
        
        const lines = content.split('\n');
        const linkLine = `- ${link}`;

        if (heading) {
            // Find the heading
            const headingRegex = new RegExp(`^##?#?\\s*${this.escapeRegex(heading)}\\s*$`, 'i');
            let headingIndex = -1;

            for (let i = 0; i < lines.length; i++) {
                if (headingRegex.test(lines[i])) {
                    headingIndex = i;
                    break;
                }
            }

            if (headingIndex !== -1) {
                // Find the end of the section (next heading or end of file)
                // and track the last list item position
                let sectionEndIndex = lines.length;
                let lastListItemIndex = -1;
                let firstNonBlankAfterHeading = -1;
                
                for (let i = headingIndex + 1; i < lines.length; i++) {
                    const line = lines[i];
                    
                    // Stop at next heading (any level)
                    if (/^#+\s/.test(line)) {
                        sectionEndIndex = i;
                        break;
                    }
                    
                    // Track first non-blank line after heading
                    if (firstNonBlankAfterHeading === -1 && line.trim() !== '') {
                        firstNonBlankAfterHeading = i;
                    }
                    
                    // Track list items - check if this line is a list item
                    if (this.isListItem(line)) {
                        lastListItemIndex = i;
                    }
                }
                
                // Decide where to insert
                if (lastListItemIndex !== -1) {
                    // Found existing list items - insert AFTER the last one
                    lines.splice(lastListItemIndex + 1, 0, linkLine);
                } else {
                    // No list items found in section
                    // Insert after the heading, with a blank line if needed
                    let insertAt = headingIndex + 1;
                    
                    // Skip blank lines immediately after heading
                    while (insertAt < sectionEndIndex && lines[insertAt].trim() === '') {
                        insertAt++;
                    }
                    
                    // If there's content (non-list) after heading, insert before it with blank line
                    if (insertAt < sectionEndIndex && lines[insertAt].trim() !== '') {
                        // There's some content - insert before it
                        lines.splice(insertAt, 0, linkLine, '');
                    } else {
                        // Empty section or only blank lines - insert after heading with blank line
                        if (headingIndex + 1 < lines.length && lines[headingIndex + 1].trim() === '') {
                            // Already a blank line after heading
                            lines.splice(headingIndex + 2, 0, linkLine);
                        } else {
                            // No blank line after heading - add one
                            lines.splice(headingIndex + 1, 0, '', linkLine);
                        }
                    }
                }
            } else {
                // Heading doesn't exist - create it at the end of the file
                // Add blank line before heading if file doesn't end with blank line
                if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
                    lines.push('');
                }
                lines.push(`## ${heading}`, '', linkLine);
            }
        } else {
            // No heading specified - insert at the beginning (after frontmatter)
            let insertIndex = 0;
            if (lines[0] === '---') {
                insertIndex = lines.indexOf('---', 1) + 1;
                if (insertIndex === 0) insertIndex = lines.length;
            }
            lines.splice(insertIndex, 0, linkLine, '');
        }

        await this.app.vault.modify(file, lines.join('\n'));
    }

    // ========================================================================
    // Bidirectional Cross-Linking
    // ========================================================================

    /**
     * Handle file modification to detect new manual link insertions.
     * Skips files that are being processed by the plugin or were recently created.
     */
    private async onFileModify(file: TFile): Promise<void> {
        // Skip if this file is being processed by the plugin
        if (this.processingFiles.has(file.path)) {
            return;
        }
        
        // Skip if this file was recently created (within grace period)
        if (this.isWithinCreationGracePeriod(file.path)) {
            return;
        }

        const content = await this.app.vault.read(file);
        const currentLinks = this.extractLinks(content);
        const previousLinks = this.fileContentCache.get(file.path) || new Set();

        // Find new links
        const newLinks = new Set<string>();
        for (const link of currentLinks) {
            if (!previousLinks.has(link)) {
                newLinks.add(link);
            }
        }

        // Update cache
        this.fileContentCache.set(file.path, currentLinks);

        // Process new links (only for manual user-created links)
        for (const linkTarget of newLinks) {
            const linkedFile = this.app.vault.getMarkdownFiles().find(
                f => f.basename === linkTarget
            );

            if (linkedFile && linkedFile.path !== file.path) {
                // Skip if the linked file is also within grace period
                // (this prevents cross-links when creating child notes)
                if (this.isWithinCreationGracePeriod(linkedFile.path)) {
                    continue;
                }
                
                // Skip if the linked file is being processed
                if (this.processingFiles.has(linkedFile.path)) {
                    continue;
                }
                
                await this.insertCrossLink(linkedFile, file);
            }
        }
    }

    /**
     * Insert a cross-reference link.
     */
    private async insertCrossLink(targetFile: TFile, sourceFile: TFile): Promise<void> {
        this.processingFiles.add(targetFile.path);

        try {
            const link = this.generateLink(sourceFile, 'Cross-reference', targetFile);
            await this.insertLinkUnderHeading(targetFile, link, this.settings.crossLinkHeading, sourceFile.basename);

            if (this.settings.showNotifications) {
                new Notice(`Added cross-link: ${sourceFile.basename} ↔ ${targetFile.basename}`);
            }
        } finally {
            setTimeout(() => {
                this.processingFiles.delete(targetFile.path);
            }, 100);
        }
    }

    // ========================================================================
    // Auto-Processing
    // ========================================================================

    /**
     * Process a newly created file (from Obsidian's normal UI, not plugin commands).
     * This applies the default template and inserts parent/child links.
     */
    async processNewFile(file: TFile): Promise<void> {
        // Skip if this file is already being processed by createChildNoteWithAddress
        if (this.processingFiles.has(file.path)) {
            return;
        }
        
        const address = this.extractFromTitle(file.basename);
        if (!address) return;

        // Mark file as being processed
        this.processingFiles.add(file.path);

        try {
            // Apply template to newly created file (if it's empty or very small)
            const content = await this.app.vault.read(file);
            if (content.trim().length === 0) {
                await this.applyChildNoteTemplate(file);
            }

            // Find and link to parent
            const parentFile = this.findParentFile(address);
            if (parentFile) {
                // For root integer notes, prompt for which 00.0 heading to use
                let headingOverride: string | undefined;
                if (this.isRootIntegerAddress(address)) {
                    const chosen = await this.promptForIndexHeading();
                    if (chosen) {
                        headingOverride = chosen;
                    }
                    // If cancelled, still insert the backlink but skip the forward link heading choice
                    // (fall back to default forwardLinkHeading)
                }

                this.processingFiles.add(parentFile.path);

                try {
                    await this.insertBacklink(file, parentFile);
                    await this.insertForwardLink(parentFile, file, headingOverride);
                } finally {
                    setTimeout(() => {
                        this.processingFiles.delete(parentFile.path);
                    }, 1000);
                }
            }
        } finally {
            setTimeout(() => {
                this.processingFiles.delete(file.path);
            }, 1000);
        }
    }
}

// ============================================================================
// Settings Tab
// ============================================================================

class FolgezettelSettingTab extends PluginSettingTab {
    plugin: BidirectionalFolgezettelPlugin;

    constructor(app: App, plugin: BidirectionalFolgezettelPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Bidirectional Folgezettel Settings' });

        // ====================================================================
        // General Settings
        // ====================================================================
        new Setting(containerEl).setName('General').setHeading();

        new Setting(containerEl)
            .setName('Auto-process new notes')
            .setDesc('Automatically add folgezettel links and apply templates when new notes are created')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoProcess)
                .onChange(async (value) => {
                    this.plugin.settings.autoProcess = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show notifications')
            .setDesc('Display notifications when links are inserted')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showNotifications)
                .onChange(async (value) => {
                    this.plugin.settings.showNotifications = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto bidirectional cross-links')
            .setDesc('Automatically create reciprocal links when you manually insert a link to another note')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoBidirectionalLinks)
                .onChange(async (value) => {
                    this.plugin.settings.autoBidirectionalLinks = value;
                    await this.plugin.saveSettings();
                }));

        // ====================================================================
        // Link Style Settings
        // ====================================================================
        new Setting(containerEl).setName('Link Style').setHeading();

        new Setting(containerEl)
            .setName('Link format')
            .setDesc('Choose the format for generated links')
            .addDropdown(dropdown => dropdown
                .addOption('wikilink', 'Wikilinks [[note|description]]')
                .addOption('markdown', 'Markdown [description](note.md)')
                .setValue(this.plugin.settings.linkStyle)
                .onChange(async (value: LinkStyle) => {
                    this.plugin.settings.linkStyle = value;
                    await this.plugin.saveSettings();
                    // Update the example text
                    this.display();
                }));

        // Show example of current link style
        const linkStyleExample = containerEl.createEl('div', {
            cls: 'setting-item-description',
            attr: { style: 'margin-top: -10px; margin-bottom: 15px; padding-left: 10px;' }
        });
        this.updateLinkStyleExample(linkStyleExample);

        // ====================================================================
        // Link Descriptions
        // ====================================================================
        new Setting(containerEl).setName('Link Descriptions').setHeading();

        new Setting(containerEl)
            .setName('Parent link description')
            .setDesc('Text to display for links to parent notes')
            .addText(text => text
                .setPlaceholder('Parent')
                .setValue(this.plugin.settings.parentLinkDescription)
                .onChange(async (value) => {
                    this.plugin.settings.parentLinkDescription = value || 'Parent';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Child link description')
            .setDesc('Text to display for links to child notes (leave empty to use note title)')
            .addText(text => text
                .setPlaceholder('(uses note title)')
                .setValue(this.plugin.settings.childLinkDescription)
                .onChange(async (value) => {
                    this.plugin.settings.childLinkDescription = value || '';
                    await this.plugin.saveSettings();
                }));

        // ====================================================================
        // Heading Configuration
        // ====================================================================
        new Setting(containerEl).setName('Heading Configuration').setHeading();

        new Setting(containerEl)
            .setName('Backlink heading')
            .setDesc('Heading under which to insert parent backlinks in child notes')
            .addText(text => text
                .setPlaceholder('Related Notes')
                .setValue(this.plugin.settings.backlinkHeading || '')
                .onChange(async (value) => {
                    this.plugin.settings.backlinkHeading = value || '';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Forward link heading')
            .setDesc('Heading under which to insert child links in parent notes')
            .addText(text => text
                .setPlaceholder('Child Notes')
                .setValue(this.plugin.settings.forwardLinkHeading || '')
                .onChange(async (value) => {
                    this.plugin.settings.forwardLinkHeading = value || '';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Cross-link heading')
            .setDesc('Heading under which to insert bidirectional cross-reference links')
            .addText(text => text
                .setPlaceholder('Related Notes')
                .setValue(this.plugin.settings.crossLinkHeading || '')
                .onChange(async (value) => {
                    this.plugin.settings.crossLinkHeading = value || '';
                    await this.plugin.saveSettings();
                }));

        // ====================================================================
        // Template Settings
        // ====================================================================
        new Setting(containerEl).setName('Templates').setHeading();

        new Setting(containerEl)
            .setName('Template folder')
            .setDesc('Folder containing note templates')
            .addText(text => text
                .setPlaceholder('Templates')
                .setValue(this.plugin.settings.templateFolder)
                .onChange(async (value) => {
                    this.plugin.settings.templateFolder = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default template')
            .setDesc('Path to default template for new notes (relative to vault root). Applied to all new folgezettel notes.')
            .addText(text => text
                .setPlaceholder('Templates/default.md')
                .setValue(this.plugin.settings.defaultTemplate)
                .onChange(async (value) => {
                    this.plugin.settings.defaultTemplate = value.trim();
                    await this.plugin.saveSettings();
                }));

        // ====================================================================
        // Child Note Template Settings
        // ====================================================================
        new Setting(containerEl).setName('Child Note Templates').setHeading();

        containerEl.createEl('p', {
            text: 'Configure which template to apply when creating child notes via the "Create next child note" command. If set to "No template", the default template above will be used.',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
            .setName('Template source for child notes')
            .setDesc('Choose which template system to use when creating child notes')
            .addDropdown(dropdown => dropdown
                .addOption('none', 'No template (use default)')
                .addOption('core', 'Core Templates plugin')
                .addOption('templater', 'Templater plugin')
                .setValue(this.plugin.settings.childNoteTemplateSource)
                .onChange(async (value: 'core' | 'templater' | 'none') => {
                    this.plugin.settings.childNoteTemplateSource = value;
                    await this.plugin.saveSettings();
                    // Refresh display to show/hide relevant path settings
                    this.display();
                }));

        // Only show core template path if 'core' is selected
        if (this.plugin.settings.childNoteTemplateSource === 'core') {
            new Setting(containerEl)
                .setName('Core Templates: Child note template path')
                .setDesc('Path to the template file relative to vault root (e.g., "Templates/child-note.md")')
                .addText(text => text
                    .setPlaceholder('Templates/child-note.md')
                    .setValue(this.plugin.settings.childNoteTemplatePath)
                    .onChange(async (value) => {
                        this.plugin.settings.childNoteTemplatePath = value.trim();
                        await this.plugin.saveSettings();
                    }));
        }

        // Only show Templater path if 'templater' is selected
        if (this.plugin.settings.childNoteTemplateSource === 'templater') {
            new Setting(containerEl)
                .setName('Templater: Child note template path')
                .setDesc('Path to the Templater template file relative to vault root')
                .addText(text => text
                    .setPlaceholder('Templates/child-note-templater.md')
                    .setValue(this.plugin.settings.childNoteTemplaterPath)
                    .onChange(async (value) => {
                        this.plugin.settings.childNoteTemplaterPath = value.trim();
                        await this.plugin.saveSettings();
                    }));

            containerEl.createEl('p', {
                text: 'Note: Templater plugin must be installed and enabled for this option to work.',
                cls: 'setting-item-description',
                attr: { style: 'color: var(--text-muted); font-style: italic;' }
            });
        }

        // ====================================================================
        // Advanced Settings
        // ====================================================================
        new Setting(containerEl).setName('Advanced').setHeading();

        new Setting(containerEl)
            .setName('Folgezettel regex')
            .setDesc('Regular expression to match folgezettel patterns in note titles')
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.folgezettelRegex)
                .setValue(this.plugin.settings.folgezettelRegex)
                .onChange(async (value) => {
                    this.plugin.settings.folgezettelRegex = value || DEFAULT_SETTINGS.folgezettelRegex;
                    await this.plugin.saveSettings();
                }));
    }

    /**
     * Update the link style example text.
     */
    private updateLinkStyleExample(container: HTMLElement): void {
        const style = this.plugin.settings.linkStyle;
        let example: string;
        
        if (style === 'markdown') {
            example = 'Example: [Parent](1a2.md)';
        } else {
            example = 'Example: [[1a2|Parent]]';
        }
        
        container.setText(example);
        container.style.fontFamily = 'var(--font-monospace)';
        container.style.fontSize = '0.85em';
        container.style.color = 'var(--text-muted)';
    }
}
