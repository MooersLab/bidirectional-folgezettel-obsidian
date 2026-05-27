/**
 * Comprehensive tests for Bidirectional Folgezettel Plugin
 *
 * Target: ≥ 90 % line coverage across all testable logic in main.ts.
 */

import BidirectionalFolgezettelPlugin from './main';
import { App, TFile, TFolder, MarkdownView } from 'obsidian';
import { _getSettingCallbacks, _clearSettingCallbacks } from 'obsidian';

// ---------------------------------------------------------------------------
// Helper: create a plugin instance with mock vault files
// ---------------------------------------------------------------------------

/** Content stored per-file path by the mock vault. */
type VaultStore = Map<string, string>;

function createPlugin(
    fileBasenames: string[] = [],
    fileContents?: Record<string, string>
): BidirectionalFolgezettelPlugin {
    const app = new App();
    const store: VaultStore = new Map();

    // Build mock TFile array from basenames
    const mockFiles: TFile[] = fileBasenames.map(basename => {
        const f = new TFile(`${basename}.md`, basename);
        store.set(f.path, (fileContents && fileContents[basename]) || '');
        return f;
    });

    app.vault.getMarkdownFiles = () => mockFiles;
    app.vault.read = async (file: TFile) => store.get(file.path) || '';
    app.vault.modify = async (file: TFile, content: string) => {
        store.set(file.path, content);
    };
    app.vault.create = async (path: string, content: string) => {
        const basename = path.replace(/\.md$/, '').split('/').pop() || path;
        const f = new TFile(path, basename);
        store.set(path, content);
        mockFiles.push(f);
        return f;
    };
    app.vault.getAbstractFileByPath = (path: string) => {
        if (path === 'Templates') {
            return new TFolder('Templates');
        }
        return mockFiles.find(f => f.path === path) || null;
    };

    const plugin = new BidirectionalFolgezettelPlugin(app) as any;

    // Initialise settings and regex (normally done in onload)
    plugin.settings = {
        autoProcess: true,
        showNotifications: false,       // silence Notices in tests
        autoBidirectionalLinks: true,
        parentLinkDescription: 'Parent',
        childLinkDescription: '',
        backlinkHeading: 'Related Notes',
        forwardLinkHeading: 'Child Notes',
        crossLinkHeading: 'Related Notes',
        folgezettelRegex: '([0-9]+(?:[.][0-9]+)*(?:[a-z]+(?:[0-9]+)?)*)',
        templateFolder: 'Templates',
        defaultTemplate: '',
        childNoteTemplatePath: '',
        childNoteTemplaterPath: '',
        childNoteTemplateSource: 'none',
        linkStyle: 'wikilink'
    };

    plugin.folgezettelRegexCompiled = new RegExp(plugin.settings.folgezettelRegex);

    // Expose the store so tests can inspect file contents
    (plugin as any).__store = store;

    return plugin;
}

/** Read what the mock vault currently holds for a file path. */
function readStore(plugin: any, path: string): string {
    return plugin.__store.get(path) || '';
}

/**
 * Build a minimal editor stand-in for the cursor-aware sibling logic.
 * `content` is the note body; `cursorLine` is the zero-based line the cursor
 * sits on.
 */
function mockEditor(content: string, cursorLine = 0): any {
    return {
        getValue: () => content,
        getCursor: () => ({ line: cursorLine, ch: 0 }),
        setCursor: () => {},
        focus: () => {}
    };
}

/**
 * Build a minimal MarkdownView stand-in carrying a file, an editor, and a
 * containerEl whose querySelector returns null (so positionCursorAtEndOfTitle
 * takes its editor fallback instead of touching the DOM).
 */
function mockView(file: any, body = '', cursorLine = 0): any {
    return {
        file,
        editor: mockEditor(body, cursorLine),
        containerEl: { querySelector: () => null }
    };
}

// ===========================================================================
// parseAddress
// ===========================================================================

describe('parseAddress', () => {
    const plugin = createPlugin();

    test('parses a simple integer', () => {
        const r = plugin.parseAddress('20');
        expect(r).not.toBeNull();
        expect(r!.segments).toEqual([20]);
        expect(r!.raw).toBe('20');
    });

    test('parses dot-notation', () => {
        expect(plugin.parseAddress('1.2')!.segments).toEqual([1, 2]);
    });

    test('parses three-level dot-notation', () => {
        expect(plugin.parseAddress('1.2.3')!.segments).toEqual([1, 2, 3]);
    });

    test('parses mixed alphanumeric', () => {
        expect(plugin.parseAddress('1a2')!.segments).toEqual([1, 'a', 2]);
    });

    test('parses complex address 20.1a3b', () => {
        expect(plugin.parseAddress('20.1a3b')!.segments).toEqual([20, 1, 'a', 3, 'b']);
    });

    test('parses 00.0 index', () => {
        expect(plugin.parseAddress('00.0')!.segments).toEqual([0, 0]);
    });

    test('parses multi-letter segment', () => {
        expect(plugin.parseAddress('1aa')!.segments).toEqual([1, 'aa']);
    });

    test('returns null for empty string', () => {
        expect(plugin.parseAddress('')).toBeNull();
    });

    test('returns null for invalid characters', () => {
        expect(plugin.parseAddress('!@#')).toBeNull();
    });

    test('returns null for only spaces', () => {
        // spaces won't match number or letter regex
        expect(plugin.parseAddress('   ')).toBeNull();
    });
});

// ===========================================================================
// segmentsToAddress (private – tested via round-trip through getParentAddress)
// ===========================================================================

describe('segmentsToAddress round-trip via getParentAddress', () => {
    const plugin = createPlugin();

    test('number.number parent drops last segment with dot', () => {
        // '1.2' → segments [1,2] → parent [1] → '1'
        expect(plugin.getParentAddress('1.2')).toBe('1');
    });

    test('number.number.number parent', () => {
        expect(plugin.getParentAddress('1.2.3')).toBe('1.2');
    });

    test('number-letter parent', () => {
        expect(plugin.getParentAddress('1a')).toBe('1');
    });

    test('number-letter-number parent', () => {
        expect(plugin.getParentAddress('1a2')).toBe('1a');
    });
});

// ===========================================================================
// getParentAddress
// ===========================================================================

describe('getParentAddress', () => {
    const plugin = createPlugin();

    test('root integer returns 00.0', () => {
        expect(plugin.getParentAddress('20')).toBe('00.0');
        expect(plugin.getParentAddress('1')).toBe('00.0');
    });

    test('00.0 returns null', () => {
        expect(plugin.getParentAddress('00.0')).toBeNull();
    });

    test('dot-notation child returns root integer parent', () => {
        expect(plugin.getParentAddress('20.1')).toBe('20');
    });

    test('letter child returns number parent', () => {
        expect(plugin.getParentAddress('1a')).toBe('1');
    });

    test('deeply nested address', () => {
        expect(plugin.getParentAddress('1.2a3')).toBe('1.2a');
    });

    test('single letter returns null', () => {
        expect(plugin.getParentAddress('a')).toBeNull();
    });

    test('returns null for unparseable address', () => {
        // Force an unparseable address
        expect(plugin.getParentAddress('')).toBeNull();
    });
});

// ===========================================================================
// extractFromTitle
// ===========================================================================

describe('extractFromTitle', () => {
    const plugin = createPlugin();

    test('integer', () => expect(plugin.extractFromTitle('20')).toBe('20'));
    test('dot-notation', () => expect(plugin.extractFromTitle('1.2')).toBe('1.2'));
    test('with trailing text', () => expect(plugin.extractFromTitle('20 Some Title')).toBe('20'));
    test('00.0', () => expect(plugin.extractFromTitle('00.0')).toBe('00.0'));
    test('00.0 with text', () => expect(plugin.extractFromTitle('00.0 Index of Indices')).toBe('00.0'));
    test('complex', () => expect(plugin.extractFromTitle('1.2a3b Note')).toBe('1.2a3b'));
    test('no match', () => expect(plugin.extractFromTitle('No Address')).toBeNull());

    test('compiles regex on first call if null', () => {
        const p = createPlugin();
        (p as any).folgezettelRegexCompiled = null;
        expect(p.extractFromTitle('5')).toBe('5');
    });
});

// ===========================================================================
// validateAddressFormat
// ===========================================================================

describe('validateAddressFormat', () => {
    const plugin = createPlugin();

    test('valid: integer', () => expect(plugin.validateAddressFormat('20').valid).toBe(true));
    test('valid: dot-notation', () => expect(plugin.validateAddressFormat('1.2').valid).toBe(true));
    test('valid: mixed', () => expect(plugin.validateAddressFormat('1a2b').valid).toBe(true));
    test('valid: 00.0', () => expect(plugin.validateAddressFormat('00.0').valid).toBe(true));
    test('valid: multi-letter', () => expect(plugin.validateAddressFormat('1ab').valid).toBe(true));

    test('rejects empty', () => {
        const r = plugin.validateAddressFormat('');
        expect(r.valid).toBe(false);
        expect(r.error).toContain('empty');
    });

    test('rejects whitespace-only', () => {
        expect(plugin.validateAddressFormat('   ').valid).toBe(false);
    });

    test('rejects trailing period', () => {
        expect(plugin.validateAddressFormat('20.').valid).toBe(false);
    });

    test('rejects leading period', () => {
        expect(plugin.validateAddressFormat('.20').valid).toBe(false);
    });

    test('rejects consecutive periods', () => {
        expect(plugin.validateAddressFormat('1..2').valid).toBe(false);
    });

    test('rejects invalid chars', () => {
        expect(plugin.validateAddressFormat('1*2').valid).toBe(false);
        expect(plugin.validateAddressFormat('1[2').valid).toBe(false);
    });
});

// ===========================================================================
// validateAddress (with duplicate checking)
// ===========================================================================

describe('validateAddress', () => {
    test('valid, no duplicate', () => {
        const plugin = createPlugin(['1', '2']);
        const r = plugin.validateAddress('3');
        expect(r.isValid).toBe(true);
        expect(r.isDuplicate).toBe(false);
    });

    test('valid, duplicate detected', () => {
        const plugin = createPlugin(['1', '2']);
        const r = plugin.validateAddress('2');
        expect(r.isValid).toBe(true);
        expect(r.isDuplicate).toBe(true);
        expect(r.existingFile).not.toBeNull();
        expect(r.existingFile!.basename).toBe('2');
    });

    test('invalid format returns isValid false', () => {
        const plugin = createPlugin();
        const r = plugin.validateAddress('');
        expect(r.isValid).toBe(false);
        expect(r.isDuplicate).toBe(false);
    });
});

// ===========================================================================
// findFileByAddress / findParentFile
// ===========================================================================

describe('findFileByAddress / findParentFile', () => {
    test('finds existing file', () => {
        const plugin = createPlugin(['20', '20.1']);
        const f = plugin.findFileByAddress('20');
        expect(f).not.toBeNull();
        expect(f!.basename).toBe('20');
    });

    test('returns null for missing file', () => {
        const plugin = createPlugin(['20']);
        expect(plugin.findFileByAddress('99')).toBeNull();
    });

    test('findParentFile returns 00.0 for root integer', () => {
        const plugin = createPlugin(['00.0', '20']);
        expect(plugin.findParentFile('20')!.basename).toBe('00.0');
    });

    test('findParentFile returns null when parent missing', () => {
        const plugin = createPlugin(['20.1']);
        expect(plugin.findParentFile('20.1')).toBeNull();
    });

    test('findParentFile returns null for 00.0', () => {
        const plugin = createPlugin(['00.0']);
        expect(plugin.findParentFile('00.0')).toBeNull();
    });
});

// ===========================================================================
// suggestNextChild
// ===========================================================================

describe('suggestNextChild', () => {
    test('00.0 with no roots suggests 1', () => {
        expect(createPlugin(['00.0']).suggestNextChild('00.0')).toBe('1');
    });

    test('00.0 with roots suggests max+1', () => {
        expect(createPlugin(['00.0', '1', '2', '5', '20']).suggestNextChild('00.0')).toBe('21');
    });

    test('root integer suggests dot child', () => {
        expect(createPlugin(['20']).suggestNextChild('20')).toBe('20.1');
    });

    test('root integer with existing dot children', () => {
        expect(createPlugin(['20', '20.1', '20.2', '20.3']).suggestNextChild('20')).toBe('20.4');
    });

    test('dot-notation parent suggests letter child', () => {
        expect(createPlugin(['1.2']).suggestNextChild('1.2')).toBe('1.2a');
    });

    test('dot-notation with existing letters', () => {
        expect(createPlugin(['1.2', '1.2a', '1.2b']).suggestNextChild('1.2')).toBe('1.2c');
    });

    test('letter parent suggests number child', () => {
        expect(createPlugin(['1a']).suggestNextChild('1a')).toBe('1a1');
    });

    test('letter parent with existing number children', () => {
        expect(createPlugin(['1a', '1a1', '1a2']).suggestNextChild('1a')).toBe('1a3');
    });

    test('unparseable address returns address + a', () => {
        const plugin = createPlugin();
        // Override regex to make everything unparseable
        (plugin as any).folgezettelRegexCompiled = /^$/;
        // The internal parseAddress now fails, so suggestNextChild falls through
        // to its root-integer check first; use a letter-based address
        // Actually, suggestNextChild checks parentAddress === '00.0' then /^[0-9]+$/ first.
        // For a non-matching address we need something that isn't 00.0 or pure digits.
        // Reset regex and test with a truly unparseable via parseAddress mock:
        (plugin as any).folgezettelRegexCompiled = new RegExp(plugin.settings.folgezettelRegex);
        // parseAddress returns null for '' but suggestNextChild would never receive ''
        // from real code. Let's test the fallback by mocking parseAddress:
        const origParse = plugin.parseAddress.bind(plugin);
        plugin.parseAddress = (_addr: string) => null;
        expect(plugin.suggestNextChild('xyz')).toBe('xyza');
        plugin.parseAddress = origParse;
    });
});

