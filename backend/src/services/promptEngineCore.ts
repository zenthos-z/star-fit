import { ConfigRepo, KnowledgeRepo } from "./knowledgeRepo.js";

export type BlockType = 
  | 'GUIDANCE' 
  | 'HISTORY' 
  | 'HISTORY_FULL' 
  | 'RPE' 
  | 'ACTION_LIST' 
  | 'ACTION_DETAIL' 
  | 'USER_PROFILE' 
  | 'USER_INPUT' 
  | 'STATIC';

export interface PromptBlock {
  id: string;
  type: BlockType;
  name: string;
  isEnabled: boolean;
  content?: string;
}

export interface ContextPack {
  system: string;
  strategy: string;
  history: string;
  memory: string;
  registryExtras: Record<string, any>;
}

export class PromptEngineCore {
  static async buildContextPack(userId: string, scenario: string, context: any = {}): Promise<ContextPack> {
    const systemPrompt = await this.buildSystemPrompt(userId, scenario, context);
    
    // In a real implementation, these would come from the database/repos
    // For now, we mock or pull from existing KnowledgeRepo
    const strategy = "本月重点：加强核心稳定性与下肢力量。";
    const history = "最近三次训练：深蹲 (12/20), 卧推 (12/22), 硬拉 (12/25)。";
    const memory = context.userInput || "";

    return {
      system: systemPrompt,
      strategy,
      history,
      memory,
      registryExtras: {
        userId,
        scenario,
        timestamp: Date.now()
      }
    };
  }

  static async buildSystemPrompt(userId: string, scenario: string, context: any = {}): Promise<string> {
    // 1. Load blocks from DB
    const blocks = await ConfigRepo.getStyleParams(userId, scenario) as PromptBlock[];
    
    if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
      return this.getDefaultPrompt(scenario);
    }

    // 2. Resolve each block
    const resolvedBlocks = await Promise.all(blocks.map(async (block) => {
      if (!block.isEnabled) return '';

      switch (block.type) {
        case 'STATIC':
          return block.content || '';
        
        case 'GUIDANCE':
          const guidance = await KnowledgeRepo.getAllGuidance(userId) as any[];
          return guidance.map((g) => g.content_md).join('\n\n');
        
        case 'ACTION_LIST':
          const exercises = await KnowledgeRepo.getAllExercises() as any[];
          return `可用动作库:\n${exercises.map((ex) => `- ${ex.name}`).join('\n')}`;
        
        case 'USER_PROFILE':
          return `用户 ID: ${userId}\n目标: 增肌/减脂 (从配置读取)\n当前状态: 活跃`;

        case 'USER_INPUT':
          return context.userInput ? `用户当前输入: ${context.userInput}` : '';

        default:
          return `[Block: ${block.name} (Pending Implementation)]`;
      }
    }));

    return resolvedBlocks.filter((b: string) => b.length > 0).join('\n\n');
  }

  private static getDefaultPrompt(scenario: string): string {
    switch (scenario) {
      case 'plan':
        return '你是一个专业的健身教练，请为用户制定科学的训练计划。';
      case 'chat':
        return '你是一个友好的健身助手，能够回答关于运动和健康的问题。';
      case 'TUTORIAL':
        return '你是一个专业的健身百科全书，擅长解释复杂的动作细节和纠正错误。';
      default:
        return '你是一个健身 AI 助手。';
    }
  }
}
