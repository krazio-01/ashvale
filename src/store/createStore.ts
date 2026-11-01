import type {
    IPersistOptions,
    IStoreApi,
    SetState,
    StateCreator,
    StoreListener,
} from "@/types/store";

export function createStore<State extends object>(
    initializer: StateCreator<State>
): IStoreApi<State> {
    const listeners = new Set<StoreListener<State>>();
    let state: State;

    const setState: SetState<State> = (partial) => {
        const changes = typeof partial === "function" ? partial(state) : partial;
        if (Object.is(changes, state)) return;

        const previousState = state;
        state = { ...state, ...changes };
        for (const listener of listeners) listener(state, previousState);
    };

    const getState = (): State => state;
    state = initializer(setState, getState);
    const initialState = state;

    return {
        getState,
        getInitialState: () => initialState,
        setState,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export function persistInStorage<State extends object, Saved extends object>(
    storeApi: IStoreApi<State>,
    { storageKey, defaults, isAllowed, select, restore }: IPersistOptions<State, Saved>
): void {
    if (typeof window === "undefined") return;

    const loadSaved = (): Saved => {
        const restored = { ...defaults };
        try {
            const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
            if (!saved || typeof saved !== "object") return restored;

            for (const key of Object.keys(defaults) as (keyof Saved)[]) {
                const candidate = saved[key];
                if (typeof candidate !== typeof defaults[key] || !isAllowed(key, candidate))
                    continue;
                restored[key] = candidate;
            }
        } catch {}
        return restored;
    };

    const save = (state: State, previousState: State): void => {
        const saved = select(state);
        if (saved === select(previousState)) return;
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(saved));
        } catch {}
    };

    storeApi.setState((state) => restore(state, loadSaved()));
    storeApi.subscribe(save);
}