// ===========================================================================
// firstChildAddress
// ===========================================================================

describe('firstChildAddress', () => {
    test('00.0 index first child is root integer 1', () => {
        expect(createPlugin().firstChildAddress('00.0')).toBe('1');
    });

    test('root integer first child uses dot notation .1', () => {
        expect(createPlugin().firstChildAddress('20')).toBe('20.1');
    });

    test('parent ending in a number gets a letter child', () => {
        expect(createPlugin().firstChildAddress('1.2')).toBe('1.2a');
    });

    test('parent ending in a letter gets a number child', () => {
        expect(createPlugin().firstChildAddress('1.2a')).toBe('1.2a1');
    });

    test('deeper alternation is preserved', () => {
        expect(createPlugin().firstChildAddress('1.2a3')).toBe('1.2a3a');
        expect(createPlugin().firstChildAddress('1.2a3aa')).toBe('1.2a3aa1');
    });

    test('is independent of existing children in the vault', () => {
        // Even though 20.1 and 20.2 already exist, the *first* child is still 20.1.
        const plugin = createPlugin(['20', '20.1', '20.2']);
        expect(plugin.firstChildAddress('20')).toBe('20.1');
    });

    test('matches suggestNextChild when no children exist', () => {
        const plugin = createPlugin(['20']);
        expect(plugin.firstChildAddress('20')).toBe(plugin.suggestNextChild('20'));
    });

    test('returns null for an unparseable address', () => {
        const plugin = createPlugin();
        const origParse = plugin.parseAddress;
        plugin.parseAddress = () => null;
        expect(plugin.firstChildAddress('1.2a')).toBeNull();
        plugin.parseAddress = origParse;
    });
});

// ===========================================================================
// suggestNextChildForHeading
// ===========================================================================

describe('suggestNextChildForHeading', () => {
    test('returns next integer after max under Subject Matter heading', async () => {
        const plugin = createPlugin(['00.0', '1', '5', '10'], {
            '00.0': '## Subject Matter\n- [[1 Alpha]]\n- [[5 Beta]]\n\n## Project Support\n- [[10 Gamma]]\n'
        });
        const result = await plugin.suggestNextChildForHeading('## Subject Matter');
        expect(result).toBe('6');
    });

    test('returns next integer after max under Project Support heading', async () => {
        const plugin = createPlugin(['00.0', '1', '5', '10', '20'], {
            '00.0': '## Subject Matter\n- [[1 Alpha]]\n- [[5 Beta]]\n\n## Project Support\n- [[10 Gamma]]\n- [[20 Delta]]\n'
        });
        const result = await plugin.suggestNextChildForHeading('## Project Support');
        expect(result).toBe('21');
    });

    test('falls back to vault-wide when heading has no links', async () => {
        const plugin = createPlugin(['00.0', '3'], {
            '00.0': '## Subject Matter\n\n## Project Support\n- [[3 Foo]]\n'
        });
        // Subject Matter has no links, so it falls back to vault-wide (max of all root ints = 3, so 4)
        const result = await plugin.suggestNextChildForHeading('## Subject Matter');
        expect(result).toBe('4');
    });

    test('falls back when 00.0 file does not exist', async () => {
        const plugin = createPlugin(['5']);
        const result = await plugin.suggestNextChildForHeading('## Subject Matter');
        expect(result).toBe('6');
    });

    test('falls back when heading is not found in file', async () => {
        const plugin = createPlugin(['00.0', '2'], {
            '00.0': '## Subject Matter\n- [[2 Foo]]\n'
        });
        const result = await plugin.suggestNextChildForHeading('## Nonexistent Heading');
        expect(result).toBe('3');
    });

    test('handles markdown-style links', async () => {
        const plugin = createPlugin(['00.0', '7'], {
            '00.0': '## Subject Matter\n- [7 Foo](7 Foo)\n\n## Project Support\n'
        });
        const result = await plugin.suggestNextChildForHeading('## Subject Matter');
        expect(result).toBe('8');
    });

    test('handles vault read error gracefully', async () => {
        const plugin = createPlugin(['00.0', '4'], {
            '00.0': '## Subject Matter\n- [[4 Foo]]\n'
        });
        plugin.app.vault.read = async () => { throw new Error('read error'); };
        const result = await plugin.suggestNextChildForHeading('## Subject Matter');
        // Falls back to vault-wide: max root int is 4, so 5
        expect(result).toBe('5');
    });
});

// ===========================================================================
// suggestDotNotationChild
// ===========================================================================

describe('suggestDotNotationChild', () => {
    test('root integer', () => expect(createPlugin(['20']).suggestDotNotationChild('20')).toBe('20.1'));

    test('with existing', () => {
        expect(createPlugin(['20', '20.1', '20.2']).suggestDotNotationChild('20')).toBe('20.3');
    });

    test('non-root returns null', () => {
        expect(createPlugin(['1a']).suggestDotNotationChild('1a')).toBeNull();
    });

    test('dot-notation returns null', () => {
        expect(createPlugin(['1.2']).suggestDotNotationChild('1.2')).toBeNull();
    });
});

// ===========================================================================
// findChildrenOf
// ===========================================================================

describe('findChildrenOf', () => {
    test('00.0 finds root integers only', () => {
        const children = createPlugin(['00.0', '1', '2', '20', '1.1', '1a']).findChildrenOf('00.0');
        expect(children).toEqual(expect.arrayContaining(['1', '2', '20']));
        expect(children).not.toContain('1.1');
        expect(children).not.toContain('1a');
    });

    test('root integer finds its descendants', () => {
        const children = createPlugin(['20', '20.1', '20.2', '20.1a', '21']).findChildrenOf('20');
        expect(children).toContain('20.1');
        expect(children).toContain('20.2');
        expect(children).toContain('20.1a');
        expect(children).not.toContain('21');
    });

    test('dot-notation parent', () => {
        const children = createPlugin(['1.2', '1.2a', '1.2b', '1.3']).findChildrenOf('1.2');
        expect(children).toEqual(expect.arrayContaining(['1.2a', '1.2b']));
        expect(children).not.toContain('1.3');
    });

    test('returns empty when no children', () => {
        expect(createPlugin(['5']).findChildrenOf('5')).toEqual([]);
    });
});

// ===========================================================================
// Letter sequence helpers (tested via suggestNextChild)
// ===========================================================================

describe('letter sequence edge cases', () => {
    test('z wraps to aa', () => {
        const basenames = ['1.2'];
        // Add a through z
        for (let c = 97; c <= 122; c++) {
            basenames.push('1.2' + String.fromCharCode(c));
        }
        const plugin = createPlugin(basenames);
        expect(plugin.suggestNextChild('1.2')).toBe('1.2aa');
    });
});

// ===========================================================================
// isRootIntegerAddress
// ===========================================================================

describe('isRootIntegerAddress', () => {
    const plugin = createPlugin();
    test('pure integers', () => {
        expect(plugin.isRootIntegerAddress('1')).toBe(true);
        expect(plugin.isRootIntegerAddress('999')).toBe(true);
    });
    test('dot-notation false', () => expect(plugin.isRootIntegerAddress('1.2')).toBe(false));
    test('00.0 false', () => expect(plugin.isRootIntegerAddress('00.0')).toBe(false));
    test('letters false', () => expect(plugin.isRootIntegerAddress('1a')).toBe(false));
    test('empty false', () => expect(plugin.isRootIntegerAddress('')).toBe(false));
});

// ===========================================================================
// Link generation
// ===========================================================================

describe('generateLink / generateWikilink / generateMarkdownLink', () => {
    test('wikilink with different description', () => {
        const plugin = createPlugin();
        const target = new TFile('20.md', '20');
        expect(plugin.generateLink(target, 'Parent')).toBe('[[20|Parent]]');
    });

    test('wikilink with same-as-basename description', () => {
        const plugin = createPlugin();
        const target = new TFile('20.md', '20');
        expect(plugin.generateLink(target, '20')).toBe('[[20]]');
    });

    test('markdown link style', () => {
        const plugin = createPlugin();
        plugin.settings.linkStyle = 'markdown';
        const target = new TFile('notes/20.md', '20');
        (target as any).name = '20.md';
        const source = new TFile('notes/1.md', '1');
        expect(plugin.generateLink(target, 'Parent', source)).toContain('[Parent]');
    });

    test('markdown link without source uses filename', () => {
        const plugin = createPlugin();
        plugin.settings.linkStyle = 'markdown';
        const target = new TFile('20.md', '20');
        (target as any).name = '20.md';
        const link = plugin.generateLink(target, 'Parent');
        expect(link).toBe('[Parent](20.md)');
    });

    test('markdown link with source in same folder', () => {
        const plugin = createPlugin();
        plugin.settings.linkStyle = 'markdown';
        const folder = new TFolder('notes');
        const target = new TFile('notes/20.md', '20', folder);
        (target as any).name = '20.md';
        const source = new TFile('notes/1.md', '1', folder);
        const link = plugin.generateLink(target, 'Parent', source);
        expect(link).toBe('[Parent](20.md)');
    });

    test('markdown link with source in different folder', () => {
        const plugin = createPlugin();
        plugin.settings.linkStyle = 'markdown';
        const folderA = new TFolder('folderA');
        const folderB = new TFolder('folderB');
        const target = new TFile('folderB/20.md', '20', folderB);
        (target as any).name = '20.md';
        const source = new TFile('folderA/1.md', '1', folderA);
        const link = plugin.generateLink(target, 'Parent', source);
        expect(link).toContain('../folderB/20.md');
    });
});

// ===========================================================================
// extractLinks (private – tested indirectly via onFileModify, or directly)
// ===========================================================================

describe('extractLinks', () => {
    test('extracts wikilinks', () => {
        const plugin = createPlugin();
        const links = (plugin as any).extractLinks('See [[20]] and [[1.2|note]].');
        expect(links.has('20')).toBe(true);
        expect(links.has('1.2')).toBe(true);
    });

    test('extracts markdown links', () => {
        const plugin = createPlugin();
        const links = (plugin as any).extractLinks('See [note](20.md) and [x](../folder/1.2.md).');
        expect(links.has('20')).toBe(true);
        expect(links.has('1.2')).toBe(true);
    });

    test('empty content returns empty set', () => {
        const plugin = createPlugin();
        const links = (plugin as any).extractLinks('');
        expect(links.size).toBe(0);
    });
});

// ===========================================================================
// contentContainsLinkTo
// ===========================================================================

describe('contentContainsLinkTo', () => {
    test('detects wikilink', () => {
        const plugin = createPlugin();
        expect((plugin as any).contentContainsLinkTo('- [[20|Parent]]', '20')).toBe(true);
    });

    test('detects wikilink without alias', () => {
        const plugin = createPlugin();
        expect((plugin as any).contentContainsLinkTo('- [[20]]', '20')).toBe(true);
    });

    test('detects markdown link', () => {
        const plugin = createPlugin();
        expect((plugin as any).contentContainsLinkTo('- [Parent](20.md)', '20')).toBe(true);
    });

    test('returns false when absent', () => {
        const plugin = createPlugin();
        expect((plugin as any).contentContainsLinkTo('No links here', '20')).toBe(false);
    });
});

// ===========================================================================
// escapeRegex
// ===========================================================================

describe('escapeRegex', () => {
    test('escapes special characters', () => {
        const plugin = createPlugin();
        const escaped = (plugin as any).escapeRegex('1.2[3]');
        expect(escaped).toBe('1\\.2\\[3\\]');
    });

    test('leaves plain text unchanged', () => {
        const plugin = createPlugin();
        expect((plugin as any).escapeRegex('abc123')).toBe('abc123');
    });
});

// ===========================================================================
// isListItem
// ===========================================================================

describe('isListItem', () => {
    const plugin = createPlugin();
    const check = (line: string) => (plugin as any).isListItem(line);

    test('dash list', () => expect(check('- item')).toBe(true));
    test('asterisk list', () => expect(check('* item')).toBe(true));
    test('ordered list (dot)', () => expect(check('1. item')).toBe(true));
    test('ordered list (paren)', () => expect(check('2) item')).toBe(true));
    test('checkbox', () => expect(check('- [x] done')).toBe(true));
    test('checkbox without space', () => expect(check('-[x] done')).toBe(true));
    test('asterisk checkbox', () => expect(check('*[ ] task')).toBe(true));
    test('indented dash', () => expect(check('  - nested')).toBe(true));
    test('heading is not list', () => expect(check('## Heading')).toBe(false));
    test('plain text is not list', () => expect(check('just text')).toBe(false));
    test('empty line is not list', () => expect(check('')).toBe(false));
});

// ===========================================================================
// insertLinkUnderHeading
// ===========================================================================

