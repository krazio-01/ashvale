import { CONTROL_REFERENCE } from "@/constants/controls";
import "./controlsReference.scss";

export const ControlsReference = () => (
    <div className="controls-reference">
        {CONTROL_REFERENCE.map((group) => (
            <div className="controls-group" key={group.title}>
                <h2 className="controls-group-title">{group.title}</h2>
                {group.entries.map((entry) => (
                    <div className="control-entry" key={entry.action}>
                        <div className="control-keys">
                            {entry.keys.map((key, index) => (
                                <kbd key={index}>{key}</kbd>
                            ))}
                        </div>
                        <div className="control-info">
                            <span className="control-action">{entry.action}</span>
                            <span className="control-desc">{entry.description}</span>
                        </div>
                    </div>
                ))}
            </div>
        ))}
    </div>
);

export default ControlsReference;
