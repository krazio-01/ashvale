import type { IHudSlice, ISettingsSlice } from "@/types/ui";

export type StoreListener<State> = (state: State, previousState: State) => void;

export type SetState<State> = (
    partial: Partial<State> | ((state: State) => Partial<State>)
) => void;

export type GetState<State> = () => State;

export type StateCreator<State> = (set: SetState<State>, get: GetState<State>) => State;

export interface IStoreApi<State> {
    getState: GetState<State>;
    getInitialState: GetState<State>;
    setState: SetState<State>;
    subscribe: (listener: StoreListener<State>) => () => void;
}

export interface IPersistOptions<State, Saved> {
    storageKey: string;
    defaults: Saved;
    isAllowed: (key: keyof Saved, value: unknown) => boolean;
    select: (state: State) => Saved;
    restore: (state: State, saved: Saved) => Partial<State>;
}

export interface IStoreState {
    hud: IHudSlice;
    settings: ISettingsSlice;
}

export type AnimationFrameCallback = (state: IStoreState, deltaSeconds: number) => void;
