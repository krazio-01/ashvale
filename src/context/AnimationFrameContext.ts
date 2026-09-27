import { createContext } from "react";
import type { AnimationFrameCallback } from "@/types/animationFrame";

export const AnimationFrameContext = createContext<AnimationFrameCallback[] | null>(null);
