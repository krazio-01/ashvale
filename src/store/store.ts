import { createStore } from "@/store/createStore";
import { createHudSlice } from "@/store/slices/hudSlice";
import type { IStoreState } from "@/types/store";

export const store = createStore<IStoreState>((set, get) => ({
    hud: createHudSlice(set, get),
}));
