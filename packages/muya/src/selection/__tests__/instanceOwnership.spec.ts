// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';
import { SelectionDirection } from '../types';

const editors: Muya[] = [];
let originalVersion: string | undefined;

beforeEach(() => {
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    vi.restoreAllMocks();
    editors.splice(0).forEach(muya => muya.destroy());
    document.getSelection()?.removeAllRanges();
    document.querySelectorAll('[data-selection-external]').forEach(node => node.remove());
    if (originalVersion === undefined)
        delete (window as Partial<Window>).MUYA_VERSION;
    else
        window.MUYA_VERSION = originalVersion;
});

function boot(markdown: string, readOnly = false) {
    const placeholder = document.createElement('div');
    document.body.appendChild(placeholder);
    const muya = new Muya(placeholder, { markdown, readOnly });
    muya.init({ focus: false });
    editors.push(muya);
    return muya;
}

function textNode(muya: Muya, last = false): Node {
    const page = muya.editor.scrollPage!;
    const content = last ? page.lastContentInDescendant()! : page.firstContentInDescendant()!;
    const node = document.createTreeWalker(content.domNode!, NodeFilter.SHOW_TEXT).nextNode();
    if (!node)
        throw new Error('Expected a rendered text node');
    return node;
}

function select(anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number) {
    document.getSelection()!.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
}

describe('native selection instance ownership', () => {
    it.each([0, 1])('resolves only instance %s without depending on focus', (index) => {
        const pair = [boot('Alpha document'), boot('Beta document', true)];
        const owner = pair[index];
        const other = pair[1 - index];
        const text = textNode(owner);
        select(text, 0, text, 4);
        expect(owner.hasFocus()).toBe(false);
        expect(owner.getSelection()?.anchor.block.muya).toBe(owner);
        expect(owner.getSelection()?.focus.block.muya).toBe(owner);
        expect(other.getSelection()).toBeNull();
        expect(other.getSelectedText()).toBe('');
        expect(owner.editor.clipboard.getClipboardData().text).toBe(index ? 'Beta' : 'Alph');
        expect(other.editor.clipboard.getClipboardData()).toEqual({ text: '', html: '' });
    });

    it.each([false, true])('rejects endpoints in different engines (backwards: %s)', (backwards) => {
        const first = boot('Alpha document');
        const second = boot('Beta document');
        const a = textNode(first);
        const b = textNode(second);
        select(backwards ? b : a, 1, backwards ? a : b, 3);
        expect(first.getSelection()).toBeNull();
        expect(second.getSelection()).toBeNull();
        expect(first.getSelectedText()).toBe('');
        expect(second.getSelectedText()).toBe('');
    });

    it.each([false, true])('rejects partially external ranges (external anchor: %s)', (externalAnchor) => {
        const muya = boot('Alpha document');
        const outside = document.createElement('p');
        outside.dataset.selectionExternal = '';
        outside.textContent = 'Outside';
        document.body.appendChild(outside);
        const inside = textNode(muya);
        const external = outside.firstChild!;
        select(externalAnchor ? external : inside, 0, externalAnchor ? inside : external, 3);
        expect(muya.getSelection()).toBeNull();
        expect(muya.getCursorOffset()).toBeNull();
        expect(() => muya.format('strong')).not.toThrow();
        expect(muya.getMarkdown()).toBe('Alpha document\n');
    });

    it('rejects a foreign block even when its DOM is transplanted inside the root', () => {
        const first = boot('Alpha document');
        const second = boot('Beta document');
        const foreign = second.editor.scrollPage!.firstContentInDescendant()!;
        const text = textNode(second);
        first.domNode.appendChild(foreign.domNode!);
        select(text, 0, text, 4);
        expect(first.getSelection()).toBeNull();
        expect(second.getSelection()).toBeNull();
    });

    it.each(['root', 'content', 'destroyed', 'reattached destroyed root'])('rejects retained endpoints in %s', (state) => {
        const muya = boot('Alpha document');
        const text = textNode(muya);
        select(text, 0, text, 4);
        // Keep the original endpoints: browsers may clear a live range on removal.
        const retained = { anchorNode: text, anchorOffset: 0, focusNode: text, focusOffset: 4 } as Selection;
        if (state === 'root')
            muya.domNode.remove();
        else if (state === 'content')
            muya.editor.scrollPage!.firstContentInDescendant()!.domNode!.remove();
        else
            muya.destroy();
        if (state === 'reattached destroyed root')
            document.body.appendChild(muya.domNode);
        vi.spyOn(document, 'getSelection').mockReturnValue(retained);
        expect(muya.getSelection()).toBeNull();
    });

    it.each([false, true])('preserves connected multi-block ranges and direction (backwards: %s)', (backwards) => {
        const muya = boot('Alpha\n\nBeta');
        const first = textNode(muya);
        const last = textNode(muya, true);
        select(backwards ? last : first, backwards ? 4 : 0, backwards ? first : last, backwards ? 0 : 4);
        const range = muya.getSelection()!;
        expect(range.anchor.block.muya).toBe(muya);
        expect(range.focus.block.muya).toBe(muya);
        expect(range.isSelectionInSameBlock).toBe(false);
        expect(range.direction).toBe(backwards ? SelectionDirection.BACKWARD : SelectionDirection.FORWARD);
        expect(muya.getSelectedText()).toBe('Alpha\n\nBeta');
        expect(muya.editor.clipboard.getClipboardData().text).toBe('Alpha\n\nBeta\n');
    });
});
