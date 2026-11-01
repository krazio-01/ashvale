"use client";
import { useSyncExternalStore } from "react";
import type { IStoreApi } from "@/types/store";

export function useStoreState<State, Selected>(
    storeApi: IStoreApi<State>,
    selector: (state: State) => Selected
): Selected {
    return useSyncExternalStore(
        storeApi.subscribe,
        () => selector(storeApi.getState()),
        () => selector(storeApi.getInitialState())
    );
}