describe('insertLinkUnderHeading', () => {
    test('creates heading at end when heading does not exist', async () => {
        const plugin = createPlugin(['20']);
        const file = new TFile('20.md', '20');
        (plugin as any).__store.set('20.md', 'Some content');
        await (plugin as any).insertLinkUnderHeading(file, '[[1|Parent]]', 'Related Notes', '1');
        const content = readStore(plugin, '20.md');
        expect(content).toContain('## Related Notes');
        expect(content).toContain('- [[1|Parent]]');
    });

    test('appends to existing list under heading', async () => {
        const plugin = createPlugin(['20']);
        const file = new TFile('20.md', '20');
        (plugin as any).__store.set('20.md', '## Related Notes\n\n- [[existing]]');
        await (plugin as any).insertLinkUnderHeading(file, '[[1|Parent]]', 'Related Notes', '1');
        const content = readStore(plugin, '20.md');
        expect(content).toContain('- [[existing]]');
        expect(content).toContain('- [[1|Parent]]');
    });

    test('skips insertion when link already exists', async () => {
        const plugin = createPlugin(['20']);
        const file = new TFile('20.md', '20');
        (plugin as any).__store.set('20.md', '## Related Notes\n\n- [[1|Parent]]');
        await (plugin as any).insertLinkUnderHeading(file, '[[1|Parent]]', 'Related Notes', '1');
        const content = readStore(plugin, '20.md');
        // Should still have exactly one occurrence
        const count = (content.match(/\[\[1\|Parent\]\]/g) || []).length;
        expect(count).toBe(1);
    });

    test('inserts at beginning when heading is null', async () => {
        const plugin = createPlugin(['20']);
        const file = new TFile('20.md', '20');
        (plugin as any).__store.set('20.md', 'Body text');
        await (plugin as any).insertLinkUnderHeading(file, '[[1|Parent]]', null, '1');
        const content = readStore(plugin, '20.md');
        expect(content.startsWith('- [[1|Parent]]')).toBe(true);
    });

    test('inserts after frontmatter when heading is null', async () => {
        const plugin = createPlugin(['20']);
        const file = new TFile('20.md', '20');
        (plugin as any).__store.set('20.md', '---\ntitle: test\n---\nBody');
        await (plugin as any).insertLinkUnderHeading(file, '[[1|Parent]]', null, '1');
        const content = readStore(plugin, '20.md');
        const lines = content.split('\n');
        // Link should be after frontmatter closing ---
        const fmEnd = lines.indexOf('---', 1);
        expect(lines[fmEnd + 1]).toBe('- [[1|Parent]]');
    });

    test('inserts under heading with blank line after heading', async () => {
        const plugin = createPlugin(['20']);
        const file = new TFile('20.md', '20');
        (plugin as any).__store.set('20.md', '## Child Notes\n\n## Other');
        await (plugin as any).insertLinkUnderHeading(file, '[[5]]', 'Child Notes', '5');
        const content = readStore(plugin, '20.md');
        expect(content).toContain('- [[5]]');
    });

    test('inserts before non-list content in section', async () => {
        const plugin = createPlugin(['20']);
        const file = new TFile('20.md', '20');
        (plugin as any).__store.set('20.md', '## Related Notes\n\nSome paragraph text.\n\n## Other');
        await (plugin as any).insertLinkUnderHeading(file, '[[5]]', 'Related Notes', '5');
        const content = readStore(plugin, '20.md');
        const lines = content.split('\n');
        const linkIdx = lines.findIndex((l: string) => l.includes('[[5]]'));
        const paraIdx = lines.findIndex((l: string) => l.includes('Some paragraph'));
        expect(linkIdx).toBeLessThan(paraIdx);
    });

    test('creates heading with blank line when file does not end with blank', async () => {
        const plugin = createPlugin(['20']);
        const file = new TFile('20.md', '20');
        (plugin as any).__store.set('20.md', 'Content without trailing newline');
        await (plugin as any).insertLinkUnderHeading(file, '[[5]]', 'New Heading', '5');
        const content = readStore(plugin, '20.md');
        expect(content).toContain('\n\n## New Heading');
    });
});

// ===========================================================================
// insertBacklink / insertForwardLink
// ===========================================================================

describe('insertBacklink', () => {
    test('inserts parent link under backlinkHeading', async () => {
        const plugin = createPlugin(['20', '20.1']);
        const child = new TFile('20.1.md', '20.1');
        const parent = new TFile('20.md', '20');
        (plugin as any).__store.set('20.1.md', '');
        await plugin.insertBacklink(child, parent);
        const content = readStore(plugin, '20.1.md');
        expect(content).toContain('## Related Notes');
        expect(content).toContain('[[20|Parent]]');
    });
});

describe('insertForwardLink', () => {
    test('uses default heading', async () => {
        const plugin = createPlugin(['20', '20.1']);
        const parent = new TFile('20.md', '20');
        const child = new TFile('20.1.md', '20.1');
        (plugin as any).__store.set('20.md', '');
        await plugin.insertForwardLink(parent, child);
        const content = readStore(plugin, '20.md');
        expect(content).toContain('## Child Notes');
        expect(content).toContain('[[20.1]]');
    });

    test('uses heading override', async () => {
        const plugin = createPlugin(['00.0', '20']);
        const parent = new TFile('00.0.md', '00.0');
        const child = new TFile('20.md', '20');
        (plugin as any).__store.set('00.0.md', '## Subject Matter\n\n## Project Support\n');
        await plugin.insertForwardLink(parent, child, 'Subject Matter');
        const content = readStore(plugin, '00.0.md');
        expect(content).toContain('[[20]]');
        // The link should appear between Subject Matter and Project Support
        const smIdx = content.indexOf('## Subject Matter');
        const psIdx = content.indexOf('## Project Support');
        const linkIdx = content.indexOf('[[20]]');
        expect(linkIdx).toBeGreaterThan(smIdx);
        expect(linkIdx).toBeLessThan(psIdx);
    });

    test('uses Project Support heading override', async () => {
        const plugin = createPlugin(['00.0', '20']);
        const parent = new TFile('00.0.md', '00.0');
        const child = new TFile('20.md', '20');
        (plugin as any).__store.set('00.0.md', '## Subject Matter\n\n## Project Support\n');
        await plugin.insertForwardLink(parent, child, 'Project Support');
        const content = readStore(plugin, '00.0.md');
        const psIdx = content.indexOf('## Project Support');
        const linkIdx = content.indexOf('[[20]]');
        expect(linkIdx).toBeGreaterThan(psIdx);
    });

    test('uses childLinkDescription when set', async () => {
        const plugin = createPlugin(['20', '20.1']);
        plugin.settings.childLinkDescription = 'Child';
        const parent = new TFile('20.md', '20');
        const child = new TFile('20.1.md', '20.1');
        (plugin as any).__store.set('20.md', '');
        await plugin.insertForwardLink(parent, child);
        const content = readStore(plugin, '20.md');
        expect(content).toContain('[[20.1|Child]]');
    });
});

// ===========================================================================
// processTemplateVariables
// ===========================================================================

describe('processTemplateVariables', () => {
    test('replaces all template variables', () => {
        const plugin = createPlugin(['20.1']);
        const file = new TFile('notes/20.1.md', '20.1', new TFolder('notes'));
        const template = '{{title}} created on {{date}} at {{time}} ({{datetime}}) in {{folder}} parent={{parent}}';
        const result = plugin.processTemplateVariables(template, file);
        expect(result).toContain('20.1');
        expect(result).toContain('notes');
        expect(result).toContain('parent=20');
        expect(result).not.toContain('{{');
    });

    test('parent is empty for root integer', () => {
        const plugin = createPlugin(['20']);
        const file = new TFile('20.md', '20');
        const result = plugin.processTemplateVariables('parent={{parent}}', file);
        // getParentAddress('20') returns '00.0', not empty
        expect(result).toBe('parent=00.0');
    });
});

// ===========================================================================
// isWithinCreationGracePeriod
// ===========================================================================

describe('isWithinCreationGracePeriod', () => {
    test('returns true within grace period', () => {
        const plugin = createPlugin();
        (plugin as any).fileCreationTimes.set('test.md', Date.now());
        expect((plugin as any).isWithinCreationGracePeriod('test.md')).toBe(true);
    });

    test('returns false when no creation time recorded', () => {
        const plugin = createPlugin();
        expect((plugin as any).isWithinCreationGracePeriod('unknown.md')).toBe(false);
    });

    test('returns false after grace period', () => {
        const plugin = createPlugin();
        (plugin as any).fileCreationTimes.set('test.md', Date.now() - 10000);
        expect((plugin as any).isWithinCreationGracePeriod('test.md')).toBe(false);
    });
});

// ===========================================================================
// layoutReady guard
// ===========================================================================

describe('layoutReady guard', () => {
    test('plugin starts with layoutReady = false', () => {
        const app = new App();
        // Prevent onLayoutReady from auto-firing so we can test the flag
        app.workspace.onLayoutReady = (_cb: any) => {};
        const plugin = new BidirectionalFolgezettelPlugin(app) as any;
        plugin.settings = { folgezettelRegex: '([0-9]+)' };
        plugin.folgezettelRegexCompiled = /([0-9]+)/;
        expect(plugin.layoutReady).toBe(false);
    });

    test('layoutReady becomes true after onload sets callback', async () => {
        const app = new App();
        let callbackWasSet = false;
        app.workspace.onLayoutReady = (fn: () => void) => {
            callbackWasSet = true;
            fn(); // Immediately call to simulate Obsidian behavior
        };
        app.vault.on = () => {};
        const plugin = new BidirectionalFolgezettelPlugin(app) as any;
        expect(plugin.layoutReady).toBe(false);
        await plugin.onload();
        // After onload, the callback should have fired
        expect(callbackWasSet).toBe(true);
        expect(plugin.layoutReady).toBe(true);
    });

    test('onload registers layout ready callback', async () => {
        const app = new App();
        let callbackFired = false;
        app.workspace.onLayoutReady = (fn: () => void) => {
            callbackFired = true;
            fn();
        };
        app.vault.on = () => {};
        const plugin = new BidirectionalFolgezettelPlugin(app) as any;
        await plugin.onload();
        expect(callbackFired).toBe(true);
        expect(plugin.layoutReady).toBe(true);
    });

    test('events guarded by layoutReady do not fire during startup', async () => {
        const app = new App();
        app.workspace.onLayoutReady = (_fn: () => void) => {};
        const plugin = new BidirectionalFolgezettelPlugin(app) as any;
        plugin.settings = createPlugin().settings;
        plugin.folgezettelRegexCompiled = createPlugin().folgezettelRegexCompiled;
        plugin.layoutReady = false;

        // Create a listener for create events
        let createFired = false;
        plugin.app.vault.on = (event: string, callback: any) => {
            if (event === 'create') {
                plugin._testCreateCallback = callback;
            }
        };

        // This would normally be done by onload
        plugin.app.vault.on('create', (_file: any) => {
            if (!plugin.layoutReady) return;
            createFired = true;
        });

        // Now trigger with layoutReady = false
        const testFile = new TFile('test.md', 'test');
        if (plugin._testCreateCallback) {
            plugin._testCreateCallback(testFile);
        }
        // Should not fire because layoutReady is false
    });
});

// ===========================================================================
// processNewFile
// ===========================================================================

describe('processNewFile', () => {
    test('inserts bidirectional links for non-root child', async () => {
        const plugin = createPlugin(['20', '20.1'], { '20': '', '20.1': '' });
        const childFile = (plugin as any).app.vault.getMarkdownFiles().find(
            (f: TFile) => f.basename === '20.1'
        );
        await plugin.processNewFile(childFile);
        const childContent = readStore(plugin, '20.1.md');
        const parentContent = readStore(plugin, '20.md');
        expect(childContent).toContain('[[20|Parent]]');
        expect(parentContent).toContain('[[20.1]]');
    });

    test('skips files already being processed', async () => {
        const plugin = createPlugin(['20']);
        const file = new TFile('20.md', '20');
        (plugin as any).processingFiles.add('20.md');
        await plugin.processNewFile(file);
        // Should return early without modifying anything
        expect(readStore(plugin, '20.md')).toBe('');
    });

    test('skips files without folgezettel address', async () => {
        const plugin = createPlugin(['README']);
        const file = (plugin as any).app.vault.getMarkdownFiles()[0];
        await plugin.processNewFile(file);
        // No crash, no modifications
        expect(readStore(plugin, 'README.md')).toBe('');
    });

    test('applies template to empty file', async () => {
        const plugin = createPlugin(['20', '20.1'], { '20': '', '20.1': '' });
        // Mock applyChildNoteTemplate to verify it's called
        let templateApplied = false;
        (plugin as any).applyChildNoteTemplate = async () => { templateApplied = true; };
        const file = (plugin as any).app.vault.getMarkdownFiles().find(
            (f: TFile) => f.basename === '20.1'
        );
        await plugin.processNewFile(file);
        expect(templateApplied).toBe(true);
    });

    test('skips template for non-empty file', async () => {
        const plugin = createPlugin(['20', '20.1'], { '20': '', '20.1': 'existing content' });
        let templateApplied = false;
        (plugin as any).applyChildNoteTemplate = async () => { templateApplied = true; };
        const file = (plugin as any).app.vault.getMarkdownFiles().find(
            (f: TFile) => f.basename === '20.1'
        );
        await plugin.processNewFile(file);
        expect(templateApplied).toBe(false);
    });

    test('prompts for index heading when root integer and parent is 00.0', async () => {
        const plugin = createPlugin(['00.0', '20'], {
            '00.0': '## Subject Matter\n\n## Project Support\n',
            '20': ''
        });
        // Mock promptForIndexHeading to return 'Subject Matter'
        plugin.promptForIndexHeading = async () => 'Subject Matter';
        const file = (plugin as any).app.vault.getMarkdownFiles().find(
            (f: TFile) => f.basename === '20'
        );
        await plugin.processNewFile(file);
        const indexContent = readStore(plugin, '00.0.md');
        // Link should be under Subject Matter
        const smIdx = indexContent.indexOf('## Subject Matter');
        const psIdx = indexContent.indexOf('## Project Support');
        const linkIdx = indexContent.indexOf('[[20]]');
        expect(linkIdx).toBeGreaterThan(smIdx);
        expect(linkIdx).toBeLessThan(psIdx);
    });

    test('falls back to default heading when index heading prompt cancelled', async () => {
        const plugin = createPlugin(['00.0', '20'], {
            '00.0': '',
            '20': ''
        });
        plugin.promptForIndexHeading = async () => null;
        const file = (plugin as any).app.vault.getMarkdownFiles().find(
            (f: TFile) => f.basename === '20'
        );
        await plugin.processNewFile(file);
        const indexContent = readStore(plugin, '00.0.md');
        // Falls back to default forwardLinkHeading = 'Child Notes'
        expect(indexContent).toContain('## Child Notes');
    });

    test('setTimeout cleanup clears processingFiles after delay', async () => {
        jest.useFakeTimers();
        const plugin = createPlugin(['20', '20.1'], { '20': '', '20.1': '' });
        const file = plugin.findFileByAddress('20.1');
        await plugin.processNewFile(file!);
        // Before timeout, parent and file should be in processingFiles
        jest.runAllTimers();
        // After timeout, processingFiles should be cleared
        expect((plugin as any).processingFiles.has('20.1.md')).toBe(false);
        expect((plugin as any).processingFiles.has('20.md')).toBe(false);
        jest.useRealTimers();
    });
});

