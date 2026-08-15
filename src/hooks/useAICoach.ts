import { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getUserId } from '../../services';
// P010 signature-frozen seam: this hook consumes the SSE stream
// (chat(req): AsyncIterable<AgentEvent>) and synthesizes renderable uiHint cards,
// with no awareness of the backend agent implementation.
import { agentClient, consumeAgentStream, synthesizeUiHint } from '../v2/services/agent/sseAgentClient';
import { AiScenario } from '../../types';
// The saveChatDraft/loadChatDraft functions were removed from storage/index.ts.
// Remove the calls below to keep the compile clean.
// import { saveChatDraft, loadChatDraft } from '../../storage';
// (import removed — the calls that follow are commented out below)

export interface ChatMessage {
    role: 'user' | 'ai';
    text: string;
    planData?: any[];
    isThinking?: boolean;
    uiHint?: any;
    interruptId?: string;
    agentTrace?: string;
}

export const useAICoach = (
    session: any, 
    history: any[], 
    aiConfig: any,
    onPlanConfirm: (plan: any[], mode: 'append' | 'replace') => void
) => {
    const [isAiOverlayOpen, setIsAiOverlayOpen] = useState(false);
    const [isPlanMode, setIsPlanMode] = useState(false);
    const [chatMessage, setChatMessage] = useState("");
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    
    // loadChatDraft removed — draft persistence feature was dropped
    // if (session?.id) {
    //     loadChatDraft(session.id).then(draft => {
    //         if (draft && draft.length > 0) {
    //             setChatHistory(draft);
    //         }
    //     });
    // }

    // [NEW] Save chat draft to IndexedDB (disabled — saveChatDraft removed from storage)
    /* useEffect(() => {
        if (session?.id && chatHistory.length > 0) {
            saveChatDraft(session.id, chatHistory);
        }
    }, [chatHistory, session?.id]); */

    const chatEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        if (isAiOverlayOpen) {
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chatHistory, isAiOverlayOpen]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
    }, [chatMessage]);

    const handleChatSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!chatMessage.trim()) return;

        const userMsg = chatMessage;
        setChatMessage("");

        // [SPECIAL] Check for preview command
        if (userMsg.trim() === '/preview-all-bubbles') {
            const previewMessages: ChatMessage[] = [
                { role: 'user', text: '/preview-all-bubbles' },
                { 
                    role: 'ai', 
                    text: '## 预览所有特殊气泡',
                    uiHint: {
                        type: 'workout_plan',
                        data: [
                            { name: '杠铃卧推', type: 'resistance_standard', sets: [{ weight: 60, reps: 10 }] },
                            { name: '跑步机', type: 'cardio_running', duration: 10, intensity: 5 }
                        ]
                    }
                },
                {
                    role: 'ai',
                    text: '正在为您生成结算报告...',
                    uiHint: {
                        type: 'workout_summary',
                        data: {
                            stats: {
                                totalVolume: 1200,
                                setsCount: 12,
                                durationMinutes: 45,
                                avgHr: 135
                            },
                            exercises: [
                                { name: '杠铃卧推', type: 'resistance_standard', result: '3组 x 10次 @ 60kg' },
                                { name: '跑步机', type: 'cardio_running', result: '10分钟 @ 5.0km/h' }
                            ]
                        }
                    }
                }
            ];
            setChatHistory(prev => [...prev, ...previewMessages]);
            return;
        }

        setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);

        if (textareaRef.current) textareaRef.current.style.height = '56px';

        setIsLoading(true);
        // [NEW] Add a thinking message
        setChatHistory(prev => [...prev, { role: 'ai', text: '', isThinking: true }]);

        try {
            // [UPDATED] Consume the SSE agent stream via the frozen seam
            const scenario = isPlanMode ? "plan" : "chat";
            const result = await consumeAgentStream(agentClient.chat({
                userId: getUserId(),
                message: userMsg,
                scenario: scenario
            }));

            console.log("[useAICoach] Received agent result:", result);

            const uiHint = synthesizeUiHint(result.card);

            // [DEBUG] Log plan data if present
            if (uiHint?.type === 'plan_card' && Array.isArray(uiHint.data)) {
                console.log("[useAICoach] Plan card data from backend:", uiHint.data.map((ex: any) => ({
                    id: ex?.id,
                    name: ex?.name,
                    exercise_type: ex?.exercise_type,
                    exerciseType: ex?.exerciseType,
                    type: ex?.type,
                    sets: ex?.sets,
                    reps: ex?.reps
                })));
            }

            // [NEW] Remove thinking message and add real response
            setChatHistory(prev => {
                const filtered = prev.filter(m => !m.isThinking);
                const finalMsg = {
                    role: 'ai' as const,
                    text: result.error ? "抱歉，我现在无法回复，请稍后再试。" : String(result.text || ""),
                    uiHint,
                    agentTrace: undefined
                };
                console.log("[useAICoach] Final AI Message Object:", finalMsg);
                return [...filtered, finalMsg];
            });
        } catch (err) {
            console.error("Chat Error:", err);
            setChatHistory(prev => [...prev.filter(m => !m.isThinking), { role: 'ai', text: "抱歉，我现在无法回复，请稍后再试。" }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirmPlan = (planData: any[], mode: 'append' | 'replace') => {
        onPlanConfirm(planData, mode);
        setIsAiOverlayOpen(false);
        // 清除 planData 防止重复显示卡片
        setChatHistory(prev => prev.map(m => m.planData ? { ...m, planData: undefined } : m));
    };

    const openAiCoach = (mode: 'chat' | 'plan' = 'chat') => {
        setIsPlanMode(mode === 'plan');
        setIsAiOverlayOpen(true);
    };

    const sendMessage = async (text: string) => {
        setChatHistory(prev => [...prev, { role: 'user', text }]);
        setIsLoading(true);
        try {
            const result = await consumeAgentStream(agentClient.chat({
                userId: getUserId(),
                message: text
            }));
            setChatHistory(prev => [...prev, {
                role: 'ai',
                text: result.error ? "抱歉，我现在无法回复，请稍后再试。" : (result.text || ""),
                uiHint: synthesizeUiHint(result.card),
                agentTrace: undefined
            }]);
        } catch (err) {
            console.error("Send Message Error:", err);
            setChatHistory(prev => [...prev, { role: 'ai', text: "抱歉，我现在无法回复，请稍后再试。" }]);
        } finally {
            setIsLoading(false);
        }
    };

    return {
        isAiOverlayOpen,
        setIsAiOverlayOpen,
        isPlanMode,
        setIsPlanMode,
        chatMessage,
        setChatMessage,
        chatHistory,
        setChatHistory,
        isLoading,
        handleChatSubmit,
        handleConfirmPlan,
        openAiCoach,
        sendMessage,
        chatEndRef,
        textareaRef
    };
};
