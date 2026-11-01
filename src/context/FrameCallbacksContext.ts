import { createContext } from "react";
import type { AnimationFrameCallback } from "@/types/store";

export const FrameCallbacksContext = createContext<AnimationFrameCallback[] | null>(null);