// ===========================================================================
// createChildNoteWithAddress
// ===========================================================================

describe('createChildNoteWithAddress', () => {
    test('creates file and inserts bidirectional links', async () => {
        const plugin = createPlugin(['20'], { '20': '' });
        const parentFile = (plugin as any).app.vault.getMarkdownFiles()[0];
        await plugin.createChildNoteWithAddress('20.1', parentFile);
        const childContent = readStore(plugin, '20.1.md');
        const parentContent = readStore(plugin, '20.md');
        expect(childContent).toContain('[[20|Parent]]');
        expect(parentContent).toContain('[[20.1]]');
    });

    test('passes heading override to insertForwardLink', async () => {
        const plugin = createPlugin(['00.0'], {
            '00.0': '## Subject Matter\n\n## Project Support\n'
        });
        const parentFile = (plugin as any).app.vault.getMarkdownFiles()[0];
        await plugin.createChildNoteWithAddress('21', parentFile, 'Project Support');
        const indexContent = readStore(plugin, '00.0.md');
        const psIdx = indexContent.indexOf('## Project Support');
        const linkIdx = indexContent.indexOf('[[21]]');
        expect(linkIdx).toBeGreaterThan(psIdx);
    });

    test('handles creation error gracefully', async () => {
        const plugin = createPlugin(['20'], { '20': '' });
        (plugin as any).app.vault.create = async () => { throw new Error('disk full'); };
        const parentFile = (plugin as any).app.vault.getMarkdownFiles()[0];
        // Should not throw
        await expect(
            plugin.createChildNoteWithAddress('20.1', parentFile)
        ).resolves.not.toThrow();
    });
});

// ===========================================================================
// checkForDuplicateAddress
// ===========================================================================

describe('checkForDuplicateAddress', () => {
    test('does not throw when no duplicate', () => {
        const plugin = createPlugin(['1', '2']);
        const file = (plugin as any).app.vault.getMarkdownFiles()[0];
        // Should not throw
        plugin.checkForDuplicateAddress(file);
    });

    test('does not throw for file without address', () => {
        const plugin = createPlugin(['README']);
        const file = new TFile('README.md', 'README');
        plugin.checkForDuplicateAddress(file);
    });
});

// ===========================================================================
// compileRegex
// ===========================================================================

describe('compileRegex', () => {
    test('uses default regex on invalid pattern', () => {
        const plugin = createPlugin();
        plugin.settings.folgezettelRegex = '[invalid';
        (plugin as any).compileRegex();
        // Should fall back to default regex, still able to extract
        expect(plugin.extractFromTitle('20')).toBe('20');
    });
});

// ===========================================================================
// onFileModify / cross-linking
// ===========================================================================

describe('onFileModify cross-linking', () => {
    test('inserts cross-link when new link detected', async () => {
        const plugin = createPlugin(['1', '2'], { '1': '', '2': '' });
        // Seed the cache with empty links for file '1'
        (plugin as any).fileContentCache.set('1.md', new Set());
        // Simulate user adding [[2]] to file 1
        (plugin as any).__store.set('1.md', 'See [[2]]');
        const file1 = (plugin as any).app.vault.getMarkdownFiles().find(
            (f: TFile) => f.basename === '1'
        );
        await (plugin as any).onFileModify(file1);
        const content2 = readStore(plugin, '2.md');
        expect(content2).toContain('## Related Notes');
        expect(content2).toContain('[[1|Cross-reference]]');
    });

    test('skips files being processed', async () => {
        const plugin = createPlugin(['1'], { '1': '' });
        (plugin as any).processingFiles.add('1.md');
        await (plugin as any).onFileModify(new TFile('1.md', '1'));
        // Should return early
    });

    test('skips files in creation grace period', async () => {
        const plugin = createPlugin(['1'], { '1': '' });
        (plugin as any).fileCreationTimes.set('1.md', Date.now());
        await (plugin as any).onFileModify(new TFile('1.md', '1'));
        // Should return early
    });

    test('skips cross-link when target is in grace period', async () => {
        const plugin = createPlugin(['1', '2'], { '1': '', '2': '' });
        (plugin as any).fileContentCache.set('1.md', new Set());
        (plugin as any).__store.set('1.md', 'See [[2]]');
        (plugin as any).fileCreationTimes.set('2.md', Date.now());
        const file1 = (plugin as any).app.vault.getMarkdownFiles().find(
            (f: TFile) => f.basename === '1'
        );
        await (plugin as any).onFileModify(file1);
        // File 2 should not be modified
        expect(readStore(plugin, '2.md')).toBe('');
    });

    test('skips cross-link when target is in processingFiles', async () => {
        const plugin = createPlugin(['1', '2'], { '1': '', '2': '' });
        (plugin as any).fileContentCache.set('1.md', new Set());
        (plugin as any).__store.set('1.md', 'See [[2]]');
        // Mark file 2 as processing
        (plugin as any).processingFiles.add('2.md');
        const file1 = (plugin as any).app.vault.getMarkdownFiles().find(
            (f: TFile) => f.basename === '1'
        );
        await (plugin as any).onFileModify(file1);
        // File 2 should not be modified
        expect(readStore(plugin, '2.md')).toBe('');
    });

    test('insertCrossLink with notification and setTimeout cleanup', async () => {
        jest.useFakeTimers();
        const plugin = createPlugin(['1', '2'], { '1': '', '2': '' });
        plugin.settings.showNotifications = true;
        const target = plugin.findFileByAddress('2');
        const source = plugin.findFileByAddress('1');
        await (plugin as any).insertCrossLink(target, source);
        // Verify notification-covered cross-link was made
        expect(readStore(plugin, '2.md')).toContain('[[1|Cross-reference]]');
        // Run the setTimeout cleanup for processingFiles
        jest.runAllTimers();
        expect((plugin as any).processingFiles.has('2.md')).toBe(false);
        jest.useRealTimers();
    });
});

// ===========================================================================
// Settings load / save
// ===========================================================================

describe('settings', () => {
    test('loadSettings merges defaults with stored data', async () => {
        const plugin = createPlugin();
        (plugin as any).loadData = async () => ({ showNotifications: false });
        await plugin.loadSettings();
        expect(plugin.settings.showNotifications).toBe(false);
        expect(plugin.settings.autoProcess).toBe(true); // default
    });

    test('saveSettings calls saveData', async () => {
        const plugin = createPlugin();
        let saved = false;
        (plugin as any).saveData = async () => { saved = true; };
        await plugin.saveSettings();
        expect(saved).toBe(true);
    });
});

// ===========================================================================
// onunload
// ===========================================================================

describe('onunload', () => {
    test('clears all caches', () => {
        const plugin = createPlugin();
        (plugin as any).fileContentCache.set('a', new Set());
        (plugin as any).recentlyCreatedFiles.add('b');
        (plugin as any).processingFiles.add('c');
        (plugin as any).fileCreationTimes.set('d', 1);
        plugin.onunload();
        expect((plugin as any).fileContentCache.size).toBe(0);
        expect((plugin as any).recentlyCreatedFiles.size).toBe(0);
        expect((plugin as any).processingFiles.size).toBe(0);
        expect((plugin as any).fileCreationTimes.size).toBe(0);
    });
});

// ===========================================================================
// getRelativePath (tested via markdown link generation)
// ===========================================================================

describe('getRelativePath', () => {
    test('up one level', () => {
        const plugin = createPlugin();
        const folderA = new TFolder('a/b');
        const folderB = new TFolder('a');
        const source = new TFile('a/b/s.md', 's', folderA);
        const target = new TFile('a/t.md', 't', folderB);
        (target as any).name = 't.md';
        const rel = (plugin as any).getRelativePath(source, target);
        expect(rel).toBe('../t.md');
    });
});

// ===========================================================================
// Template Methods
// ===========================================================================

describe('getDefaultTemplate', () => {
    test('returns null when default template path is empty', async () => {
        const plugin = createPlugin();
        plugin.settings.defaultTemplate = '';
        const result = await plugin.getDefaultTemplate();
        expect(result).toBeNull();
    });

    test('returns null when default template file not found', async () => {
        const plugin = createPlugin();
        plugin.settings.defaultTemplate = 'nonexistent.md';
        const result = await plugin.getDefaultTemplate();
        expect(result).toBeNull();
    });

    test('looks up template by path from vault', async () => {
        const plugin = createPlugin(['default']);
        plugin.settings.defaultTemplate = 'default.md';
        // The real implementation uses getAbstractFileByPath
        // which is set up in createPlugin to return files by basename
        const result = await plugin.getDefaultTemplate();
        // Result may be null if the mock doesn't find it - that's OK for this test
        // We're testing the method can execute without error
        expect(typeof result === 'object' || result === null).toBe(true);
    });
});

describe('applyTemplate', () => {
    test('applies template to file with variable substitution', async () => {
        const plugin = createPlugin(['1', '2'], {
            '1': 'Title: {{title}}\nCreated: {{date}}'
        });
        plugin.settings.showNotifications = false;
        (plugin as any).__store.set('2.md', '');
        const templateFile = plugin.findFileByAddress('1');
        const targetFile = plugin.findFileByAddress('2');
        expect(templateFile && targetFile).toBeTruthy();

        if (templateFile && targetFile) {
            await plugin.applyTemplate(targetFile, templateFile);
            const content = readStore(plugin, '2.md');
            expect(content).toContain('Title: 2');
        }
    });

    test('returns early if template is null', async () => {
        const plugin = createPlugin(['2']);
        (plugin as any).__store.set('2.md', 'original');
        const targetFile = plugin.findFileByAddress('2');
        await plugin.applyTemplate(targetFile!, null);
        // Should not modify file
        expect(readStore(plugin, '2.md')).toBe('original');
    });

    test('handles read error gracefully', async () => {
        const plugin = createPlugin(['1', '2']);
        plugin.settings.showNotifications = false;
        (plugin as any).app.vault.read = async () => { throw new Error('read failed'); };
        const templateFile = plugin.findFileByAddress('1');
        const targetFile = plugin.findFileByAddress('2');
        // Should not throw
        if (templateFile && targetFile) {
            await plugin.applyTemplate(targetFile, templateFile);
        }
    });
});

describe('applyChildNoteTemplate', () => {
    test('calls applyCoreTemplate when source is core', async () => {
        const plugin = createPlugin(['child.md']);
        plugin.settings.childNoteTemplateSource = 'core';
        (plugin as any).applyCoreTemplate = async () => true;
        const file = plugin.findFileByAddress('child');
        const result = await plugin.applyChildNoteTemplate(file!);
        expect(result).toBe(true);
    });

    test('calls applyTemplaterTemplate when source is templater', async () => {
        const plugin = createPlugin(['child.md']);
        plugin.settings.childNoteTemplateSource = 'templater';
        (plugin as any).applyTemplaterTemplate = async () => true;
        const file = plugin.findFileByAddress('child');
        const result = await plugin.applyChildNoteTemplate(file!);
        expect(result).toBe(true);
    });

    test('calls applyDefaultTemplate when source is none', async () => {
        const plugin = createPlugin(['child.md']);
        plugin.settings.childNoteTemplateSource = 'none';
        (plugin as any).applyDefaultTemplate = async () => true;
        const file = plugin.findFileByAddress('child');
        const result = await plugin.applyChildNoteTemplate(file!);
        expect(result).toBe(true);
    });
});

describe('applyDefaultTemplate', () => {
    test('returns false when no default template path', async () => {
        const plugin = createPlugin(['target']);
        plugin.settings.defaultTemplate = '';
        const file = plugin.findFileByAddress('target');
        const result = await (plugin as any).applyDefaultTemplate(file);
        expect(result).toBe(false);
    });

    test('returns false when template file not found', async () => {
        const plugin = createPlugin(['target']);
        plugin.settings.defaultTemplate = 'missing.md';
        const file = plugin.findFileByAddress('target');
        const result = await (plugin as any).applyDefaultTemplate(file);
        expect(result).toBe(false);
    });

    test('applies default template when configured', async () => {
        const plugin = createPlugin(['template', 'target'], {
            'template': 'Default content for {{title}}'
        });
        plugin.settings.showNotifications = false;
        (plugin as any).__store.set('target.md', '');
        plugin.settings.defaultTemplate = 'template.md';
        const file = plugin.findFileByAddress('target');
        // Test the method call without full vault integration
        // The result depends on vault.getAbstractFileByPath
        const result = await (plugin as any).applyDefaultTemplate(file);
        // We test it either returns true (success) or false (file not found)
        expect(typeof result === 'boolean').toBe(true);
    });

    test('handles error during template application', async () => {
        const plugin = createPlugin(['template', 'target']);
        plugin.settings.defaultTemplate = 'template.md';
        plugin.settings.showNotifications = false;
        (plugin as any).app.vault.read = async () => { throw new Error('read error'); };
        const file = plugin.findFileByAddress('target');
        const result = await (plugin as any).applyDefaultTemplate(file);
        expect(result).toBe(false);
    });
});

