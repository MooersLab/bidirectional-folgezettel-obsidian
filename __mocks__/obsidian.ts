/**
 * Mock for the Obsidian module used in testing.
 * Provides minimal stubs of the classes and types used by the plugin.
 */

export class App {
    vault: any = {
        getMarkdownFiles: () => [],
        read: async (_file: any) => '',
        modify: async (_file: any, _content: string) => {},
        create: async (path: string, _content: string) => {
            const basename = path.replace(/\.md$/, '').split('/').pop() || path;
            return new TFile(path, basename);
        },
        getAbstractFileByPath: (_path: string) => null
    };
    workspace: any = {
        getActiveViewOfType: () => null,
        getActiveFile: () => null,
        getLeaf: () => ({ openFile: async () => {} }),
        onLayoutReady: (cb: () => void) => { cb(); }
    };
}

export class Plugin {
    app: App;
    manifest: any = {};

    constructor(app?: App) {
        this.app = app || new App();
    }

    addCommand() {}
    addRibbonIcon() {}
    addSettingTab() {}
    registerEvent() {}
    loadData() { return Promise.resolve({}); }
    saveData() { return Promise.resolve(); }
}

export class PluginSettingTab {
    app: App;
    plugin: any;
    containerEl: any = {
        empty: () => {},
        createEl: (_tag: string, _opts?: any) => ({
            style: {},
            textContent: '',
            setText: function(_t: string) { this.textContent = _t; return this; },
            createEl: (_tag: string, _opts?: any) => ({
                style: {},
                textContent: '',
                setText: function(_t: string) { this.textContent = _t; return this; },
            }),
        }),
        createDiv: (_opts?: any) => ({})
    };

    constructor(app: App, plugin: any) {
        this.app = app;
        this.plugin = plugin;
    }

    display() {}
}

/** Collected onChange callbacks from the most recent display() call */
const _settingCallbacks: Function[] = [];

export function _getSettingCallbacks() { return _settingCallbacks; }
export function _clearSettingCallbacks() { _settingCallbacks.length = 0; }

export class Setting {
    constructor(_containerEl: any) {}
    setName(_name: string) { return this; }
    setDesc(_desc: string) { return this; }
    setHeading() { return this; }
    addToggle(cb: any) {
        if (cb) {
            const toggle = {
                setValue: (_v: any) => toggle,
                onChange: (fn: any) => { _settingCallbacks.push(fn); return toggle; },
                getValue: () => false
            };
            cb(toggle);
        }
        return this;
    }
    addText(cb: any) {
        if (cb) {
            const text = {
                setPlaceholder: (_v: any) => text,
                setValue: (_v: any) => text,
                onChange: (fn: any) => { _settingCallbacks.push(fn); return text; },
                getValue: () => ''
            };
            cb(text);
        }
        return this;
    }
    addDropdown(cb: any) {
        if (cb) {
            const dropdown = {
                addOption: (_v: any, _l: any) => dropdown,
                setValue: (_v: any) => dropdown,
                onChange: (fn: any) => { _settingCallbacks.push(fn); return dropdown; },
                getValue: () => ''
            };
            cb(dropdown);
        }
        return this;
    }
}

export class TFile {
    path: string;
    basename: string;
    name: string;
    extension: string;
    parent: TFolder | null;

    constructor(path: string, basename: string, parent?: TFolder | null) {
        this.path = path;
        this.basename = basename;
        this.name = basename.includes('.') ? basename : basename + '.md';
        this.extension = 'md';
        this.parent = parent || null;
    }
}

export class TAbstractFile {
    path: string = '';
}

export class TFolder {
    path: string;
    children: (TFile | TFolder)[] = [];
    constructor(path: string) {
        this.path = path;
    }
}

export class Notice {
    message: string;
    constructor(message: string) { this.message = message; }
}

export class MarkdownView {
    file: TFile | null = null;
    editor: any = null;
    containerEl: any = { querySelector: () => null };
}

/** Creates a mock DOM element that tracks event listeners */
function makeEl(): any {
    const el: any = {
        style: {},
        textContent: '',
        innerText: '',
        value: '',
        type: '',
        placeholder: '',
        isContentEditable: false,
        _listeners: {} as Record<string, Function[]>,
        focus: () => {},
        addEventListener: (evt: string, cb: any) => {
            if (!el._listeners[evt]) el._listeners[evt] = [];
            el._listeners[evt].push(cb);
        },
        // Helper for tests to trigger stored listeners
        _trigger: (evt: string, evtObj?: any) => {
            (el._listeners[evt] || []).forEach((cb: any) => cb(evtObj || {}));
        },
        createEl: (_tag: string, _opts?: any) => makeEl(),
        createDiv: (_opts?: any) => makeEl(),
        setText: function(_t: string) { el.textContent = _t; return el; },
        appendChild: () => {},
        querySelectorAll: () => [],
        querySelector: () => null,
        empty: () => {},
        addClass: () => {},
    };
    return el;
}

export class Modal {
    app: App;
    contentEl: any;

    constructor(app: App) {
        this.app = app;
        this.contentEl = makeEl();
    }

    open() { this.onOpen(); }
    close() { this.onClose(); }
    onOpen() {}
    onClose() {}
}

export { makeEl };

export class TextComponent {
    setValue(_value: string) { return this; }
    onChange(_cb: any) { return this; }
}

export class Editor {
    setCursor(_pos: any) {}
    focus() {}
}
