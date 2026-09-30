// Browser-side runtime instrumentation. Injected with page.addInitScript before
// any application script runs so Canvas/ECharts/Mapbox usage can be observed
// without modifying application source.
export function installRuntimeInstrumentation() {
    if (globalThis.__layaRuntime) return;

    let sequence = 0;
    const state = { canvases: [], echarts: [], maps: [] };

    const nextId = (prefix) => `${prefix}-${++sequence}`;

    const registerCanvas = (canvas) => {
        if (canvas.dataset.layaCanvasId) return;
        canvas.dataset.layaCanvasId = nextId('canvas');
        state.canvases.push(canvas);
    };

    const wrapEChartsInit = (init) => {
        if (typeof init !== 'function' || init.__layaWrapped) return init;
        const wrappedInit = function (...args) {
            const instance = init.apply(this, args);
            if (instance) state.echarts.push(instance);
            return instance;
        };
        wrappedInit.__layaWrapped = true;
        return wrappedInit;
    };

    const wrapECharts = (echarts) => {
        if (!echarts || (typeof echarts !== 'object' && typeof echarts !== 'function'))
            return echarts;
        // Direct shape: init is already present when the namespace is assigned.
        if (typeof echarts.init === 'function') {
            if (!echarts.init.__layaWrapped) echarts.init = wrapEChartsInit(echarts.init);
            return echarts;
        }
        // Real UMD shape: the bundle assigns an empty namespace first
        // (window.echarts = {}) and populates init later
        // (window.echarts.init = fn). Install an accessor so the later
        // assignment is intercepted and wrapped.
        if (Object.getOwnPropertyDescriptor(echarts, 'init')?.get) return echarts;
        let currentInit;
        Object.defineProperty(echarts, 'init', {
            configurable: true,
            enumerable: true,
            get: () => currentInit,
            set: (next) => {
                currentInit = wrapEChartsInit(next);
            },
        });
        return echarts;
    };

    const wrapMapbox = (mapbox) => {
        if (!mapbox?.Map || mapbox.Map.__layaWrapped) return mapbox;
        const OriginalMap = mapbox.Map;
        class LayaMap extends OriginalMap {
            constructor(...args) {
                super(...args);
                state.maps.push(this);
            }
        }
        LayaMap.__layaWrapped = true;
        Object.defineProperty(mapbox, 'Map', {
            configurable: true,
            writable: true,
            value: LayaMap,
        });
        return mapbox;
    };

    const defineWrappedGlobal = (name, wrap) => {
        let value;
        Object.defineProperty(window, name, {
            configurable: true,
            enumerable: true,
            get: () => value,
            set: (next) => {
                value = wrap(next);
            },
        });
    };

    defineWrappedGlobal('echarts', wrapECharts);
    defineWrappedGlobal('mapboxgl', wrapMapbox);

    const observeDocument = () => {
        for (const canvas of document.querySelectorAll('canvas')) registerCanvas(canvas);
        const observer = new MutationObserver(() => {
            for (const canvas of document.querySelectorAll('canvas')) registerCanvas(canvas);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) observeDocument();
    else window.addEventListener('DOMContentLoaded', observeDocument, { once: true });

    window.__layaRuntime = {
        snapshot() {
            return {
                canvases: state.canvases.map((canvas) => ({
                    id: canvas.dataset.layaCanvasId,
                    width: canvas.width,
                    height: canvas.height,
                })),
                echarts: state.echarts.map((instance, index) => ({
                    id: `echarts-${index + 1}`,
                    series: instance.getOption?.()?.series?.length || 0,
                })),
                maps: state.maps.map((map, index) => ({
                    id: `map-${index + 1}`,
                    center: map.getCenter?.()
                        ? {
                              lng: map.getCenter().lng,
                              lat: map.getCenter().lat,
                          }
                        : map.center || null,
                    zoom: map.getZoom?.() ?? map.zoom ?? null,
                })),
            };
        },
    };
}