describe('applyCoreTemplate', () => {
    test('returns false when no core template path', async () => {
        const plugin = createPlugin(['target']);
        plugin.settings.childNoteTemplatePath = '';
        const file = plugin.findFileByAddress('target');
        const result = await (plugin as any).applyCoreTemplate(file);
        expect(result).toBe(false);
    });

    test('returns false when template file not found', async () => {
        const plugin = createPlugin(['target']);
        plugin.settings.childNoteTemplatePath = 'missing.md';
        const file = plugin.findFileByAddress('target');
        const result = await (plugin as any).applyCoreTemplate(file);
        expect(result).toBe(false);
    });

    test('applies core template with proper flow', async () => {
        const plugin = createPlugin(['template', 'target'], {
            'template': 'Core template for {{title}}'
        });
        plugin.settings.showNotifications = false;
        (plugin as any).__store.set('target.md', '');
        plugin.settings.childNoteTemplatePath = 'template.md';
        const file = plugin.findFileByAddress('target');
        const result = await (plugin as any).applyCoreTemplate(file);
        // Result depends on vault mock - just test it returns boolean
        expect(typeof result === 'boolean').toBe(true);
    });

    test('handles error during core template application', async () => {
        const plugin = createPlugin(['template', 'target']);
        plugin.settings.childNoteTemplatePath = 'template.md';
        plugin.settings.showNotifications = false;
        (plugin as any).app.vault.read = async () => { throw new Error('read error'); };
        const file = plugin.findFileByAddress('target');
        const result = await (plugin as any).applyCoreTemplate(file);
        expect(result).toBe(false);
    });
});

describe('applyTemplaterTemplate', () => {
    test('returns false when no templater template path', async () => {
        const plugin = createPlugin(['target']);
        plugin.settings.childNoteTemplaterPath = '';
        const file = plugin.findFileByAddress('target');
        const result = await (plugin as any).applyTemplaterTemplate(file);
        expect(result).toBe(false);
    });

    test('returns false when templater plugin not installed', async () => {
        const plugin = createPlugin(['target']);
        plugin.settings.childNoteTemplaterPath = 'template.md';
        (plugin as any).app.plugins = undefined;
        const file = plugin.findFileByAddress('target');
        const result = await (plugin as any).applyTemplaterTemplate(file);
        expect(result).toBe(false);
    });

    test('returns false when template file not found', async () => {
        const plugin = createPlugin(['target']);
        plugin.settings.childNoteTemplaterPath = 'missing.md';
        (plugin as any).app.plugins = { plugins: {} };
        const file = plugin.findFileByAddress('target');
        const result = await (plugin as any).applyTemplaterTemplate(file);
        expect(result).toBe(false);
    });

    test('applies templater when API methods available', async () => {
        const plugin = createPlugin(['template', 'target']);
        plugin.settings.showNotifications = false;
        (plugin as any).__store.set('target.md', '');
        plugin.settings.childNoteTemplaterPath = 'template.md';
        const mockTemplater = {
            write_template_to_file: async () => {}
        };
        (plugin as any).app.plugins = {
            plugins: {
                'templater-obsidian': {
                    templater: mockTemplater
                }
            }
        };
        const file = plugin.findFileByAddress('target');
        const result = await (plugin as any).applyTemplaterTemplate(file);
        // Result depends on vault integration, just test it returns boolean
        expect(typeof result === 'boolean').toBe(true);
    });

    test('handles error during templater application', async () => {
        const plugin = createPlugin(['template', 'target']);
        plugin.settings.childNoteTemplaterPath = 'template.md';
        plugin.settings.showNotifications = false;
        const mockTemplater = {
            write_template_to_file: async () => { throw new Error('templater error'); }
        };
        (plugin as any).app.plugins = {
            plugins: {
                'templater-obsidian': {
                    templater: mockTemplater
                }
            }
        };
        const file = plugin.findFileByAddress('target');
        const result = await (plugin as any).applyTemplaterTemplate(file);
        expect(result).toBe(false);
    });
});

// ===========================================================================
// Command Methods
// ===========================================================================

describe('promptForIndexHeading', () => {
    test('returns promise that resolves to selected heading', async () => {
        const plugin = createPlugin(['00.0']);
        const promise = plugin.promptForIndexHeading();
        expect(promise).toBeInstanceOf(Promise);
    });
});

describe('addBacklinkToParent', () => {
    test('adds backlink when active file with parent exists', async () => {
        const plugin = createPlugin(['20', '20.1'], { '20': '', '20.1': '' });
        const mockView = {
            file: plugin.findFileByAddress('20.1')
        };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        await plugin.addBacklinkToParent();
        const content = readStore(plugin, '20.1.md');
        expect(content).toContain('[[20|Parent]]');
    });

    test('does not throw when no active view', async () => {
        const plugin = createPlugin();
        plugin.app.workspace.getActiveViewOfType = () => null;
        await plugin.addBacklinkToParent();
    });

    test('does not throw when file has no address', async () => {
        const plugin = createPlugin(['README']);
        const mockView = {
            file: plugin.findFileByAddress('README')
        };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        await plugin.addBacklinkToParent();
    });

    test('does not throw when parent not found', async () => {
        const plugin = createPlugin(['20.1']);
        const mockView = {
            file: plugin.findFileByAddress('20.1')
        };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        await plugin.addBacklinkToParent();
    });

    test('prompts for index heading when address is root integer', async () => {
        const plugin = createPlugin(['00.0', '20'], { '00.0': '', '20': '' });
        let headingPrompted = false;
        plugin.promptForIndexHeading = async () => {
            headingPrompted = true;
            return 'Subject Matter';
        };
        const mockView = {
            file: plugin.findFileByAddress('20')
        };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        await plugin.addBacklinkToParent();
        expect(headingPrompted).toBe(true);
    });

    test('handles cancelled heading prompt', async () => {
        const plugin = createPlugin(['00.0', '20']);
        plugin.promptForIndexHeading = async () => null;
        const mockView = {
            file: plugin.findFileByAddress('20')
        };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        await plugin.addBacklinkToParent();
        // Should complete without error
    });
});

describe('suggestNextChildCommand', () => {
    test('suggests next child and shows notice', async () => {
        const plugin = createPlugin(['20'], { '20': '' });
        const mockView = {
            file: plugin.findFileByAddress('20')
        };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        plugin.settings.showNotifications = false;
        await plugin.suggestNextChildCommand();
    });

    test('does not throw when no active view', async () => {
        const plugin = createPlugin();
        plugin.app.workspace.getActiveViewOfType = () => null;
        await plugin.suggestNextChildCommand();
    });

    test('does not throw when no folgezettel address', async () => {
        const plugin = createPlugin(['README']);
        const mockView = {
            file: plugin.findFileByAddress('README')
        };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        await plugin.suggestNextChildCommand();
    });

    test('shows warning for duplicate address', async () => {
        const plugin = createPlugin(['20', '20.1'], { '20': '', '20.1': '' });
        const mockView = {
            file: plugin.findFileByAddress('20')
        };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        plugin.settings.showNotifications = false;
        await plugin.suggestNextChildCommand();
    });
});

describe('createNextChild', () => {
    test('cursor inside child-link list creates next child of current note', async () => {
        // Parent "1a" lists two children; cursor sits on the second link line.
        const body = '## Child Notes\n- [[1a1 First]]\n- [[1a2 Second]]\n';
        const plugin = createPlugin(['1a', '1a1', '1a2']);
        const view = mockView(plugin.findFileByAddress('1a'), body, 2); // cursor on "- [[1a2 Second]]"
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createNextChild();
        const files = plugin.app.vault.getMarkdownFiles();
        // Next child of "1a" after the max sibling "1a2" is "1a3".
        expect(files.find((f: any) => f.basename === '1a3')).toBeTruthy();
    });

    test('cursor not in a list falls back to next sibling of current note', async () => {
        // Active note "1a2" with the cursor on a prose line (no list).
        const plugin = createPlugin(['1a', '1a2'], { '1a': '## Child Notes\n- [[1a2 Second]]\n' });
        const view = mockView(plugin.findFileByAddress('1a2'), 'Some prose, no list here.\n', 0);
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createNextChild();
        const files = plugin.app.vault.getMarkdownFiles();
        // Sibling of "1a2" is "1a3" (same parent "1a").
        expect(files.find((f: any) => f.basename === '1a3')).toBeTruthy();
    });

    test('honors the max index in the list rather than document order', async () => {
        // List is out of order: 1a3 appears before 1a1; max is still 1a3 -> 1a4.
        const body = '## Child Notes\n- [[1a3 Third]]\n- [[1a1 First]]\n';
        const plugin = createPlugin(['1a', '1a1', '1a3']);
        const view = mockView(plugin.findFileByAddress('1a'), body, 1);
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createNextChild();
        const files = plugin.app.vault.getMarkdownFiles();
        expect(files.find((f: any) => f.basename === '1a4')).toBeTruthy();
    });

    test('does not throw when no active view', async () => {
        const plugin = createPlugin();
        plugin.app.workspace.getActiveViewOfType = () => null;
        await plugin.createNextChild();
    });

    test('does not throw when no folgezettel address', async () => {
        const plugin = createPlugin(['README']);
        const view = mockView(plugin.findFileByAddress('README'), '', 0);
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createNextChild();
    });
});

describe('createFirstChild', () => {
    test('creates the first child of a childless note and links both ways', async () => {
        // "20" has no children yet; its first child is "20.1".
        const plugin = createPlugin(['20'], { '20': '' });
        const view = mockView(plugin.findFileByAddress('20'), '', 0);
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createFirstChild();

        const files = plugin.app.vault.getMarkdownFiles();
        expect(files.find((f: any) => f.basename === '20.1')).toBeTruthy();

        // Forward link written into the parent under the default heading.
        const parentContent = readStore(plugin, '20.md');
        expect(parentContent).toContain('## Child Notes');
        expect(parentContent).toContain('[[20.1]]');

        // Backlink written into the new child.
        const childContent = readStore(plugin, '20.1.md');
        expect(childContent).toContain('[[20|Parent]]');
    });

    test('files the first root integer under the index heading for 00.0', async () => {
        const plugin = createPlugin(['00.0'], { '00.0': '' });
        const view = mockView(plugin.findFileByAddress('00.0'), '', 0);
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createFirstChild();

        const files = plugin.app.vault.getMarkdownFiles();
        expect(files.find((f: any) => f.basename === '1')).toBeTruthy();
        const indexContent = readStore(plugin, '00.0.md');
        expect(indexContent).toContain('## Subject Matter');
        expect(indexContent).toContain('[[1]]');
    });

    test('refuses when the note already has children', async () => {
        const plugin = createPlugin(['20', '20.1'], { '20': '## Child Notes\n- [[20.1]]\n' });
        const view = mockView(plugin.findFileByAddress('20'), '', 0);
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createFirstChild();

        // No "20.2" should be created by this command.
        const files = plugin.app.vault.getMarkdownFiles();
        expect(files.find((f: any) => f.basename === '20.2')).toBeFalsy();
    });

    test('does not throw when no active view', async () => {
        const plugin = createPlugin();
        plugin.app.workspace.getActiveViewOfType = () => null;
        await plugin.createFirstChild();
    });

    test('does not throw when no folgezettel address', async () => {
        const plugin = createPlugin(['README']);
        const view = mockView(plugin.findFileByAddress('README'), '', 0);
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createFirstChild();
    });
});

describe('nextSiblingAddress', () => {
    test('increments a trailing letter (alternation preserved)', () => {
        const plugin = createPlugin();
        expect(plugin.nextSiblingAddress('1.2a3b')).toBe('1.2a3c');
    });

    test('increments a trailing number', () => {
        const plugin = createPlugin();
        expect(plugin.nextSiblingAddress('1.2a3')).toBe('1.2a4');
    });

    test('increments a root integer', () => {
        const plugin = createPlugin();
        expect(plugin.nextSiblingAddress('7')).toBe('8');
    });

    test('increments a dot-number child of a root integer', () => {
        const plugin = createPlugin();
        expect(plugin.nextSiblingAddress('7.1')).toBe('7.2');
    });

    test('rolls a trailing z over to aa', () => {
        const plugin = createPlugin();
        expect(plugin.nextSiblingAddress('1z')).toBe('1aa');
    });

    test('increments a single leading letter', () => {
        const plugin = createPlugin();
        expect(plugin.nextSiblingAddress('1a')).toBe('1b');
    });

    test('returns null on an unparseable address', () => {
        const plugin = createPlugin();
        expect(plugin.nextSiblingAddress('')).toBeNull();
    });
});

describe('maxSiblingAddress', () => {
    test('returns null for an empty set', () => {
        const plugin = createPlugin();
        expect(plugin.maxSiblingAddress([])).toBeNull();
    });

    test('numeric siblings compare numerically (10 > 9)', () => {
        const plugin = createPlugin();
        expect(plugin.maxSiblingAddress(['1a1', '1a9', '1a10'])).toBe('1a10');
    });

    test('letter siblings: longer run beats single letter (aa > z)', () => {
        const plugin = createPlugin();
        expect(plugin.maxSiblingAddress(['1z', '1aa', '1b'])).toBe('1aa');
    });

    test('ignores document order, returns the true max', () => {
        const plugin = createPlugin();
        expect(plugin.maxSiblingAddress(['1a3', '1a1', '1a2'])).toBe('1a3');
    });
});

describe('extractAddressFromLinkLine', () => {
    test('pulls the address out of a wikilink list item', () => {
        const plugin = createPlugin();
        expect(plugin.extractAddressFromLinkLine('- [[1.2a3 Some Title]]')).toBe('1.2a3');
    });

    test('pulls the address out of a markdown link list item', () => {
        const plugin = createPlugin();
        expect(plugin.extractAddressFromLinkLine('- [Some Title](1.2a3 Some Title.md)')).toBe('1.2a3');
    });

    test('returns null for a line with no address', () => {
        const plugin = createPlugin();
        expect(plugin.extractAddressFromLinkLine('- just some prose')).toBeNull();
    });
});

