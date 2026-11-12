// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const editors: Muya[] = [];
const events = ['click', 'input', 'keydown', 'keyup', 'compositionstart', 'compositionend'];
let originalVersion: string | undefined;

beforeEach(() => {
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    vi.restoreAllMocks();
    editors.splice(0).forEach(muya => muya.destroy());
    document.getSelection()?.removeAllRanges();
    if (originalVersion === undefined)
        delete (window as Partial<Window>).MUYA_VERSION;
    else
        window.MUYA_VERSION = originalVersion;
});

function create(readOnly = false) {
    const placeholder = document.createElement('div');
    document.body.appendChild(placeholder);
    const muya = new Muya(placeholder, { markdown: 'Alpha document', readOnly });
    editors.push(muya);
    return muya;
}

function boot(readOnly = false) {
    const muya = create(readOnly);
    muya.init({ focus: false });
    return muya;
}

function dispatch(root: HTMLElement, type: string) {
    const options = { bubbles: true, cancelable: true };
    const event = type === 'click'
        ? new MouseEvent(type, options)
        : type.startsWith('key')
            ? new KeyboardEvent(type, { ...options, key: 'ArrowRight' })
            : type.startsWith('composition')
                ? new CompositionEvent(type, options)
                : new InputEvent(type, { ...options, inputType: 'insertText', data: 'z' });
    root.dispatchEvent(event);
}

describe('instance-owned root input subscriptions', () => {
    it.each(events)('routes active %s events to the selected editable block', (event) => {
        const muya = boot();
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        block.setCursor(1, 1);
        const handler = event.startsWith('composition') ? 'composeHandler' : `${event}Handler` as 'clickHandler' | 'inputHandler' | 'keydownHandler' | 'keyupHandler';
        const routed = vi.spyOn(block, handler).mockImplementation(() => {});
        dispatch(muya.domNode, event);
        expect(routed).toHaveBeenCalledTimes(1);
    });

    it('keeps read-only root events non-mutating while the instance is active', () => {
        const muya = boot(true);
        const markdown = muya.getMarkdown();
        const history = muya.getHistory();
        const lookup = vi.spyOn(muya.editor.selection, 'getSelection');
        const readOnly = vi.spyOn(muya, 'isReadOnly', 'get');
        events.forEach(type => dispatch(muya.domNode, type));
        expect(readOnly.mock.calls.length).toBeGreaterThanOrEqual(events.length);
        expect(lookup).not.toHaveBeenCalled();
        expect(muya.getMarkdown()).toBe(markdown);
        expect(muya.getHistory()).toEqual(history);
    });

    it.each([false, true])('stops all detached-root dispatch without stopping its peer (read-only: %s)', (readOnly) => {
        const destroyed = boot(readOnly);
        const active = boot();
        const root = destroyed.domNode;
        destroyed.destroy();
        const guarded = vi.spyOn(destroyed, 'isReadOnly', 'get');
        events.forEach(type => dispatch(root, type));
        expect(guarded).not.toHaveBeenCalled();
        const block = active.editor.scrollPage!.firstContentInDescendant()!;
        block.setCursor(1, 1);
        const input = vi.spyOn(block, 'inputHandler').mockImplementation(() => {});
        dispatch(active.domNode, 'input');
        expect(input).toHaveBeenCalledTimes(1);
        expect(active.domNode.isConnected).toBe(true);
    });

    it('removes each RxJS root listener once across repeated destruction', () => {
        const muya = create();
        const added = vi.spyOn(muya.domNode, 'addEventListener');
        muya.init({ focus: false });
        const registered = new Set(muya.eventCenter.events.map(entry => entry.listener));
        const inputListeners = added.mock.calls.filter(([type, listener]) => events.includes(type) && !registered.has(listener as EventListener));
        expect(inputListeners).toHaveLength(events.length);
        const removed = vi.spyOn(muya.domNode, 'removeEventListener');
        muya.destroy();
        muya.destroy();
        for (const [type, listener] of inputListeners)
            expect(removed.mock.calls.filter(([removedType, removedListener]) => removedType === type && removedListener === listener)).toHaveLength(1);
        const guarded = vi.spyOn(muya, 'isReadOnly', 'get');
        events.forEach(type => dispatch(muya.domNode, type));
        expect(guarded).not.toHaveBeenCalled();
    });

    it('releases dispatch for repeated creation and destruction cycles', () => {
        const retired: Muya[] = [];
        for (let iteration = 0; iteration < 8; iteration++) {
            const muya = boot(iteration % 2 === 0);
            muya.destroy();
            retired.push(muya);
        }
        const probes = retired.map(muya => vi.spyOn(muya, 'isReadOnly', 'get'));
        retired.forEach(muya => events.forEach(type => dispatch(muya.domNode, type)));
        probes.forEach(probe => expect(probe).not.toHaveBeenCalled());
    });
});
