import { ExtractedWorkoutData, ExerciseItem } from './dataExtractor';
import { ShanShuiConfig, BauhausConfig, AcidConfig } from '../styles/types';

export interface TemplateContext {
  data: ExtractedWorkoutData;
  config: ShanShuiConfig | BauhausConfig | AcidConfig;
  vibeConfig?: VibeConfig;
}

export interface VibeConfig {
  brandingName?: string;
  slogans?: string;
  palette?: string;
  brandingStyle?: string;
}

export function generateShanShuiTemplate(context: TemplateContext): string {
  const { data, config } = context;
  
  const exerciseLines = data.exercises.map((ex, index) => {
    const lineNum = index + 1;
    const content = `"${ex.name}     ${ex.sets}"`;
    return `            Line_${lineNum}: ${content.padEnd(40)} // Center`;
  }).join('\n');

  return `JavaScript

# SYSTEM ROLE: SHANSHUI_ATHLETE_V1_FRAMED (V1画风·竖线框定系统)
# TASK: Generate a 3:4 fitness poster with V1 aesthetics, CENTER-ALIGNED typography framed by vertical lines, and specific spatial depth instructions.

// ==========================================
// 🎨 RENDER FUNCTION: Execute_Framed_Jade_Layout(Data)
// ==========================================

FUNCTION Execute_Framed_Jade_Layout(Data):

    // [1. VISUAL FOUNDATION: STRICT V1 AESTHETICS]
    // Ref: The EXACT description from your first successful image.
    // KEYWORDS: Blue-white jade walls, Ancient Pavilions, Sheep, White Dew Rain.
    SET Background_Environment:
        Architecture   = "Towering ancient pavilions with Blue-White Jade walls (蓝白玉墙). Texture is cold, hard, wet stone, emerging from mist."
        Nature_Scene   = "Lush pine trees surrounding the water. Wet grasslands. White sheep walking in the distance."
        Atmosphere     = "White Dew (白露) Season. Fine, vertical rain streaks (white lines) creating a rhythmic screen over the whole image."
        Style_Lock     = "Green Ink Painting Style (青绿山水) but with 8K Resolution and delicate brushstrokes. Aerial Perspective."

    // [2. TYPOGRAPHY: CENTERED WITH VERTICAL FRAMES]
    // CRITICAL: Center Alignment + Vertical Side Lines.
    SET Training_Matrix:
        Composition    = "Strict Center Alignment (居中对齐)."
        Decoration     = "Two simple, thin vertical lines (竖线) framing the text block on the Left and Right sides. No horizontal lines."
        Spacing        = "Generous Leading. The text floats in the center."
        
        Font_Style     = {
            "Chinese": "Slender Songti (Thin Serif) - Sharp, elegant.",
            "Numbers": "Modern Geometric Sans - Clean."
        }
        
        Color_Logic    = "Deep Ink Green (#0F2E28). High contrast against the pale jade background."

        // DATA CONTENT (Updated Log):
        RENDER_DATA_FLOW:
${exerciseLines}

    // [3. FOREGROUND INTERACTION: SINGLE RANDOM ELEMENT]
    // Constraint: Only ONE element. It must physically overlap/interact with the text flow.
    SET Foreground_Occluder = RANDOMLY_SELECT_ONE_FROM:
        - OPTION_A (Pine Branch / 松枝): "A realistic pine branch extending from the side, passing *between* line 2 and 3."
        - OPTION_B (White Crane / 白鹤): "A white crane flying upwards, its wingtip physically covering a small part of the text block."
        - OPTION_C (Flowing Mist / 流云): "A wisp of white mist drifting horizontally *in front of* the text list."

    // [4. IDENTITY & DECORATION]
    SET UI_Details:
        User_ID    = "${data.nickname}" (Centered Top)
        Time_Tag   = "${data.duration}" (Centered Bottom)
        Date_Stamp = "Cinnabar Red (朱砂) Seal Chop containing '${data.date}'" (Bottom corner)

    // [5. COMPOSITION ASSEMBLY & MANDATORY INSTRUCTION]
    RETURN Image(
        Layer_1_V1_Background(Background_Environment) + 
        Layer_2_Framed_Typography(Training_Matrix) + 
        Layer_3_Foreground_Single_Element(Foreground_Occluder) + 
        Layer_4_Rain_Filter(Atmosphere) +
        
        // MANDATORY SPATIAL INSTRUCTION ADDED HERE:
        Process_Rule("文字需要和背影有交错重叠的空间感") 
    )

END FUNCTION

// ==========================================
📝 FINAL PROMPT INSTRUCTIONS:
- **Visuals**: STRICTLY "Blue-white Jade Walls", "Sheep", "Pine Trees", "Rain".
- **Layout**: "Center Aligned" with "Vertical Side Lines" (两边竖线).
- **Spatial Logic**: "文字需要和背影有交错重叠的空间感" (Ensure text layers interact deeply with the background/foreground, not just floating on top).

IMMEDIATE RENDERING REQUESTED.`;
}

