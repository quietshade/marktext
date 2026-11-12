// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DiagramPreview from '../block/extra/diagram/diagramPreview';
import { Muya } from '../muya';

const loadRenderer = vi.hoisted(() => vi.fn());
vi.mock('../utils/diagram', () => ({ default: loadRenderer }));

const instances: Muya[] = [];
let originalVersion: string | undefined;

interface IDiagramRenderer {
    parse: () => { drawSVG: (target: HTMLElement) => void };
}

beforeEach(() => {
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    instances.splice(0).forEach(muya => muya.destroy());
    document.getSelection()?.removeAllRanges();
    if (originalVersion === undefined)
        delete (window as Partial<Window>).MUYA_VERSION;
    else
        window.MUYA_VERSION = originalVersion;
    vi.restoreAllMocks();
    loadRenderer.mockReset();
});

function boot(markdown: string, readOnly = false) {
    const placeholder = document.createElement('div');
    document.body.appendChild(placeholder);
    const muya = new Muya(placeholder, { markdown, readOnly });
    muya.init({ focus: false });
    instances.push(muya);
    return muya;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function diagram(muya: Muya) {
    muya.setContent('```flowchart\n\n```');
    const first = muya.editor.scrollPage?.firstChild;
    const preview = first?.isParent() ? first.attachments.head : undefined;
    if (!(preview instanceof DiagramPreview))
        throw new Error('Expected the real Muya flowchart attachment');
    return preview;
}

describe('stage 2B.2 independent-preview readiness', () => {
    it('renders independent documents without changing the editable history', () => {
        const editable = boot('Editable **document**');
        const history = editable.getHistory();
        const markdown = editable.getMarkdown();
        const preview = boot('# Preview\n\n**Bold** and *italic*\n\n- [ ] Task', true);
        expect(preview.domNode.querySelector('strong')?.textContent).toBe('Bold');
        expect(preview.domNode.querySelector('em')?.textContent).toBe('italic');
        preview.setContent('Updated **preview**');
        expect(editable.getMarkdown()).toBe(markdown);
        expect(editable.getHistory()).toEqual(history);
        expect(preview.isReadOnly).toBe(true);
    });

    it('does not resolve another instance native selection as its own', () => {
        const editable = boot('Editable document');
        const preview = boot('Preview document', true);
        const content = preview.editor.scrollPage!.firstContentInDescendant()!;
        const range = document.createRange();
        range.selectNodeContents(content.domNode!);
        document.getSelection()!.addRange(range);
        expect(preview.getSelection()?.anchor.block.muya).toBe(preview);
        expect(editable.getSelection() === null).toBe(true);
    });

    it('detaches input dispatch when a read-only instance is destroyed', () => {
        const preview = boot('Preview document', true);
        const root = preview.domNode;
        preview.destroy();
        instances.splice(instances.indexOf(preview), 1);
        const readOnly = vi.spyOn(preview, 'isReadOnly', 'get');
        root.dispatchEvent(new Event('input', { bubbles: true }));
        expect(readOnly).not.toHaveBeenCalled();
    });

    it('does not draw or install a finalization observer after destruction', async () => {
        const preview = boot('Preview document', true);
        const block = diagram(preview);
        const renderer = deferred<IDiagramRenderer>();
        loadRenderer.mockReturnValue(renderer.promise);
        const pending = block.update('st=>start: Start');
        preview.destroy();
        instances.splice(instances.indexOf(preview), 1);
        const observer = vi.spyOn(globalThis, 'MutationObserver');
        const draw = vi.fn();
        renderer.resolve({ parse: () => ({ drawSVG: draw }) });
        await pending;
        const observed = { draws: draw.mock.calls.length, observers: observer.mock.calls.length };
        const cancelFinalize: unknown = Reflect.get(block, '_cancelFinalize');
        if (typeof cancelFinalize === 'function')
            cancelFinalize();
        expect(observed).toEqual({ draws: 0, observers: 0 });
    });

    it('keeps the latest diagram when an earlier render finishes later', async () => {
        const preview = boot('Preview document', true);
        const block = diagram(preview);
        const earlier = deferred<IDiagramRenderer>();
        const latest = deferred<IDiagramRenderer>();
        loadRenderer.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(latest.promise);
        const first = block.update('earlier');
        const second = block.update('latest');
        const render = (text: string): IDiagramRenderer => ({
            parse: () => ({
                drawSVG: (target) => {
                    target.innerHTML = `<svg width="10" height="10"><text>${text}</text></svg>`;
                },
            }),
        });
        latest.resolve(render('latest'));
        await second;
        earlier.resolve(render('earlier'));
        await first;
        expect(block.domNode!.textContent).toBe('latest');
    });
});