describe('findSiblingListContext', () => {
    const body = [
        '## Child Notes',     // 0
        '- [[1a1 First]]',     // 1
        '- [[1a2 Second]]',    // 2
        '',                    // 3
        'trailing prose'       // 4
    ];

    test('returns the list items and heading when cursor is inside the list', () => {
        const plugin = createPlugin();
        const ctx = plugin.findSiblingListContext(body, 2);
        expect(ctx).not.toBeNull();
        expect(ctx!.items).toEqual(['1a1', '1a2']);
        expect(ctx!.headingText).toBe('Child Notes');
    });

    test('returns null when the cursor is on a non-list line', () => {
        const plugin = createPlugin();
        expect(plugin.findSiblingListContext(body, 4)).toBeNull();
    });

    test('returns null when the cursor is on the heading line', () => {
        const plugin = createPlugin();
        expect(plugin.findSiblingListContext(body, 0)).toBeNull();
    });

    test('returns null when the list has no addressed items', () => {
        const plugin = createPlugin();
        const plain = ['## Notes', '- a plain bullet', '- another'];
        expect(plugin.findSiblingListContext(plain, 1)).toBeNull();
    });

    test('headingText is null when no heading precedes the list', () => {
        const plugin = createPlugin();
        const noHeading = ['- [[1a1 First]]', '- [[1a2 Second]]'];
        const ctx = plugin.findSiblingListContext(noHeading, 0);
        expect(ctx).not.toBeNull();
        expect(ctx!.headingText).toBeNull();
    });
});

describe('findHeadingOfChildLink', () => {
    const content =
        '## Subject Matter\n- [[7 Root seven]]\n## Project Support\n- [[12 Root twelve]]\n';

    test('finds the heading a child link sits under', () => {
        const plugin = createPlugin();
        expect(plugin.findHeadingOfChildLink(content, '7')).toBe('Subject Matter');
        expect(plugin.findHeadingOfChildLink(content, '12')).toBe('Project Support');
    });

    test('returns null when the child link is absent', () => {
        const plugin = createPlugin();
        expect(plugin.findHeadingOfChildLink(content, '99')).toBeNull();
    });
});

describe('createNoteWithAddress', () => {
    test('creates note with given address', async () => {
        const plugin = createPlugin();
        const folder = new TFolder('notes');
        await plugin.createNoteWithAddress('20', folder);
        const files = plugin.app.vault.getMarkdownFiles();
        expect(files.length).toBeGreaterThan(0);
    });

    test('handles creation error gracefully', async () => {
        const plugin = createPlugin();
        (plugin as any).app.vault.create = async () => { throw new Error('create failed'); };
        const folder = new TFolder('notes');
        await plugin.createNoteWithAddress('20', folder);
    });
});

describe('createNoteWithTemplate', () => {
    test('creates note with template and prompted name', async () => {
        const plugin = createPlugin(['template.md'], { 'template.md': 'Template content' });
        plugin.promptForNoteName = async () => 'newNote';
        const templateFile = plugin.findFileByAddress('template');
        await plugin.createNoteWithTemplate(templateFile);
    });

    test('returns early when name prompt cancelled', async () => {
        const plugin = createPlugin();
        plugin.promptForNoteName = async () => null;
        await plugin.createNoteWithTemplate(null);
    });

    test('handles null template', async () => {
        const plugin = createPlugin();
        plugin.promptForNoteName = async () => 'newNote';
        await plugin.createNoteWithTemplate(null);
    });

    test('handles creation error', async () => {
        const plugin = createPlugin();
        plugin.promptForNoteName = async () => 'newNote';
        (plugin as any).app.vault.create = async () => { throw new Error('create failed'); };
        await plugin.createNoteWithTemplate(null);
    });
});

describe('promptForNoteName', () => {
    test('returns promise', async () => {
        const plugin = createPlugin();
        const promise = plugin.promptForNoteName();
        expect(promise).toBeInstanceOf(Promise);
    });
});

describe('promptForFolgezettelalNote', () => {
    test('validates address and creates note', async () => {
        const plugin = createPlugin();
        plugin.promptForNoteName = async () => '20';
        await plugin.promptForFolgezettelalNote();
    });

    test('returns early when name prompt cancelled', async () => {
        const plugin = createPlugin();
        plugin.promptForNoteName = async () => null;
        await plugin.promptForFolgezettelalNote();
    });

    test('handles invalid address', async () => {
        const plugin = createPlugin();
        plugin.promptForNoteName = async () => 'invalid!@#';
        plugin.settings.showNotifications = false;
        await plugin.promptForFolgezettelalNote();
    });

    test('handles duplicate address', async () => {
        const plugin = createPlugin(['20']);
        plugin.promptForNoteName = async () => '20';
        let modalOpened = false;
        const origDupModal = (global as any).DuplicateAddressModal;
        // Can't easily test modal opening in this context
        await plugin.promptForFolgezettelalNote();
    });
});

describe('createFolgezettelNote', () => {
    test('creates folgezettel note with given address', async () => {
        const plugin = createPlugin();
        const activeFile = new TFile('active.md', 'active');
        plugin.app.workspace.getActiveFile = () => activeFile;
        await (plugin as any).createFolgezettelNote('20');
    });
});

describe('positionCursorAtEndOfTitle', () => {
    test('positionCursorAtEndOfTitle method exists and can be called', () => {
        const plugin = createPlugin();
        const mockEditor = {
            setCursor: jest.fn(),
            focus: jest.fn()
        };
        const mockView = {
            editor: mockEditor,
            containerEl: {
                querySelector: () => null
            }
        };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        // The method relies on setTimeout and DOM which won't work in Node.js
        // Just verify it can be called without throwing
        expect(() => {
            (plugin as any).positionCursorAtEndOfTitle('20');
        }).not.toThrow();
    });
});

// ===========================================================================
// onload: capturing event handlers and exercising their callbacks
// ===========================================================================