export function generateBauhausTemplate(context: TemplateContext): string {
  const { data, config } = context;
  
  const matrixLines = data.exercises.map(item => `            - "${item.name}     ${item.sets}"`).join('\n');

  return `# SYSTEM ROLE: BAUHAUS_ATHLETE_VISUAL_SYSTEM
# TASK: Execute the rendering function below to generate a 3:4 ratio poster with high-level architectural aesthetics and fitness-specific structural hints.

// ==========================================
// 🏗️ RENDER FUNCTION: Execute_Final_Layout(Data)
// ==========================================

FUNCTION Execute_Final_Layout(Data):

    // [1. BACKDROP & TEXTURE: Gym-Specific Subtle Cues]
    SET Background_Environment:
        Base_Color     = "Warm Architectural Grey (#D1D1D1)"
        Texture        = "Fine-grain concrete with micro-diamond knurling (Ref: Barbell grip texture)"
        Grid_Logic     = "Structural engineering grid, 1:10 scale alignment lines"
        Implicit_Cues  = {
            "Anatomy": "Ultra-thin biomechanical vector lines and joint pivots indicating force direction",
            "Hardware": "Vertical scale markings (01-20) on the edges, mimicking weight-stack pin holes",
            "Depth": "Faint silhouettes of 20KG bumper plates integrated into the background layers"
        }

    // [2. PRIMARY FOCUS: Visual Anchor (Identity)]
    SET Branding_Anchor:
        Text_Content   = "${data.nickname} 瞻"
        Font_Weight    = "Extreme Bold Sans-serif / Swiss Typeface"
        Position       = "Upper quadrant or Left-aligned Vertical, dominating the visual axis"
        Styling        = "Mix of solid black fill and thin outline stroke; partially overlapped by a Deep Cobalt Blue (#0047AB) circle"

    // [3. SECONDARY FOCUS: Core Training Matrix (Function)]
    // CRITICAL: Keep Chinese characters as a solid, high-density block.
    SET Training_Matrix:
        Composition    = "Concentrated rectangular block, high negative space surroundings to ensure legibility"
        Leading        = "Tight / Negative leading (文字块状挤压感)"
        Font           = "Geometric Heavy Gothic (SimSun/Microsoft Yahei Bold aesthetic)"
        
        RENDER_DATA_STRING:
${matrixLines}

    // [4. TERTIARY ELEMENTS: Decorative Micro-Typography]
    SET Visual_Nuances:
        English_Labels = {
            "Metadata": "BATCH_NO: ${data.date} / SYSTEM_STATUS: OPTIMIZED",
            "Parameter": "POSTURE_ALIGNMENT: ACTIVE",
            "Clock": "Digital LCD-style display: ${data.duration}"
        }
        Accent_Logic   = "Vivid Red (#E31E24) horizontal bars cutting through white space; Golden Yellow (#FFD700) geometric bullet points"

    // [5. COMPOSITION RULES: Squeeze & Release]
    RETURN Image(
        Apply_Tension(Branding_Anchor, Training_Matrix) + 
        Apply_Depth(Background_Environment, Visual_Nuances)
    )

END FUNCTION

// ==========================================
📝 FINAL SPECIFICATIONS:
- Ratio: 3:4
- Aesthetic: Cold, Precise, Professional.
- Interaction: All geometric shapes must intersect or overlap with text to create spatial tension.
- Content: NO English prefixes for Chinese training actions. Keep them clean and bold.

IMMEDIATE RENDERING REQUESTED.`;
}

