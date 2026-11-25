import { STYLE } from "@/constants/world";
import { glslFloat } from "@/shaders/sharedGlsl";

export const GRADE_FRAGMENT_SHADER = `
    uniform vec3 whiteBalance;
    uniform float vignette;

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 centred = uv - 0.5;
        outputColor = vec4(
            inputColor.rgb * whiteBalance * (1.0 - vignette * dot(centred, centred) * 2.0),
            inputColor.a
        );
    }
`;

const { displayGamma, lumaWeights } = STYLE.grade.punch;

export const PUNCH_FRAGMENT_SHADER = `
    uniform float contrast;
    uniform float saturation;

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 display = pow(clamp(inputColor.rgb, 0.0, 1.0), vec3(${glslFloat(1 / displayGamma)}));
        float luma = dot(display, vec3(${lumaWeights.map(glslFloat).join(", ")}));
        display = mix(vec3(luma), display, saturation);
        display = (display - 0.5) * contrast + 0.5;
        outputColor = vec4(pow(clamp(display, 0.0, 1.0), vec3(${glslFloat(displayGamma)})), inputColor.a);
    }
`;
