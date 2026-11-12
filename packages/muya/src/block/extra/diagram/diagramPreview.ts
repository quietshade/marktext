import type { Muya } from '../../../muya';
import type { IDiagramState, TState } from '../../../state/types';
import type { IPreviewDiagramPayload } from '../../../ui/previewToolBar';
import { fromEvent, Subscription } from 'rxjs';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../../../config';
import { sanitize } from '../../../utils';
import { finalizeRenderedDiagram, renderDiagram } from '../../../utils/diagram/render';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';

const debug = logger('diagramPreview:');

class DiagramPreview extends Parent {
    private _code: string;
    private _type: string;
    private _rendered = false;
    private _cancelFinalize: (() => void) | null = null;
    private _clickSubscription = new Subscription();
    private _renderController: AbortController | null = null;
    static override blockName = 'diagram-preview';

    static create(muya: Muya, state: IDiagramState) {
        const diagramPreview = new DiagramPreview(muya, state);

        return diagramPreview;
    }

    override get path() {
        debug.warn('You can never call `get path` in diagramPreview');
        return [];
    }

    constructor(muya: Muya, { text, meta }: IDiagramState) {
        super(muya);
        this.tagName = 'div';
        this._code = text;
        this._type = meta.type;
        this.classList = ['mu-diagram-preview'];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        this._attachDOMEvents();
        this.update();
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in diagramPreview');
        return {} as TState;
    }

    private _attachDOMEvents() {
        const clickObservable = fromEvent(this.domNode!, 'click');
        this._clickSubscription.add(clickObservable.subscribe(this.clickHandler.bind(this)));
    }

    override dispose() {
        if (this.isDisposed)
            return;
        super.dispose();
        this._renderController?.abort();
        this._renderController = null;
        this._cancelFinalize?.();
        this._cancelFinalize = null;
        this._clickSubscription.unsubscribe();
        this._rendered = false;
    }

    clickHandler(event: Event) {
        if (this.isDisposed || this.muya.editor?.isDestroyed)
            return;
        event.preventDefault();
        event.stopPropagation();

        if (this.muya.isReadOnly) {
            if (this._rendered) {
                this.muya.eventCenter.emit('preview-diagram', {
                    type: this._type,
                    code: this._code,
                    preview: this.domNode!,
                    label: this.domNode!.getAttribute('aria-label'),
                } satisfies IPreviewDiagramPayload);
            }
            return;
        }

        if (this.parent == null)
            return;

        const cursorBlock = this.parent.firstContentInDescendant();
        cursorBlock?.setCursor(0, 0);
    }

    async update(code = this._code) {
        if (this.isDisposed || this.muya.editor?.isDestroyed)
            return;
        this._renderController?.abort();
        const controller = new AbortController();
        this._renderController = controller;
        const isCurrent = () => !controller.signal.aborted && !this.isDisposed && !this.muya.editor?.isDestroyed;
        const { i18n } = this.muya;
        this._rendered = false;
        if (this._code !== code)
            this._code = code;

        // A previous render may still be waiting for its `<svg>`; it must not
        // describe whatever this one puts in its place.
        this._cancelFinalize?.();
        this._cancelFinalize = null;
        this.domNode!.removeAttribute('role');
        this.domNode!.removeAttribute('aria-label');

        if (code) {
            // Third-party renderers may write during awaits; each request gets a retired-on-abort target.
            const target = document.createElement('div');
            target.className = 'mu-diagram-render';
            target.textContent = i18n.t('Loading...');
            this.domNode!.replaceChildren(target);
            controller.signal.addEventListener('abort', () => target.remove(), { once: true });
            const { mermaidTheme, vegaTheme, plantumlServer, sequenceTheme } = this.muya.options;
            const { _type: type } = this;

            try {
                await renderDiagram({
                    target,
                    code,
                    type,
                    mermaidTheme,
                    vegaTheme,
                    plantumlServer,
                    sequenceTheme,
                    signal: controller.signal,
                });
                if (!isCurrent())
                    return;
                this._rendered = true;
                this._cancelFinalize = finalizeRenderedDiagram(this.domNode!, i18n.t('Diagram'));
            }
            catch (error) {
                if (!isCurrent())
                    return;
                controller.abort();
                const detail
                    = error instanceof Error ? error.message : String(error);
                debug.error(`render ${type} diagram failed: ${detail}`);
                this.domNode!.innerHTML = `<div class="mu-diagram-error">&lt; ${i18n.t(
                    'Invalid Diagram Code',
                )} &gt;<div class="mu-diagram-error-detail">${sanitize(
                    detail,
                    PREVIEW_DOMPURIFY_CONFIG,
                    true,
                )}</div></div>`;
            }
        }
        else {
            this.domNode!.innerHTML = `<div class="${CLASS_NAMES.MU_EMPTY}">&lt; ${i18n.t(
                'Empty Diagram',
            )} &gt;</div>`;
        }
    }
}

export default DiagramPreview;
