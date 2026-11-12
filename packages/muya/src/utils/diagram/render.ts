import logger from '../logger';
import loadRenderer from './index';

const debug = logger('diagram-render:');

function ownDiagramCleanup(signal: AbortSignal | undefined, cleanup: () => void) {
    if (!signal)
        return;
    let released = false;
    const release = () => {
        if (released)
            return;
        released = true;
        signal.removeEventListener('abort', release);
        try {
            cleanup();
        }
        catch (error) {
            debug.warn(`diagram cleanup failed: ${String(error)}`);
        }
    };
    if (signal.aborted)
        release();
    else
        signal.addEventListener('abort', release, { once: true });
    return release;
}

async function createVegaOwner(signal: AbortSignal) {
    const { View } = await import('vega');
    let dispose = () => {};
    class OwnedView extends View {
        private _releasedByOwner = false;

        constructor(...args: ConstructorParameters<typeof View>) {
            if (signal.aborted)
                throw new DOMException('Diagram render was cancelled', 'AbortError');
            super(...args);
            dispose = ownDiagramCleanup(signal, () => this.finalize())!;
        }

        override initialize(...args: Parameters<InstanceType<typeof View>['initialize']>) {
            if (signal.aborted)
                throw new DOMException('Diagram render was cancelled', 'AbortError');
            return super.initialize(...args);
        }

        override finalize() {
            if (!this._releasedByOwner) {
                this._releasedByOwner = true;
                super.finalize();
            }
            return this;
        }
    }
    return { options: { viewClass: OwnedView }, dispose: () => dispose() };
}

// Concurrent Mermaid renders can share Date.now()-based IDs; provide unique IDs
// to prevent diagrams drawing into the same element (#5023).
let mermaidRenderCount = 0;

const RAPHAEL_DESC = /^Created with Rapha/;

// Supply a viewBox for fixed-size SVGs so responsive sizing scales instead of clips.
// Return false until dimensions are available.
function sizeSvg(svg: Element): boolean {
    if (svg.getAttribute('viewBox'))
        return true;
    const width = Number.parseFloat(svg.getAttribute('width') ?? '');
    const height = Number.parseFloat(svg.getAttribute('height') ?? '');
    if (width > 0 && height > 0) {
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        return true;
    }
    return false;
}

function accessibleName(media: Element, fallback: string): string {
    if (media.tagName.toLowerCase() !== 'svg')
        return fallback;

    const explicit = media.getAttribute('aria-label');
    if (explicit)
        return explicit;

    let title = '';
    let desc = '';
    for (const child of Array.from(media.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'title' && !title)
            title = (child.textContent ?? '').trim();
        else if (tag === 'desc' && !desc)
            desc = (child.textContent ?? '').trim();
    }
    // flowchart.js draws through Raphael, which stamps its own <desc> on every diagram.
    if (RAPHAEL_DESC.test(desc))
        desc = '';

    return [title, desc].filter(Boolean).join('. ') || fallback;
}

function applyFinalizations(target: HTMLElement, fallback: string): boolean {
    const media = target.querySelector('svg, img');
    if (!media)
        return false;
    if (media.tagName.toLowerCase() === 'svg' && !sizeSvg(media))
        return false;

    target.setAttribute('role', 'img');
    target.setAttribute('aria-label', accessibleName(media, fallback));

    return true;
}

// drawSVG may finish after fonts load. Observe until the SVG and dimensions arrive.
export function finalizeRenderedDiagram(target: HTMLElement, fallbackLabel: string): () => void {
    if (applyFinalizations(target, fallbackLabel))
        return () => {};

    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    const cancel = () => {
        clearTimeout(timer);
        observer?.disconnect();
        timer = undefined;
        observer = undefined;
    };
    observer = new MutationObserver(() => {
        if (applyFinalizations(target, fallbackLabel))
            cancel();
    });
    observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['width', 'height'],
    });
    // Safety net so the observer can't leak if the diagram never renders.
    timer = setTimeout(cancel, 5000);

    // The render owner must cancel observation when its target is replaced.
    return cancel;
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

