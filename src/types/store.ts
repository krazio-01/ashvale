import type { StoreApi } from "zustand/vanilla";
import type { IGameSettings, IHudSlice, IQualityReport, ISettingsSlice } from "@/types/ui";

export type SetState<State> = StoreApi<State>["setState"];

export type GetState<State> = StoreApi<State>["getState"];

export type SessionPhase = "loading" | "probing" | "ready" | "playing" | "ended";

export interface ISessionSlice {
    phase: SessionPhase;
    chapterIndex: number;
    isPaused: boolean;
    qualityReport: IQualityReport | null;
    beginChapter(chapterIndex: number): void;
    setPhase(phase: SessionPhase): void;
    setPaused(isPaused: boolean): void;
    clearChapter(realmKey: string, chapterCount: number): void;
    setQualityReport(report: IQualityReport | null): void;
}

export type LoreKind = "stone" | "enemy" | "boss";

export interface ILoreEntry {
    id: string;
    kind: LoreKind;
    chapterIndex: number;
    title: string;
    lines: readonly string[];
}

export interface IRestingShrine {
    chapterIndex: number;
    shrineId: string;
}

export interface IRealmProgress {
    chapterReached: number;
    restingShrine: IRestingShrine | null;
    lore: ILoreEntry[];
}

export interface IProgressionSlice {
    records: Record<string, IRealmProgress>;
    reachChapter(realmKey: string, chapterIndex: number): void;
    restAt(realmKey: string, restingShrine: IRestingShrine): void;
    addLore(realmKey: string, entry: ILoreEntry): void;
}

export interface IChapterProgress {
    realmKey: string;
    chapterCount: number;
}

export interface IStoreState {
    hud: IHudSlice;
    settings: ISettingsSlice;
    session: ISessionSlice;
    progression: IProgressionSlice;
}

export interface IPersistedState {
    settings: IGameSettings;
    progression: Record<string, IRealmProgress>;
}

export interface IPersistedSlice<Saved> {
    save(state: IStoreState): Saved;
    restore(saved: unknown, current: IStoreState): Partial<IStoreState>;
}

export type AnimationFrameCallback = (state: IStoreState, deltaSeconds: number) => void;
