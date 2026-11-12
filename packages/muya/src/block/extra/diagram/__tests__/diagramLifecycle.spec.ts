// @vitest-environment happy-dom

import type { IDiagramState } from '../../../../state/types';
import { parse, View } from 'vega';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../../muya';
import { ScrollPage } from '../../../scrollPage';
import DiagramPreview from '../diagramPreview';

const loadRenderer = vi.hoisted(() => vi.fn());
vi.mock('../../../../utils/diagram', () => ({ default: loadRenderer }));

const editors: Muya[] = [];
let originalVersion: string | undefined;

interface IRenderer {
    parse: (code: string) => { drawSVG: (target: HTMLElement) => void; clean?: () => void };
}

const state: IDiagramState = { name: 'diagram', text: '', meta: { lang: 'yaml', type: 'flowchart' } };

beforeEach(() => {
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
    loadRenderer.mockReset();
});

afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    document.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (originalVersion === undefined)
        delete (window as Partial<Window>).MUYA_VERSION;
    else
        window.MUYA_VERSION = originalVersion;
});

function boot(count = 1, type: IDiagramState['meta']['type'] = 'flowchart') {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const muya = new Muya(root, { json: Array.from({ length: count }, () => ({ ...structuredClone(state), meta: { ...state.meta, type } })) });
    muya.init({ focus: false });
    editors.push(muya);
    return muya;
}