// Use a per-render init directive; global Mermaid initialization would race live previews.
export function withMermaidInit(code: string, config: Record<string, unknown>): string {
    const directive = `%%{init: ${JSON.stringify(config)}}%%`;
    const frontmatter = FRONTMATTER.exec(code)?.[0] ?? '';
    const body = code.slice(frontmatter.length);

    return body.startsWith(directive)
        ? code
        : `${frontmatter}${directive}\n${body}`;
}

export interface IRenderOptions {
    /** When supplied, owns this request's renderer resources, not the shared renderer module. */
    signal?: AbortSignal;
    type: string;
    code: string;
    target: HTMLElement;
    vegaTheme: string;
    mermaidTheme: string;
    plantumlServer: string;
    sequenceTheme: 'hand' | 'simple';
}

export interface IExportRenderOptions extends IRenderOptions {
    // Disable foreignObject labels for rasterization: Chromium drops them in SVG images.
    htmlLabels: boolean;
}

export async function renderDiagramForExport({
    htmlLabels,
    ...options
}: IExportRenderOptions): Promise<void> {
    const code = options.type === 'mermaid' && !htmlLabels
        ? withMermaidInit(options.code, { htmlLabels: false })
        : options.code;

    await renderDiagram({ ...options, code });
}

async function renderVega(render: Awaited<ReturnType<typeof loadRenderer>>, { target, code, vegaTheme, signal }: IRenderOptions) {
    const owner = signal ? await createVegaOwner(signal) : undefined;
    if (signal?.aborted)
        return;
    const options = { actions: false, tooltip: false, renderer: 'svg', theme: vegaTheme, ast: true, ...owner?.options };
    try {
        const result = await render(target, JSON.parse(code), options);
        ownDiagramCleanup(signal, () => result?.finalize?.());
    }
    catch (error) {
        owner?.dispose();
        throw error;
    }
}

async function renderMermaid(render: Awaited<ReturnType<typeof loadRenderer>>, { code, target, mermaidTheme, signal }: IRenderOptions) {
    render.initialize({ startOnLoad: false, securityLevel: 'strict', theme: mermaidTheme });
    await render.parse(code);
    if (signal?.aborted)
        return;
    const { svg, bindFunctions } = await render.render(`mu-mermaid-${++mermaidRenderCount}`, code, target);
    if (signal?.aborted)
        return;
    target.innerHTML = svg;
    bindFunctions?.(target);
    ownDiagramCleanup(signal, () => target.replaceChildren());
}

export async function renderDiagram(request: IRenderOptions) {
    const {
        type,
        code,
        target,
        plantumlServer,
        sequenceTheme,
        signal,
    } = request;
    if (signal?.aborted)
        return;
    const render = await loadRenderer(type);
    if (signal?.aborted)
        return;
    const options = {};
    if (type === 'sequence') {
        Object.assign(options, { theme: sequenceTheme, signal });
    }

    if (type === 'plantuml') {
        const diagram = render.parse(code, plantumlServer);
        if (signal?.aborted)
            return;
        target.innerHTML = '';
        diagram.insertImgElement(target);
    }
    else if (type === 'vega-lite') {
        await renderVega(render, request);
    }
    else if (type === 'flowchart' || type === 'sequence') {
        const diagram = render.parse(code);
        if (signal?.aborted)
            return;
        target.innerHTML = '';
        if (type === 'flowchart') {
            ownDiagramCleanup(signal, () => diagram.clean?.());
            diagram.drawSVG(target, options);
        }
        else {
            const dispose = diagram.drawSVG(target, options);
            if (typeof dispose === 'function')
                ownDiagramCleanup(signal, dispose);
        }
    }
    else if (type === 'mermaid') {
        await renderMermaid(render, request);
    }
}
