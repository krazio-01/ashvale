"use client";
import type { RefObject } from "react";

const LandingHud = ({
    bearingLabelRef,
    compassRingRef,
}: {
    bearingLabelRef: RefObject<HTMLSpanElement | null>;
    compassRingRef: RefObject<HTMLDivElement | null>;
}) => (
    <div className="landing-hud">
        <div className="landing-compass">
            <div className="landing-compass-dial">
                <div className="landing-compass-ring" ref={compassRingRef}>
                    <span className="landing-compass-dot" />
                </div>
            </div>
            <span className="landing-compass-value" ref={bearingLabelRef}>
                000°
            </span>
        </div>
        <span className="landing-hud-hint">drag or scroll to orbit</span>
    </div>
);

export default LandingHud;
