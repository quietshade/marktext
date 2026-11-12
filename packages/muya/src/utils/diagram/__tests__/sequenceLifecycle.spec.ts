// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import Sequence from '../sequence';

const loadFont = vi.hoisted(() => vi.fn());
vi.mock('webfontloader', () => ({ default: { load: loadFont } }));
const roots: HTMLElement[] = [];

afterEach(() => {
    roots.splice(0).forEach(root => root.remove());
    loadFont.mockReset();
});

describe('vendored sequence font lifecycle', () => {
    it.each(['active', 'inactive'])('does not resume drawing when %s arrives after cancellation', (completion) => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        roots.push(root);
        const controller = new AbortController();
        const diagram = Sequence.parse('Alice->Bob: Hello');
        const dispose = diagram.drawSVG(root, {
            'theme': 'simple',
            'signal': controller.signal,
            'font-family': `R2-font-${completion}`,
        });
        expect(loadFont).toHaveBeenCalledTimes(1);
        controller.abort();
        dispose();
        expect(() => loadFont.mock.calls[0][0][completion]()).not.toThrow();
        expect(root.querySelector('svg')).toBeNull();
    });
});
