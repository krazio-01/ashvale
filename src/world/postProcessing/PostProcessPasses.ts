import { BlendFunction, Effect } from "postprocessing";
import { Uniform, Vector3 } from "three";
import { STYLE } from "@/constants/world";
import { GRADE_FRAGMENT_SHADER, PUNCH_FRAGMENT_SHADER } from "@/shaders/colourGrade";

class ColourEffect extends Effect {
    constructor(name: string, shader: string, uniforms: Map<string, Uniform<unknown>>) {
        super(name, shader, { blendFunction: BlendFunction.NORMAL, uniforms });
    }
}

export function createColourEffects() {
    const { whiteBalance, vignette, punch } = STYLE.grade;

    const gradeUniforms = new Map<string, Uniform<unknown>>();
    gradeUniforms
        .set(
            "whiteBalance",
            new Uniform(new Vector3(whiteBalance.red, whiteBalance.green, whiteBalance.blue))
        )
        .set("vignette", new Uniform(vignette));

    const punchUniforms = new Map<string, Uniform<unknown>>();
    punchUniforms.set("saturation", new Uniform(1 + punch.amount * punch.saturation));

    return {
        grade: new ColourEffect("GradeEffect", GRADE_FRAGMENT_SHADER, gradeUniforms),
        punch: new ColourEffect("PunchEffect", PUNCH_FRAGMENT_SHADER, punchUniforms),
    };
}
