// @vitest-environment happy-dom

import { parse, View } from 'vega';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderDiagram } from '../render';

const loadRenderer = vi.hoisted(() => vi.fn());
vi.mock('../index', () => ({ default: loadRenderer }));
const controllers: AbortController[] = [];
const targets: HTMLElement[] = [];

afterEach(() => {
    controllers.splice(0).forEach(controller => controller.abort());
    targets.splice(0).forEach(target => target.remove());
    loadRenderer.mockReset();
    vi.restoreAllMocks();
});

function request(type = 'mermaid', code = 'valid') {
    const controller = new AbortController();
    controllers.push(controller);
    const target = document.createElement('div');
    document.body.appendChild(target);
    targets.push(target);
    return { controller, options: {
        target,
        type,
        code,
        signal: controller.signal,
        mermaidTheme: 'default',
        vegaTheme: 'latimes',
        plantumlServer: '',
        sequenceTheme: 'simple' as const,
    } };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('diagram render request ownership', () => {
    it('does not load a renderer for an already obsolete request', async () => {
        const { controller, options } = request();
        controller.abort();
        await renderDiagram(options);
        expect(loadRenderer).not.toHaveBeenCalled();
    });

    it('does not start Mermaid rendering after an obsolete parse completes', async () => {
        const { controller, options } = request();
        const parsed = deferred<void>();
        const started = deferred<void>();
        const render = vi.fn();
        loadRenderer.mockResolvedValue({ initialize: vi.fn(), parse: () => {
            started.resolve();
            return parsed.promise;
        }, render });
        const job = renderDiagram(options);
        await started.promise;
        controller.abort();
        parsed.resolve();
        await job;
        expect(render).not.toHaveBeenCalled();
    });

    it('does not commit Mermaid SVG or bind callbacks after cancellation', async () => {
        const { controller, options } = request();
        const rendered = deferred<{ svg: string; bindFunctions: () => void }>();
        const started = deferred<void>();
        loadRenderer.mockResolvedValue({ initialize: vi.fn(), parse: async () => {}, render: () => {
            started.resolve();
            return rendered.promise;
        } });
        const job = renderDiagram(options);
        await started.promise;
        controller.abort();
        const bind = vi.fn();
        rendered.resolve({ svg: '<svg></svg>', bindFunctions: bind });
        await job;
        expect(options.target.innerHTML).toBe('');
        expect(bind).not.toHaveBeenCalled();
    });

    it('binds only a valid Mermaid render and releases its DOM on disposal', async () => {
        const { controller, options } = request();
        const bind = vi.fn();
        loadRenderer.mockResolvedValue({ initialize: vi.fn(), parse: async () => {}, render: async () => ({ svg: '<svg></svg>', bindFunctions: bind }) });
        await renderDiagram(options);
        expect(bind).toHaveBeenCalledExactlyOnceWith(options.target);
        controller.abort();
        expect(options.target.innerHTML).toBe('');
    });

    it('does not draw flowcharts when parse synchronously invalidates the request', async () => {
        const { controller, options } = request('flowchart');
        const draw = vi.fn();
        loadRenderer.mockResolvedValue({ parse: () => {
            controller.abort();
            return { drawSVG: draw };
        } });
        await renderDiagram(options);
        expect(draw).not.toHaveBeenCalled();
    });

    it('retains sequence cleanup and passes its cancellation signal to font-delayed drawing', async () => {
        const { controller, options } = request('sequence');
        const dispose = vi.fn();
        const draw = vi.fn(() => dispose);
        loadRenderer.mockResolvedValue({ parse: () => ({ drawSVG: draw }) });
        await renderDiagram(options);
        expect(draw.mock.calls[0]).toEqual([options.target, { theme: 'simple', signal: controller.signal }]);
        controller.abort();
        controller.abort();
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('finalizes a native Vega view even when embedding rejects before returning a result', async () => {
        const { options } = request('vega-lite', '{}');
        const finalized = vi.spyOn(View.prototype, 'finalize');
        loadRenderer.mockResolvedValue(async (_target: HTMLElement, _spec: unknown, settings: { viewClass: typeof View }) => {
            const OwnedView = settings.viewClass;
            const view = new OwnedView(parse({ marks: [] }), { renderer: 'none' });
            expect(view).toBeInstanceOf(View);
            throw new Error('embedding failed');
        });
        await expect(renderDiagram(options)).rejects.toThrow('embedding failed');
        expect(finalized).toHaveBeenCalledTimes(1);
    });

    it('rejects native Vega view creation/initialization after the request is cancelled', async () => {
        const { controller, options } = request('vega-lite', '{}');
        const started = deferred<void>();
        const finish = deferred<void>();
        let captured: typeof View | undefined;
        let view: View | undefined;
        loadRenderer.mockResolvedValue(async (_target: HTMLElement, _spec: unknown, settings: { viewClass: typeof View }) => {
            captured = settings.viewClass;
            const OwnedView = settings.viewClass;
            view = new OwnedView(parse({ marks: [] }), { renderer: 'none' });
            started.resolve();
            await finish.promise;
            return { finalize: () => view!.finalize() };
        });
        const job = renderDiagram(options);
        await started.promise;
        controller.abort();
        expect(() => new captured!(parse({ marks: [] }))).toThrow('cancelled');
        expect(() => view!.initialize(options.target)).toThrow('cancelled');
        finish.resolve();
        await job;
    });
});
