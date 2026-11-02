"use client";
import { useStore } from "zustand";
import { store } from "@/store/store";
import type { IStoreState } from "@/types/store";

export function useGameStore<Selected>(selector: (state: IStoreState) => Selected): Selected {
    return useStore(store, selector);
}
