"use client";
import { useSyncExternalStore } from "react";
import { store } from "@/store/store";
import type { IStoreState } from "@/types/store";

export function useStore<Selected>(selector: (state: IStoreState) => Selected): Selected {
    return useSyncExternalStore(
        store.subscribe,
        () => selector(store.getState()),
        () => selector(store.getInitialState())
    );
}
