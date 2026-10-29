import { createContext } from "react";
import type { AnimationFrameCallback } from "@/types/store";

export const AnimationFrameContext = createContext<AnimationFrameCallback[] | null>(null);