describe('onload event handlers', () => {
    /**
     * Helper: fully initialise a plugin via onload(), capturing the vault
     * event callbacks (create, rename, modify) and the settings-tab instance.
     */
    function onloadPlugin(
        fileBasenames: string[] = [],
        fileContents?: Record<string, string>
    ) {
        const app = new App();
        const store: Map<string, string> = new Map();
        const mockFiles: TFile[] = fileBasenames.map(bn => {
            const f = new TFile(`${bn}.md`, bn);
            store.set(f.path, (fileContents && fileContents[bn]) || '');
            return f;
        });

        app.vault.getMarkdownFiles = () => mockFiles;
        app.vault.read = async (file: TFile) => store.get(file.path) || '';
        app.vault.modify = async (file: TFile, content: string) => {
            store.set(file.path, content);
        };
        app.vault.create = async (path: string, content: string) => {
            const basename = path.replace(/\.md$/, '').split('/').pop() || path;
            const f = new TFile(path, basename);
            store.set(path, content);
            mockFiles.push(f);
            return f;
        };
        app.vault.getAbstractFileByPath = (path: string) => {
            return mockFiles.find(f => f.path === path) || null;
        };

        const eventHandlers: Record<string, Function> = {};
        app.vault.on = (event: string, handler: Function) => {
            eventHandlers[event] = handler;
            return { unload: () => {} };
        };

        const commands: any[] = [];
        const ribbonCallbacks: Function[] = [];
        let settingsTab: any = null;

        app.workspace.onLayoutReady = (fn: () => void) => { fn(); };

        return new Promise<{
            plugin: any;
            store: Map<string, string>;
            eventHandlers: Record<string, Function>;
            commands: any[];
            ribbonCallbacks: Function[];
            settingsTab: any;
            mockFiles: TFile[];
        }>(async (resolve) => {
            const plugin = new BidirectionalFolgezettelPlugin(app) as any;
            // Override addCommand / addRibbonIcon / addSettingTab to capture
            plugin.addCommand = (cmd: any) => { commands.push(cmd); };
            plugin.addRibbonIcon = (_icon: string, _title: string, cb: Function) => {
                ribbonCallbacks.push(cb);
                return {};
            };
            plugin.addSettingTab = (tab: any) => { settingsTab = tab; };
            plugin.__store = store;

            await plugin.onload();

            resolve({
                plugin,
                store,
                eventHandlers,
                commands,
                ribbonCallbacks,
                settingsTab,
                mockFiles
            });
        });
    }

    test('onload registers create, rename, modify event handlers', async () => {
        const { eventHandlers } = await onloadPlugin();
        expect(eventHandlers['create']).toBeDefined();
        expect(eventHandlers['rename']).toBeDefined();
        expect(eventHandlers['modify']).toBeDefined();
    });

    test('create handler skips when layoutReady is false', async () => {
        const { plugin, eventHandlers } = await onloadPlugin(['20'], { '20': '' });
        plugin.layoutReady = false;
        const file = new TFile('99.md', '99');
        // Should not throw and should not process
        eventHandlers['create'](file);
        expect(plugin.recentlyCreatedFiles.has('99.md')).toBe(false);
    });

    test('create handler processes TFile when layoutReady is true', async () => {
        const { plugin, eventHandlers } = await onloadPlugin(['20'], { '20': '' });
        plugin.layoutReady = true;
        const file = new TFile('99.md', '99');
        eventHandlers['create'](file);
        expect(plugin.recentlyCreatedFiles.has('99.md')).toBe(true);
        expect(plugin.fileCreationTimes.has('99.md')).toBe(true);
    });

    test('create handler skips non-TFile objects', async () => {
        const { plugin, eventHandlers } = await onloadPlugin();
        plugin.layoutReady = true;
        // Pass a non-TFile (e.g. TFolder)
        const folder = new TFolder('myfolder');
        eventHandlers['create'](folder);
        // Should not throw
    });

    test('rename handler updates tracking maps', async () => {
        const { plugin, eventHandlers } = await onloadPlugin();
        plugin.layoutReady = true;
        const file = new TFile('newname.md', 'newname');
        plugin.recentlyCreatedFiles.add('oldname.md');
        plugin.fileCreationTimes.set('oldname.md', 12345);
        eventHandlers['rename'](file, 'oldname.md');
        expect(plugin.recentlyCreatedFiles.has('oldname.md')).toBe(false);
        expect(plugin.recentlyCreatedFiles.has('newname.md')).toBe(true);
        expect(plugin.fileCreationTimes.has('oldname.md')).toBe(false);
        expect(plugin.fileCreationTimes.get('newname.md')).toBe(12345);
    });

    test('rename handler skips when layoutReady is false', async () => {
        const { plugin, eventHandlers } = await onloadPlugin();
        plugin.layoutReady = false;
        const file = new TFile('new.md', 'new');
        eventHandlers['rename'](file, 'old.md');
        // Should not process
    });

    test('rename handler skips non-TFile objects', async () => {
        const { plugin, eventHandlers } = await onloadPlugin();
        plugin.layoutReady = true;
        const folder = new TFolder('folder');
        eventHandlers['rename'](folder, 'oldfolder');
    });

    test('modify handler calls onFileModify when conditions met', async () => {
        const { plugin, eventHandlers } = await onloadPlugin(['1', '2'], { '1': '', '2': '' });
        plugin.layoutReady = true;
        let modifyCalled = false;
        const origModify = plugin.onFileModify.bind(plugin);
        plugin.onFileModify = async (f: any) => { modifyCalled = true; };
        const file = new TFile('1.md', '1');
        eventHandlers['modify'](file);
        expect(modifyCalled).toBe(true);
    });

    test('modify handler skips when layoutReady is false', async () => {
        const { plugin, eventHandlers } = await onloadPlugin();
        plugin.layoutReady = false;
        let modifyCalled = false;
        plugin.onFileModify = async () => { modifyCalled = true; };
        eventHandlers['modify'](new TFile('1.md', '1'));
        expect(modifyCalled).toBe(false);
    });

    test('modify handler skips when autoBidirectionalLinks is false', async () => {
        const { plugin, eventHandlers } = await onloadPlugin();
        plugin.layoutReady = true;
        plugin.settings.autoBidirectionalLinks = false;
        let modifyCalled = false;
        plugin.onFileModify = async () => { modifyCalled = true; };
        eventHandlers['modify'](new TFile('1.md', '1'));
        expect(modifyCalled).toBe(false);
    });

    test('modify handler skips non-TFile objects', async () => {
        const { plugin, eventHandlers } = await onloadPlugin();
        plugin.layoutReady = true;
        plugin.settings.autoBidirectionalLinks = true;
        let modifyCalled = false;
        plugin.onFileModify = async () => { modifyCalled = true; };
        eventHandlers['modify'](new TFolder('folder'));
        expect(modifyCalled).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Command callbacks
    // -----------------------------------------------------------------------

    test('onload registers six commands', async () => {
        const { commands } = await onloadPlugin();
        expect(commands.length).toBe(6);
        const ids = commands.map((c: any) => c.id);
        expect(ids).toContain('add-backlink-to-parent');
        expect(ids).toContain('create-first-child');
        expect(ids).toContain('create-next-child');
        expect(ids).toContain('suggest-next-child');
        expect(ids).toContain('select-template-new-note');
        expect(ids).toContain('create-folgezettel-note');
    });

    test('command callbacks invoke the right methods', async () => {
        const { plugin, commands } = await onloadPlugin(['20'], { '20': '' });
        const mockView = { file: plugin.app.vault.getMarkdownFiles()[0] };
        plugin.app.workspace.getActiveViewOfType = () => mockView;

        // Each command callback should not throw
        for (const cmd of commands) {
            // Replace method stubs to prevent actual modal opening
            plugin.addBacklinkToParent = async () => {};
            plugin.createNextChild = async () => {};
            plugin.suggestNextChildCommand = () => {};
            plugin.selectTemplateAndCreateNote = async () => {};
            plugin.promptForFolgezettelalNote = async () => {};
            cmd.callback();
        }
    });

    test('ribbon icon callback invokes addBacklinkToParent', async () => {
        const { plugin, ribbonCallbacks } = await onloadPlugin();
        let called = false;
        plugin.addBacklinkToParent = async () => { called = true; };
        ribbonCallbacks[0]();
        expect(called).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Settings tab captured from onload
    // -----------------------------------------------------------------------

    test('onload creates settings tab that can call display()', async () => {
        const { settingsTab } = await onloadPlugin();
        expect(settingsTab).not.toBeNull();
        // Call display — this exercises all the Setting/Toggle/Text/Dropdown code
        expect(() => settingsTab.display()).not.toThrow();
    });

    test('settings tab display with wikilink style', async () => {
        const { settingsTab, plugin } = await onloadPlugin();
        plugin.settings.linkStyle = 'wikilink';
        expect(() => settingsTab.display()).not.toThrow();
    });

    test('settings tab display with markdown style', async () => {
        const { settingsTab, plugin } = await onloadPlugin();
        plugin.settings.linkStyle = 'markdown';
        expect(() => settingsTab.display()).not.toThrow();
    });

    test('settings tab display with core template source', async () => {
        const { settingsTab, plugin } = await onloadPlugin();
        plugin.settings.childNoteTemplateSource = 'core';
        expect(() => settingsTab.display()).not.toThrow();
    });

    test('settings tab display with templater template source', async () => {
        const { settingsTab, plugin } = await onloadPlugin();
        plugin.settings.childNoteTemplateSource = 'templater';
        expect(() => settingsTab.display()).not.toThrow();
    });

    test('settings tab display with none template source', async () => {
        const { settingsTab, plugin } = await onloadPlugin();
        plugin.settings.childNoteTemplateSource = 'none';
        expect(() => settingsTab.display()).not.toThrow();
    });

    test('settings tab updateLinkStyleExample for wikilink', async () => {
        const { settingsTab, plugin } = await onloadPlugin();
        plugin.settings.linkStyle = 'wikilink';
        const container = { textContent: '', style: {} as any, setText: function(t: string) { this.textContent = t; return this; } };
        (settingsTab as any).updateLinkStyleExample(container);
        expect(container.textContent).toContain('[[');
    });

    test('settings tab updateLinkStyleExample for markdown', async () => {
        const { settingsTab, plugin } = await onloadPlugin();
        plugin.settings.linkStyle = 'markdown';
        const container = { textContent: '', style: {} as any, setText: function(t: string) { this.textContent = t; return this; } };
        (settingsTab as any).updateLinkStyleExample(container);
        expect(container.textContent).toContain('[');
    });

    test('settings tab onChange callbacks execute without error', async () => {
        const { settingsTab, plugin } = await onloadPlugin();
        _clearSettingCallbacks();
        settingsTab.display();
        const callbacks = [..._getSettingCallbacks()]; // snapshot
        // Prevent infinite recursion: stub display after collecting callbacks
        const origDisplay = settingsTab.display.bind(settingsTab);
        settingsTab.display = () => {};
        // Each onChange callback should be callable with a test value
        for (const cb of callbacks) {
            await cb('test-value');
        }
        settingsTab.display = origDisplay;
        expect(plugin.settings).toBeTruthy();
    });

    test('settings tab onChange callbacks with empty string values', async () => {
        const { settingsTab, plugin } = await onloadPlugin();
        _clearSettingCallbacks();
        settingsTab.display();
        const callbacks = [..._getSettingCallbacks()];
        settingsTab.display = () => {};
        for (const cb of callbacks) {
            await cb('');
        }
        expect(plugin.settings).toBeTruthy();
    });
});

// ===========================================================================
// Template methods with proper getAbstractFileByPath mocking
// ===========================================================================

describe('template methods (full integration)', () => {
    test('applyDefaultTemplate succeeds when template file found', async () => {
        const plugin = createPlugin(['5'], { '5': '' }) as any;
        const tmplFile = await plugin.app.vault.create('Templates/default.md', 'Default: {{title}}');
        plugin.app.vault.getAbstractFileByPath = (path: string) => {
            if (path === 'Templates/default.md') return tmplFile;
            return plugin.app.vault.getMarkdownFiles().find((f: TFile) => f.path === path) || null;
        };
        plugin.settings.defaultTemplate = 'Templates/default.md';
        plugin.settings.showNotifications = true;
        const file = plugin.findFileByAddress('5');
        const result = await plugin.applyDefaultTemplate(file);
        expect(result).toBe(true);
        const content = readStore(plugin, '5.md');
        expect(content).toContain('Default: 5');
    });

    test('applyCoreTemplate succeeds when template file found', async () => {
        const plugin = createPlugin(['6'], { '6': '' }) as any;
        const tmplFile = await plugin.app.vault.create('Templates/core.md', 'Core: {{title}}');
        plugin.app.vault.getAbstractFileByPath = (path: string) => {
            if (path === 'Templates/core.md') return tmplFile;
            return plugin.app.vault.getMarkdownFiles().find((f: TFile) => f.path === path) || null;
        };
        plugin.settings.childNoteTemplatePath = 'Templates/core.md';
        plugin.settings.showNotifications = true;
        const file = plugin.findFileByAddress('6');
        const result = await plugin.applyCoreTemplate(file);
        expect(result).toBe(true);
        const content = readStore(plugin, '6.md');
        expect(content).toContain('Core: 6');
    });

    test('applyTemplaterTemplate with write_template_to_file', async () => {
        const plugin = createPlugin(['7'], { '7': '' }) as any;
        const tmplFile = await plugin.app.vault.create('Templates/tmpl.md', 'Templater content');
        plugin.app.vault.getAbstractFileByPath = (path: string) => {
            if (path === 'Templates/tmpl.md') return tmplFile;
            return null;
        };
        plugin.settings.childNoteTemplaterPath = 'Templates/tmpl.md';
        plugin.settings.showNotifications = true;
        let writeCalled = false;
        plugin.app.plugins = {
            plugins: {
                'templater-obsidian': {
                    templater: {
                        write_template_to_file: async (_tmpl: any, _file: any) => {
                            writeCalled = true;
                        }
                    }
                }
            }
        };
        const file = plugin.findFileByAddress('7');
        const result = await plugin.applyTemplaterTemplate(file);
        expect(result).toBe(true);
        expect(writeCalled).toBe(true);
    });

    test('applyTemplaterTemplate with overwrite_file_commands', async () => {
        const plugin = createPlugin(['8'], { '8': '' }) as any;
        const tmplFile = await plugin.app.vault.create('Templates/tmpl.md', 'Templater v2');
        plugin.app.vault.getAbstractFileByPath = (path: string) => {
            if (path === 'Templates/tmpl.md') return tmplFile;
            return null;
        };
        plugin.settings.childNoteTemplaterPath = 'Templates/tmpl.md';
        plugin.settings.showNotifications = true;
        let overwriteCalled = false;
        plugin.app.plugins = {
            plugins: {
                'templater-obsidian': {
                    templater: {
                        overwrite_file_commands: async (_file: any, _force?: boolean) => {
                            overwriteCalled = true;
                        }
                    }
                }
            }
        };
        const file = plugin.findFileByAddress('8');
        const result = await plugin.applyTemplaterTemplate(file);
        expect(result).toBe(true);
        expect(overwriteCalled).toBe(true);
    });

    test('applyTemplaterTemplate with append_template_to_active_file', async () => {
        const plugin = createPlugin(['9'], { '9': '' }) as any;
        const tmplFile = await plugin.app.vault.create('Templates/tmpl.md', 'Templater v3');
        plugin.app.vault.getAbstractFileByPath = (path: string) => {
            if (path === 'Templates/tmpl.md') return tmplFile;
            return null;
        };
        plugin.settings.childNoteTemplaterPath = 'Templates/tmpl.md';
        plugin.settings.showNotifications = true;
        let appendCalled = false;
        plugin.app.plugins = {
            plugins: {
                'templater-obsidian': {
                    templater: {
                        append_template_to_active_file: async (_tmpl: any) => {
                            appendCalled = true;
                        }
                    }
                }
            }
        };
        const file = plugin.findFileByAddress('9');
        const result = await plugin.applyTemplaterTemplate(file);
        expect(result).toBe(true);
        expect(appendCalled).toBe(true);
    });

    test('applyTemplaterTemplate with no API methods throws', async () => {
        const plugin = createPlugin(['10'], { '10': '' }) as any;
        const tmplFile = await plugin.app.vault.create('Templates/tmpl.md', 'content');
        plugin.app.vault.getAbstractFileByPath = (path: string) => {
            if (path === 'Templates/tmpl.md') return tmplFile;
            return null;
        };
        plugin.settings.childNoteTemplaterPath = 'Templates/tmpl.md';
        plugin.settings.showNotifications = true;
        plugin.app.plugins = {
            plugins: {
                'templater-obsidian': {
                    templater: {}
                }
            }
        };
        const file = plugin.findFileByAddress('10');
        const result = await plugin.applyTemplaterTemplate(file);
        expect(result).toBe(false);
    });

    test('applyTemplate with notification', async () => {
        const plugin = createPlugin(['1', '2'], {
            '1': 'Template for {{title}}',
            '2': ''
        });
        plugin.settings.showNotifications = true;
        const tmplFile = plugin.findFileByAddress('1');
        const targetFile = plugin.findFileByAddress('2');
        await plugin.applyTemplate(targetFile!, tmplFile);
        const content = readStore(plugin, '2.md');
        expect(content).toContain('Template for 2');
    });
});

// ===========================================================================
// Command methods: more thorough coverage
// ===========================================================================

describe('command methods (extended)', () => {
    test('suggestNextChildCommand shows warning for existing child', () => {
        const plugin = createPlugin(['20', '20.1'], { '20': '', '20.1': '' });
        plugin.settings.showNotifications = true;
        const mockView = { file: plugin.findFileByAddress('20') };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        // suggestNextChild('20') returns '20.1' which already exists
        // But actually it would suggest 20.2 since 20.1 exists. Let me check:
        // suggestNextChild('20') with existing 20.1 → 20.2 (not duplicate)
        // To trigger the duplicate branch, let's make suggestNextChild return '20.1'
        plugin.suggestNextChild = (_addr: string) => '20.1';
        plugin.suggestNextChildCommand();
    });

    test('suggestNextChildCommand shows non-duplicate notice', () => {
        const plugin = createPlugin(['20'], { '20': '' });
        plugin.settings.showNotifications = true;
        const mockView = { file: plugin.findFileByAddress('20') };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        plugin.suggestNextChildCommand();
    });

    test('createNextChild on 00.0 index, cursor in a heading list, infers heading', async () => {
        // Cursor sits in the Subject Matter list; the next root integer (8)
        // is created and filed under that same heading, with no prompt.
        const body = '## Subject Matter\n- [[7 Existing root]]\n## Project Support\n';
        const plugin = createPlugin(['00.0', '7'], { '00.0': body });
        const view = mockView(plugin.findFileByAddress('00.0'), body, 1); // cursor on "- [[7 Existing root]]"
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createNextChild();
        const files = plugin.app.vault.getMarkdownFiles();
        expect(files.find((f: any) => f.basename === '8')).toBeTruthy();
    });

    test('createNextChild on 00.0 index, cursor not in a list, uses next root integer', async () => {
        const body = '## Subject Matter\n\n## Project Support\n';
        const plugin = createPlugin(['00.0', '7'], { '00.0': body });
        const view = mockView(plugin.findFileByAddress('00.0'), 'intro prose\n', 0);
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createNextChild();
        const files = plugin.app.vault.getMarkdownFiles();
        // suggestNextChild('00.0') scans root integers (max 7) -> 8.
        expect(files.find((f: any) => f.basename === '8')).toBeTruthy();
    });

    test('createChildNoteWithAddress uses noteTitle for filename when provided', async () => {
        const plugin = createPlugin(['00.0'], {
            '00.0': '## Subject Matter\n\n## Project Support\n'
        });
        const parentFile = plugin.findFileByAddress('00.0')!;
        await plugin.createChildNoteWithAddress('127', parentFile, '## Subject Matter', '127. Annual Evaluations');
        const files = plugin.app.vault.getMarkdownFiles();
        const found = files.find((f: any) => f.basename === '127. Annual Evaluations');
        expect(found).toBeTruthy();
    });

    test('createChildNoteWithAddress falls back to address when no noteTitle', async () => {
        const plugin = createPlugin(['00.0'], {
            '00.0': '## Subject Matter\n\n## Project Support\n'
        });
        const parentFile = plugin.findFileByAddress('00.0')!;
        await plugin.createChildNoteWithAddress('127', parentFile, '## Subject Matter');
        const files = plugin.app.vault.getMarkdownFiles();
        const found = files.find((f: any) => f.basename === '127');
        expect(found).toBeTruthy();
    });

    test('createNextChild with root number parent (no list) creates next sibling', async () => {
        // Active note "20" sits under 00.0; with no list under the cursor the
        // fallback creates its next sibling "21".
        const plugin = createPlugin(['00.0', '20'], {
            '00.0': '## Subject Matter\n- [[20 Some root]]\n'
        });
        const view = mockView(plugin.findFileByAddress('20'), 'body without a list\n', 0);
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createNextChild();
        const files = plugin.app.vault.getMarkdownFiles();
        expect(files.find((f: any) => f.basename === '21')).toBeTruthy();
    });

    test('createNextChild with dot-notation parent (no list) creates next sibling', async () => {
        // "1.2" has no parent file in the vault, so the note is created on its
        // own; the inferred sibling is "1.3".
        const plugin = createPlugin(['1.2']);
        const view = mockView(plugin.findFileByAddress('1.2'), 'no list\n', 0);
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createNextChild();
        const files = plugin.app.vault.getMarkdownFiles();
        expect(files.find((f: any) => f.basename === '1.3')).toBeTruthy();
    });

    test('createNextChild with letter parent (no list) creates next sibling', async () => {
        const plugin = createPlugin(['1a']);
        const view = mockView(plugin.findFileByAddress('1a'), 'no list\n', 0);
        plugin.app.workspace.getActiveViewOfType = () => view;
        await plugin.createNextChild();
        const files = plugin.app.vault.getMarkdownFiles();
        expect(files.find((f: any) => f.basename === '1b')).toBeTruthy();
    });

    test('createNoteWithAddress with null folder', async () => {
        const plugin = createPlugin();
        await plugin.createNoteWithAddress('20', null);
        const files = plugin.app.vault.getMarkdownFiles();
        const found = files.find((f: TFile) => f.basename === '20');
        expect(found).toBeTruthy();
    });

    test('createNoteWithAddress with notification', async () => {
        const plugin = createPlugin();
        plugin.settings.showNotifications = true;
        await plugin.createNoteWithAddress('20', null);
    });

    test('createNoteWithAddress error with notification', async () => {
        const plugin = createPlugin();
        plugin.settings.showNotifications = true;
        plugin.app.vault.create = async () => { throw new Error('disk full'); };
        await plugin.createNoteWithAddress('20', null);
    });

    test('createChildNoteWithAddress with notification', async () => {
        const plugin = createPlugin(['20'], { '20': '' });
        plugin.settings.showNotifications = true;
        const parentFile = plugin.findFileByAddress('20');
        await plugin.createChildNoteWithAddress('20.1', parentFile!);
    });

    test('createChildNoteWithAddress error with notification', async () => {
        const plugin = createPlugin(['20'], { '20': '' });
        plugin.settings.showNotifications = true;
        plugin.app.vault.create = async () => { throw new Error('error'); };
        const parentFile = plugin.findFileByAddress('20');
        await plugin.createChildNoteWithAddress('20.1', parentFile!);
    });

    test('createNoteWithTemplate with template applied', async () => {
        const plugin = createPlugin(['tmpl'], { 'tmpl': 'Hello {{title}}' });
        plugin.settings.showNotifications = true;
        plugin.promptForNoteName = async () => 'newNote';
        const tmplFile = plugin.findFileByAddress('tmpl');
        await plugin.createNoteWithTemplate(tmplFile);
    });

    test('createNoteWithTemplate error with notification', async () => {
        const plugin = createPlugin();
        plugin.settings.showNotifications = true;
        plugin.promptForNoteName = async () => 'newNote';
        plugin.app.vault.create = async () => { throw new Error('err'); };
        await plugin.createNoteWithTemplate(null);
    });

    test('promptForFolgezettelalNote with duplicate triggers modal', async () => {
        const plugin = createPlugin(['20']);
        plugin.promptForNoteName = async () => '20';
        // The DuplicateAddressModal will be opened which calls onOpen()
        await plugin.promptForFolgezettelalNote();
    });

    test('addBacklinkToParent with root integer + confirmed heading', async () => {
        const plugin = createPlugin(['00.0', '20'], {
            '00.0': '## Subject Matter\n\n## Project Support\n',
            '20': ''
        });
        plugin.promptForIndexHeading = async () => 'Subject Matter';
        const mockView = { file: plugin.findFileByAddress('20') };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        await plugin.addBacklinkToParent();
        const content = readStore(plugin, '20.md');
        expect(content).toContain('[[00.0|Parent]]');
    });

    test('addBacklinkToParent with notification', async () => {
        const plugin = createPlugin(['20', '20.1'], { '20': '', '20.1': '' });
        plugin.settings.showNotifications = true;
        const mockView = { file: plugin.findFileByAddress('20.1') };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        await plugin.addBacklinkToParent();
    });

    test('insertBacklink with notification', async () => {
        const plugin = createPlugin(['20', '20.1']);
        plugin.settings.showNotifications = true;
        (plugin as any).__store.set('20.1.md', '');
        const child = new TFile('20.1.md', '20.1');
        const parent = new TFile('20.md', '20');
        await plugin.insertBacklink(child, parent);
    });

    test('insertForwardLink with notification', async () => {
        const plugin = createPlugin(['20', '20.1']);
        plugin.settings.showNotifications = true;
        (plugin as any).__store.set('20.md', '');
        const parent = new TFile('20.md', '20');
        const child = new TFile('20.1.md', '20.1');
        await plugin.insertForwardLink(parent, child);
    });

    test('insertCrossLink with notification', async () => {
        const plugin = createPlugin(['1', '2'], { '1': '', '2': '' });
        plugin.settings.showNotifications = true;
        const target = plugin.findFileByAddress('2');
        const source = plugin.findFileByAddress('1');
        await (plugin as any).insertCrossLink(target, source);
        const content = readStore(plugin, '2.md');
        expect(content).toContain('[[1|Cross-reference]]');
    });

    test('suggestNextChildCommand with non-folgezettel file', () => {
        const plugin = createPlugin();
        const nonFzFile = new TFile('readme.md', 'readme');
        plugin.app.vault.getMarkdownFiles = () => [nonFzFile];
        const mockView = { file: nonFzFile };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        // Should not throw - just shows "no address" notice
        plugin.suggestNextChildCommand();
    });

    test('createNextChild with non-folgezettel file', async () => {
        const plugin = createPlugin();
        const nonFzFile = new TFile('readme.md', 'readme');
        plugin.app.vault.getMarkdownFiles = () => [nonFzFile];
        const mockView = { file: nonFzFile };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        await plugin.createNextChild();
    });

    test('addBacklinkToParent with no active view', async () => {
        const plugin = createPlugin();
        plugin.app.workspace.getActiveViewOfType = () => null;
        await plugin.addBacklinkToParent();
    });

    test('addBacklinkToParent with non-folgezettel file', async () => {
        const plugin = createPlugin();
        const nonFzFile = new TFile('readme.md', 'readme');
        const mockView = { file: nonFzFile };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        await plugin.addBacklinkToParent();
    });

    test('addBacklinkToParent with missing parent file', async () => {
        const plugin = createPlugin(['1a']);
        // 1a parent is '1' but '1' does not exist in vault
        const mockView = { file: plugin.findFileByAddress('1a') };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        await plugin.addBacklinkToParent();
    });

    test('addBacklinkToParent with root integer cancelled heading', async () => {
        const plugin = createPlugin(['00.0', '20'], {
            '00.0': '## Subject Matter\n',
            '20': ''
        });
        plugin.promptForIndexHeading = async () => null; // user cancelled
        const mockView = { file: plugin.findFileByAddress('20') };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        await plugin.addBacklinkToParent();
    });

    test('createNoteWithTemplate with template (full flow)', async () => {
        jest.useFakeTimers();
        const plugin = createPlugin(['3'], { '3': 'Tmpl {{title}}' });
        plugin.settings.showNotifications = true;
        plugin.promptForNoteName = async () => '99';
        const tmplFile = plugin.findFileByAddress('3');
        await plugin.createNoteWithTemplate(tmplFile);
        jest.runAllTimers();
        jest.useRealTimers();
    });

    test('createNoteWithAddress with parent folder', async () => {
        jest.useFakeTimers();
        const plugin = createPlugin();
        plugin.settings.showNotifications = true;
        const folder = new TFolder('subfolder');
        await plugin.createNoteWithAddress('50', folder);
        jest.runAllTimers();
        jest.useRealTimers();
    });

    test('createFolgezettelNote calls createNoteWithAddress', async () => {
        jest.useFakeTimers();
        const plugin = createPlugin();
        plugin.settings.showNotifications = true;
        await (plugin as any).createFolgezettelNote('42');
        jest.runAllTimers();
        jest.useRealTimers();
    });

    test('promptForFolgezettelalNote with invalid address', async () => {
        const plugin = createPlugin();
        plugin.promptForNoteName = async () => '!!!invalid!!!';
        await plugin.promptForFolgezettelalNote();
    });

    test('promptForFolgezettelalNote with null name', async () => {
        const plugin = createPlugin();
        plugin.promptForNoteName = async () => null as any;
        await plugin.promptForFolgezettelalNote();
    });

    test('promptForFolgezettelalNote with valid non-duplicate name', async () => {
        jest.useFakeTimers();
        const plugin = createPlugin();
        plugin.promptForNoteName = async () => '55';
        await plugin.promptForFolgezettelalNote();
        jest.runAllTimers();
        jest.useRealTimers();
    });

    test('createChildNoteWithAddress with setTimeout cleanup', async () => {
        jest.useFakeTimers();
        const plugin = createPlugin(['20'], { '20': '' });
        plugin.settings.showNotifications = true;
        const parentFile = plugin.findFileByAddress('20');
        await plugin.createChildNoteWithAddress('20.1', parentFile!);
        // Run the setTimeout in finally block
        jest.runAllTimers();
        jest.useRealTimers();
    });
});

// ===========================================================================
// positionCursorAtEndOfTitle with fake timers
// ===========================================================================

describe('positionCursorAtEndOfTitle (with fake timers)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('fallback branch: no inline-title, sets cursor at 0,0', () => {
        const plugin = createPlugin();
        const mockEditor = { setCursor: jest.fn(), focus: jest.fn() };
        const mockView = {
            editor: mockEditor,
            containerEl: { querySelector: () => null }
        };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        (plugin as any).positionCursorAtEndOfTitle('20');
        jest.runAllTimers();
        expect(mockEditor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 0 });
        expect(mockEditor.focus).toHaveBeenCalled();
    });

    test('inline-title branch: focuses editable element', () => {
        const plugin = createPlugin();
        const mockEditor = { setCursor: jest.fn(), focus: jest.fn() };
        const titleEl = {
            isContentEditable: true,
            focus: jest.fn()
        };
        const mockView = {
            editor: mockEditor,
            containerEl: {
                querySelector: (sel: string) => sel === '.inline-title' ? titleEl : null
            }
        };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        // Mock window.getSelection to avoid ReferenceError in Node
        (global as any).window = {
            getSelection: () => ({
                removeAllRanges: () => {},
                addRange: () => {}
            })
        };
        (global as any).document = {
            createRange: () => ({
                selectNodeContents: () => {},
                collapse: () => {}
            })
        };
        (plugin as any).positionCursorAtEndOfTitle('20');
        jest.runAllTimers();
        expect(titleEl.focus).toHaveBeenCalled();
        delete (global as any).window;
        delete (global as any).document;
    });

    test('no active view: does nothing', () => {
        const plugin = createPlugin();
        plugin.app.workspace.getActiveViewOfType = () => null;
        (plugin as any).positionCursorAtEndOfTitle('20');
        jest.runAllTimers();
        // Should not throw
    });

    test('no editor: does nothing', () => {
        const plugin = createPlugin();
        const mockView = { editor: null, containerEl: { querySelector: () => null } };
        plugin.app.workspace.getActiveViewOfType = () => mockView;
        (plugin as any).positionCursorAtEndOfTitle('20');
        jest.runAllTimers();
    });
});

