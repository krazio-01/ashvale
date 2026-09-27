import type { IStoreApi, SetState, StateCreator, StoreListener } from "@/types/store";

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
