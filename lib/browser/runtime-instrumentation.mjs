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

    const runtimeError = (code, message) => ({
        __layaRuntimeError: { code, message },
    });

    const resolveRuntimeInstance = (instances, prefix, id) => {
        if (id !== undefined) {
            const index = instances.findIndex(
                (_, candidateIndex) => prefix + '-' + (candidateIndex + 1) === id,
            );
            if (index === -1)
                return runtimeError(
                    'ambiguous-query',
                    'Runtime id did not match an instance: ' + id,
                );
            return { instance: instances[index] };
        }
        if (instances.length === 1) return { instance: instances[0] };
        if (instances.length > 1)
            return runtimeError(
                'ambiguous-query',
                'Runtime action requires an id because ' +
                    instances.length +
                    ' instances are available',
            );
        return undefined;
    };

    window.__layaRuntime = {
        invoke(action, rawArgs) {
            const args = rawArgs ?? {};
            if (action === 'map.center') {
                if (!Number.isFinite(args.lng) || !Number.isFinite(args.lat))
                    return runtimeError(
                        'invalid-command',
                        'map.center requires finite lng and lat',
                    );
                if (args.lng < -180 || args.lng > 180 || args.lat < -90 || args.lat > 90)
                    return runtimeError(
                        'invalid-command',
                        'map.center requires lng in [-180, 180] and lat in [-90, 90]',
                    );
                const target = resolveRuntimeInstance(state.maps, 'map', args.id);
                if (!target) return undefined;
                if (target.__layaRuntimeError) return target;
                const map = target.instance;
                if (typeof map.setCenter === 'function') map.setCenter([args.lng, args.lat]);
                else map.center = { lng: args.lng, lat: args.lat };
                const center = typeof map.getCenter === 'function' ? map.getCenter() : map.center;
                return { center: center || { lng: args.lng, lat: args.lat } };
            }
            if (action === 'map.zoom') {
                if (!Number.isFinite(args.zoom))
                    return runtimeError('invalid-command', 'map.zoom requires a finite zoom');
                const target = resolveRuntimeInstance(state.maps, 'map', args.id);
                if (!target) return undefined;
                if (target.__layaRuntimeError) return target;
                const map = target.instance;
                if (typeof map.setZoom === 'function') map.setZoom(args.zoom);
                else map.zoom = args.zoom;
                const zoom = typeof map.getZoom === 'function' ? map.getZoom() : map.zoom;
                return { zoom: zoom ?? args.zoom };
            }
            if (action === 'echarts.option') {
                const target = resolveRuntimeInstance(state.echarts, 'echarts', args.id);
                if (!target) return undefined;
                if (target.__layaRuntimeError) return target;
                return target.instance?.getOption?.() || undefined;
            }
            return undefined;
        },
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