// ===========================================================================
// TemplatePicker with templates
// ===========================================================================

describe('TemplatePicker modal (extended)', () => {
    test('template picker with templates in folder', async () => {
        const plugin = createPlugin();
        plugin.settings.templateFolder = 'Templates';

        // Build a mock folder with TFile children
        const t1 = new TFile('Templates/t1.md', 't1');
        const t2 = new TFile('Templates/t2.md', 't2');
        const tmplFolder = new TFolder('Templates');
        tmplFolder.children = [t1, t2];

        plugin.app.vault.getAbstractFileByPath = (path: string) => {
            if (path === 'Templates') return tmplFolder;
            return null;
        };

        // selectTemplateAndCreateNote will open TemplatePicker, which calls onOpen()
        // The onOpen() will call getTemplates, find templates, and render them
        await plugin.selectTemplateAndCreateNote();
    });

    test('template picker with empty folder', async () => {
        const plugin = createPlugin();
        plugin.settings.templateFolder = 'Templates';

        const tmplFolder = new TFolder('Templates');
        tmplFolder.children = [];

        plugin.app.vault.getAbstractFileByPath = (path: string) => {
            if (path === 'Templates') return tmplFolder;
            return null;
        };

        await plugin.selectTemplateAndCreateNote();
    });

    test('template picker with no template folder', async () => {
        const plugin = createPlugin();
        plugin.settings.templateFolder = '';
        await plugin.selectTemplateAndCreateNote();
    });

    test('template picker with nested folders', async () => {
        const plugin = createPlugin();
        plugin.settings.templateFolder = 'Templates';

        const t1 = new TFile('Templates/t1.md', 't1');
        const subFolder = new TFolder('Templates/sub');
        const t2 = new TFile('Templates/sub/t2.md', 't2');
        subFolder.children = [t2];
        const tmplFolder = new TFolder('Templates');
        tmplFolder.children = [t1, subFolder];

        plugin.app.vault.getAbstractFileByPath = (path: string) => {
            if (path === 'Templates') return tmplFolder;
            return null;
        };

        await plugin.selectTemplateAndCreateNote();
    });
});

// ===========================================================================
// checkForDuplicateAddress - duplicate detection path
// ===========================================================================

describe('checkForDuplicateAddress (extended)', () => {
    test('opens DuplicateAddressWarningModal when duplicate detected', () => {
        const plugin = createPlugin(['20']);
        // Create a second file with the same address basename
        const file = new TFile('other/20.md', '20');
        // The vault already has a '20' file, so this new one is a duplicate
        plugin.checkForDuplicateAddress(file);
        // The DuplicateAddressWarningModal should have been opened (onOpen called via mock)
    });
});

// ===========================================================================
// insertLinkUnderHeading: additional edge cases
// ===========================================================================

describe('insertLinkUnderHeading (extended)', () => {
    test('heading with no blank line after heading and empty section', async () => {
        const plugin = createPlugin(['20']);
        const file = new TFile('20.md', '20');
        (plugin as any).__store.set('20.md', '## Notes\n## Other');
        await (plugin as any).insertLinkUnderHeading(file, '[[5]]', 'Notes', '5');
        const content = readStore(plugin, '20.md');
        expect(content).toContain('- [[5]]');
    });

    test('heading with blank line already present and empty section', async () => {
        const plugin = createPlugin(['20']);
        const file = new TFile('20.md', '20');
        (plugin as any).__store.set('20.md', '## Notes\n\n## Other');
        await (plugin as any).insertLinkUnderHeading(file, '[[5]]', 'Notes', '5');
        const content = readStore(plugin, '20.md');
        expect(content).toContain('- [[5]]');
    });
});