export function generateAcidTemplate(context: TemplateContext): string {
  const { data, config, vibeConfig } = context;
  const finalNickname = vibeConfig?.brandingName || data.nickname || "ANONYMOUS";
  
  const workoutList = data.exercises.map(ex => ({
    name: ex.name,
    sets: ex.sets,
    weight: ex.weight,
    reps: ex.reps,
    duration: ex.duration
  }));

  const acidConfig = config as AcidConfig;

  return `
# SYSTEM ROLE: ACID_POSTER_AI_SYSTEM
# TASK: 严格按照以下渲染函数逻辑执行，生成一张 3:4 比例的酸性风格海报图片。

// ==========================================
// 🎨 执行函数: Render_Poster(Final_Data)
// ==========================================

FUNCTION Render_Poster(Final_Data):

    // [1. 视觉场景构建 (The Scene)] -> 【前置输入：选择模板】
    SET Scene_Setup:
        Style           = "${acidConfig.style}"
        Background      = "${acidConfig.background}"
        Texture         = "${acidConfig.texture}"
        Lighting        = "${acidConfig.lighting}"
        Character       = "${acidConfig.character}"

    // [2. 数据承载容器 (The Anchor)]
    SET Data_Block_Container:
        Object          = "Massive Rectangular Industrial Specification Label (磨砂半透明质感)"
        Position        = "Diagonal (倾斜 15-25 度) across the main visual anchor"
        Graphics        = {
            "Borders": "Black/Yellow diagonal warning hazard stripes (█ ░ █ ░)",
            "Details": "Micro-typography (TORQUE_CHECK, STABILITY_OK), QR codes, Functional Barcodes",
            "Texture": "Digital noise particles (░▒▓█)"
        }
        Text_Render     = "清楚显示提炼后的训练数据":
        ${JSON.stringify(workoutList, null, 2)}

    // [3. 氛围填充元素 (The Vibe)] -> 【前置输入：手动修改】
    SET Atmosphere_Elements:
        Texts_FX        = {
            "Slogans": "${vibeConfig?.slogans || 'SYSTEM OVERLOAD, LEG DAY, NO PAIN NO GAIN'}",
            "Glitch": "应用字符位移/重复故障效果 (e.g., L-L-LEG D-DAY)",
            "Layout": "在画面左右边缘添加垂直排布的条形码 (║█║▌║█║▌│║▌)"
        }
        Color_Palette   = "${vibeConfig?.palette || 'High contrast Neon Orange (#FF5F1F) vs Midnight Blue (#000080)'}"
        Branding        = "Render ${finalNickname} in ${vibeConfig?.brandingStyle || 'Chrome Metallic 3D style'}"
        Time_Widget     = "Digital clock box (8-bit style) displaying ${data.duration} / ${data.date}"
        Industrial_Noise= "随机填充代码: [BATCH_NO: ${data.date.replace(/\./g, '')}-A], [PRESSURE: CRITICAL]"

    // [4. 执行合成]
    RETURN Image(Combine(Scene_Setup, Data_Block_Container, Atmosphere_Elements))

END FUNCTION

// ==========================================
📝 最终约束规格 (Final Specs):
- Ratio: 3:4
- Format: 图片
- Principle: 严禁精简细节。保持排版破碎感，保持每个文字元素的精准风格和空间位置。

请立即渲染生成。`;
}