function preview(muya: Muya, index = 0) {
    const block = muya.editor.scrollPage!.find(index);
    const attachment = block?.isParent() ? block.attachments.head : undefined;
    if (!(attachment instanceof DiagramPreview))
        throw new Error('Expected a real diagram preview attachment');
    return attachment;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

function renderer() {
    const clean = vi.fn();
    const draw = vi.fn((target: HTMLElement, text: string) => {
        target.innerHTML = `<svg width="40" height="20"><text>${text}</text></svg>`;
    });
    const engine: IRenderer = { parse: code => ({ drawSVG: target => draw(target, code), clean }) };
    return { engine, draw, clean };
}

describe('diagram attachment lifetimes', () => {
    it.each(['editor', 'attachment', 'block', 'replacement', 'document'])('invalidates pending rendering on %s removal', async (kind) => {
        const muya = boot();
        const attachment = preview(muya);
        const pending = deferred<IRenderer>();
        loadRenderer.mockReturnValue(pending.promise);
        const job = attachment.update('retired');
        const root = attachment.domNode!;
        const removeListener = vi.spyOn(root, 'removeEventListener');
        if (kind === 'editor')
            muya.destroy();
        else if (kind === 'attachment')
            attachment.remove();
        else if (kind === 'block')
            attachment.parent!.remove();
        else if (kind === 'replacement')
            attachment.parent!.replaceWith(ScrollPage.loadBlock('paragraph').create(muya, { name: 'paragraph', text: 'replacement' }));
        else
            muya.setContent('new document');
        const rendered = renderer();
        pending.resolve(rendered.engine);
        await job;
        expect(attachment.isDisposed).toBe(true);
        expect(rendered.draw).not.toHaveBeenCalled();
        expect(removeListener.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1);
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        root.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(false);
        await attachment.update('must not restart');
        expect(loadRenderer).toHaveBeenCalledTimes(1);
    });

    it('cancels three obsolete requests completed in reverse order', async () => {
        const attachment = preview(boot());
        const requests = Array.from({ length: 4 }, () => deferred<IRenderer>());
        requests.forEach(request => loadRenderer.mockReturnValueOnce(request.promise));
        const jobs = ['first', 'second', 'third', 'latest'].map(code => attachment.update(code));
        const rendered = renderer();
        for (let index = 3; index >= 0; index--) {
            requests[index].resolve(rendered.engine);
            await jobs[index];
        }
        expect(rendered.draw).toHaveBeenCalledTimes(1);
        expect(attachment.domNode!.textContent).toBe('latest');
        expect(attachment.domNode!.querySelectorAll('.mu-diagram-render')).toHaveLength(1);
    });

    it('keeps repeated identical rendering safe and disposes previous resources', async () => {
        const attachment = preview(boot());
        const rendered = renderer();
        loadRenderer.mockResolvedValue(rendered.engine);
        for (let index = 0; index < 4; index++)
            await attachment.update('identical');
        expect(rendered.clean).toHaveBeenCalledTimes(3);
        expect(attachment.domNode!.textContent).toBe('identical');
        attachment.dispose();
        attachment.dispose();
        expect(rendered.clean).toHaveBeenCalledTimes(4);
    });

    it.each(['superseded', 'disposed'])('ignores pending rejection when %s', async (kind) => {
        const attachment = preview(boot());
        const pending = deferred<IRenderer>();
        loadRenderer.mockReturnValueOnce(pending.promise);
        const job = attachment.update('obsolete');
        const rendered = renderer();
        loadRenderer.mockResolvedValue(rendered.engine);
        if (kind === 'superseded')
            await attachment.update('latest');
        else
            attachment.dispose();
        const error = vi.spyOn(console, 'error');
        pending.reject(new Error('obsolete error'));
        await expect(job).resolves.toBeUndefined();
        expect(error).not.toHaveBeenCalled();
        expect(attachment.domNode!.textContent).not.toContain('obsolete error');
        if (kind === 'superseded')
            expect(attachment.domNode!.textContent).toBe('latest');
    });

    it('cleans observers, timers and click subscriptions idempotently', async () => {
        vi.useFakeTimers();
        const attachment = preview(boot());
        const timersBefore = vi.getTimerCount();
        loadRenderer.mockResolvedValue({ parse: () => ({ drawSVG: () => {} }) });
        const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
        const remove = vi.spyOn(attachment.domNode!, 'removeEventListener');
        await attachment.update('pending svg');
        expect(vi.getTimerCount()).toBe(timersBefore + 1);
        attachment.dispose();
        attachment.dispose();
        expect(vi.getTimerCount()).toBe(timersBefore);
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(remove.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1);
    });

    it('finishes active SVG finalization and clears its safety timer', async () => {
        vi.useFakeTimers();
        const attachment = preview(boot());
        const timersBefore = vi.getTimerCount();
        loadRenderer.mockResolvedValue({ parse: () => ({ drawSVG: () => {} }) });
        await attachment.update('late svg');
        attachment.domNode!.querySelector('.mu-diagram-render')!.innerHTML = '<svg width="40" height="20"><title>Late diagram</title></svg>';
        await vi.waitFor(() => expect(attachment.domNode!.getAttribute('aria-label')).toBe('Late diagram'));
        expect(vi.getTimerCount()).toBe(timersBefore);
        expect(attachment.domNode!.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 40 20');
    });

    it('disposes one diagram without interrupting a surviving diagram or editor', async () => {
        const first = boot(2);
        const second = boot();
        const removed = preview(first);
        const survivor = preview(first, 1);
        const peer = preview(second);
        const pending = deferred<IRenderer>();
        loadRenderer.mockReturnValueOnce(pending.promise);
        const retired = removed.update('old');
        removed.parent!.remove();
        const rendered = renderer();
        loadRenderer.mockResolvedValue(rendered.engine);
        await survivor.update('survivor');
        await peer.update('peer');
        pending.resolve(rendered.engine);
        await retired;
        expect(rendered.draw).toHaveBeenCalledTimes(2);
        expect(survivor.domNode!.textContent).toBe('survivor');
        expect(peer.domNode!.textContent).toBe('peer');
    });

    it('preserves a pending attachment during a legitimate move', async () => {
        const muya = boot(2);
        const attachment = preview(muya);
        const block = attachment.parent!;
        const pending = deferred<IRenderer>();
        loadRenderer.mockReturnValue(pending.promise);
        const job = attachment.update('moved');
        block.insertInto(muya.editor.scrollPage!);
        const rendered = renderer();
        pending.resolve(rendered.engine);
        await job;
        expect(attachment.isDisposed).toBe(false);
        expect(block.isDisposed).toBe(false);
        expect(attachment.domNode!.isConnected).toBe(true);
        expect(rendered.draw).toHaveBeenCalledTimes(1);
    });

    it('preserves a diagram promoted out of an obsolete parent', async () => {
        const muya = boot();
        muya.setContent('> ```flowchart\n>\n> ```');
        const quote = muya.editor.scrollPage!.firstChild!;
        if (!quote.isParent())
            throw new Error('Expected a quote container');
        const diagram = quote.firstChild!;
        if (!diagram.isParent())
            throw new Error('Expected a nested diagram');
        const attachment = diagram.attachments.head as DiagramPreview;
        quote.replaceWith(diagram);
        const rendered = renderer();
        loadRenderer.mockResolvedValue(rendered.engine);
        await attachment.update('promoted');
        expect(quote.isDisposed).toBe(true);
        expect(diagram.isDisposed).toBe(false);
        expect(attachment.domNode!.textContent).toBe('promoted');
    });

    it('disposes outgoing diagrams during replacement, undo and redo', async () => {
        const muya = boot();
        const rendered = renderer();
        loadRenderer.mockResolvedValue(rendered.engine);
        const old = preview(muya);
        await old.update('old');
        muya.replaceContent('Replacement paragraph');
        expect(old.isDisposed).toBe(true);
        muya.undo();
        const restored = preview(muya);
        await restored.update('restored');
        expect(restored).not.toBe(old);
        expect(restored.isDisposed).toBe(false);
        muya.redo();
        expect(restored.isDisposed).toBe(true);
        expect(muya.getMarkdown()).toBe('Replacement paragraph\n');
    });

    it('does not serialize preview updates into canonical Markdown or history', async () => {
        const muya = boot();
        const markdown = muya.getMarkdown();
        const history = muya.getHistory();
        loadRenderer.mockResolvedValue(renderer().engine);
        await preview(muya).update('rendered only');
        expect(muya.getMarkdown()).toBe(markdown);
        expect(muya.getHistory()).toEqual(history);
    });

    it('disposes diagrams removed by incremental undo/redo without reusing retired attachments', async () => {
        const muya = boot();
        const old = preview(muya);
        old.parent!.replaceWith(ScrollPage.loadBlock('paragraph').create(muya, { name: 'paragraph', text: 'replacement' }));
        muya.flush();
        expect(old.isDisposed).toBe(true);
        muya.undo();
        const restored = preview(muya);
        expect(restored).not.toBe(old);
        expect(restored.isDisposed).toBe(false);
        muya.redo();
        expect(restored.isDisposed).toBe(true);
        expect(muya.getMarkdown()).toBe('replacement\n');
    });

    it('isolates late Vega DOM writes and finalizes a native view during pending embedding', async () => {
        const attachment = preview(boot(1, 'vega-lite'));
        const started = deferred<HTMLElement>();
        const finish = deferred<void>();
        const finalized = vi.spyOn(View.prototype, 'finalize');
        loadRenderer.mockResolvedValue(async (target: HTMLElement, spec: { label: string }, options: { viewClass: typeof View }) => {
            const OwnedView = options.viewClass;
            const view = new OwnedView(parse({ marks: [] }), { renderer: 'none' });
            if (spec.label === 'old') {
                started.resolve(target);
                await finish.promise;
            }
            target.innerHTML = `<svg width="40" height="20"><text>${spec.label}</text></svg>`;
            return { finalize: () => view.finalize() };
        });
        const pending = attachment.update('{"label":"old"}');
        const retiredTarget = await started.promise;
        await attachment.update('{"label":"latest"}');
        expect(finalized).toHaveBeenCalledTimes(1);
        finish.resolve();
        await pending;
        expect(retiredTarget.isConnected).toBe(false);
        expect(attachment.domNode!.textContent).toBe('latest');
        expect(finalized).toHaveBeenCalledTimes(1);
        attachment.dispose();
        expect(finalized).toHaveBeenCalledTimes(2);
    });

    it('releases resources across repeated editor construction and destruction', async () => {
        const rendered = renderer();
        loadRenderer.mockResolvedValue(rendered.engine);
        for (let index = 0; index < 6; index++) {
            const muya = boot();
            const attachment = preview(muya);
            await attachment.update('active');
            muya.destroy();
            expect(attachment.isDisposed).toBe(true);
        }
        expect(rendered.clean).toHaveBeenCalledTimes(6);
    });
});
