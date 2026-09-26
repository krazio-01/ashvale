import type { IStoreState } from "@/types/store";

export type AnimationFrameCallback = (state: IStoreState, deltaSeconds: number) => void;
