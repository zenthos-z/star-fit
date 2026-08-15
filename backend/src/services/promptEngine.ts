import { ConfigRepo } from "./knowledgeRepo.js";

type SceneTemplate = {
  name: string;
  style: string;
  background: string;
  texture: string;
  lighting: string;
  character: string;
};

export const SCENE_TEMPLATES: Record<string, SceneTemplate> = {
  Industrial_Dark: {
    name: "工业重金属 (DEFAULT)",
    style: "Acid Graphics, Maximalism, David Carson Grunge Style",
    background: "Dark, moody close-up of a Squat Rack (Industrial metal, scratched, oily surfaces)",
    texture: "Heavy grainy noise, scan-line textures, vintage film dust",
    lighting: "High-contrast Cyberpunk Blue & Purple rim lights, hard shadows",
    character:
      "Flat 2D neon-orange fluid abstract blob, wearing a fierce determination expression (咆哮/发力感), emanating fighting spirit in a combative stance"
  },
  Liquid_Chrome: {
    name: "超限流体 (LIQUID_CHROME)",
    style: "Ultra-high contrast, Liquid Metal Acid, Organic Distortion, Y2K Chromaticism",
    background: "Deep matte black with iridescent oil spill reflections, macro view of distorted chrome dumbbells",
    texture: "Chromatic aberration, liquid mercury ripples, high-gloss plastic finish, spectral gradients",
    lighting: "Hard Neon Green and Hot Pink top-down spotlighting, sharp caustic light refractions",
    character:
      "An amorphous 3D chrome liquid entity, sharp jagged edges, reflecting the entire gym environment on its surface, high-intensity combative posture"
  },
  Cyber_Neon: {
    name: "赛博霓虹 (HYPER-VIBE)",
    style: "Cyber-Acid, Neo-Tokyo, Futuristic Grunge",
    background: "Blurry neon city gym lights, reflections on chrome plates",
    texture: "Digital glitch, pixel noise, glowing screen edge",
    lighting: "Neon Pink and Electric Cyan bi-color lighting, hyper-glow",
    character: "Electric blue holographic creature, muscular silhouette, dynamic motion blur"
  },
  Vintage_Punk: {
    name: "复古朋克 (OLD_SCHOOL)",
    style: "90s Zine Culture, Punk Rock Xerox Style",
    background: "High-contrast photocopied gym environment, gritty black and white",
    texture: "Paper grain, ink bleed, halftone patterns",
    lighting: "Stark flash photography style, high-key white and deep blacks",
    character: "Sketch-style orange ink blob, raw brush strokes, chaotic energy"
  }
};

type VibeConfig = {
  brandingName?: string;
  slogans?: string;
  palette?: string;
  brandingStyle?: string;
};

type UserData = {
  Nickname?: string;
  Date?: string;
  Duration?: string;
  Workout_List?: unknown;
};

class AcidVisualEngine {
  constructor(private userData: UserData, private scene: SceneTemplate, private vibe: VibeConfig) {}

  generateFinalPrompt() {
    const { Date: dateStr, Duration, Workout_List } = this.userData;
    const finalNickname = this.vibe.brandingName || this.userData.Nickname || "ANONYMOUS";
    return `
# SYSTEM ROLE: ACID_POSTER_AI_SYSTEM
# TASK: 严格按照以下渲染函数逻辑执行，生成一张 3:4 比例的酸性风格海报图片。

// ==========================================
// 🎨 执行函数: Render_Poster(Final_Data)
// ==========================================

FUNCTION Render_Poster(Final_Data):

    // [1. 视觉场景构建 (The Scene)] -> 【前置输入：选择模板】
    SET Scene_Setup:
        Style           = "${this.scene.style}"
        Background      = "${this.scene.background}"
        Texture         = "${this.scene.texture}"
        Lighting        = "${this.scene.lighting}"
        Character       = "${this.scene.character}"

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
        ${JSON.stringify(Workout_List, null, 2)}

    // [3. 氛围填充元素 (The Vibe)] -> 【前置输入：手动修改】
    SET Atmosphere_Elements:
        Texts_FX        = {
            "Slogans": "${this.vibe.slogans}",
            "Glitch": "应用字符位移/重复故障效果 (e.g., L-L-LEG D-DAY)",
            "Layout": "在画面左右边缘添加垂直排布的条形码 (║█║▌║█║▌│║▌)"
        }
        Color_Palette   = "${this.vibe.palette}"
        Branding        = "Render ${finalNickname} in ${this.vibe.brandingStyle}"
        Time_Widget     = "Digital clock box (8-bit style) displaying ${Duration} / ${dateStr}"
        Industrial_Noise= "随机填充代码: [BATCH_NO: 20251218-A], [PRESSURE: CRITICAL]"

    // [4. 执行合成]
    RETURN Image(Combine(Scene_Setup, Data_Block_Container, Atmosphere_Elements))

END FUNCTION

// ==========================================
📝 最终约束规格 (Final Specs):
- Ratio: 3:4
- Format: 图片 (Image)
- Principle: 严禁精简细节。保持排版破碎感，保持每个文字元素的精准风格和空间位置。

请立即渲染生成。
`;
  }
}

export async function buildPosterPrompt(session: UserData, templateKey?: string, vibeOverride?: VibeConfig, userId: string = 'global') {
  // Try to load user-specific template if it exists in DB
  let scene: SceneTemplate | undefined;
  
  if (templateKey) {
    // 1. Check if user has a custom style config for this key
    const customParams = await ConfigRepo.getStyleParams(userId, templateKey);
    if (customParams && Object.keys(customParams).length > 0) {
      // Map blocks to SceneTemplate (Assuming blocks can be converted)
      // For now, if we have custom blocks, we might need a different builder
      // But for image templates, let's assume they might store the template object directly in app_configs
    }
    
    // 2. Fallback to hardcoded templates
    scene = SCENE_TEMPLATES[templateKey];
  }

  const key = templateKey && SCENE_TEMPLATES[templateKey] ? templateKey : "Industrial_Dark";
  scene = scene || SCENE_TEMPLATES[key];

  const defaultVibe: VibeConfig = {
    brandingName: session.Nickname || "ANONYMOUS",
    slogans: "SYSTEM OVERLOAD, LEG DAY, NO PAIN NO GAIN, LOWER BODY POWER",
    palette: "High contrast Neon Orange (#FF5F1F) vs Midnight Blue (#000080)",
    brandingStyle: "Chrome Metallic 3D style (带有流体反光的镀铬质感)"
  };

  // Check for user-specific default vibe in app_configs
  const userVibe = await ConfigRepo.getConfig(userId, 'poster_vibe_config');
  
  const engine = new AcidVisualEngine(session, scene, { ...defaultVibe, ...userVibe, ...vibeOverride });
  return engine.generateFinalPrompt();
}

