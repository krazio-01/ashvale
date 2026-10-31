import { createStore, persistInStorage } from "@/store/createStore";
import { createHudSlice } from "@/store/hudSlice";
import { createSettingsSlice, isAllowedSetting } from "@/store/settingsSlice";
import { DEFAULT_SETTINGS } from "@/constants/ui";
import { STORAGE_KEYS } from "@/constants/strings";
import type { IStoreState } from "@/types/store";

export const store = createStore<IStoreState>((set, get) => ({
    hud: createHudSlice(set, get),
    settings: createSettingsSlice(set),
}));

persistInStorage(store, {
    storageKey: STORAGE_KEYS.gameSettings,
    defaults: DEFAULT_SETTINGS,
    isAllowed: isAllowedSetting,
    select: (state) => state.settings.values,
    restore: (state, values) => ({ settings: { ...state.settings, values } }),
});
