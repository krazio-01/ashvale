import type { IHudSlice } from "@/types/hud";

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

export interface IStoreState {
    hud: IHudSlice;
}
