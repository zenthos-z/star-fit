import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import ExerciseRenderer from './ExerciseRenderer';
import { ChatMessage } from '../../hooks/useAICoach';

interface AICoachOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    chatHistory: ChatMessage[];
    chatMessage: string;
    setChatMessage: (msg: string) => void;
    isLoading: boolean;
    isPlanMode: boolean;
    setIsPlanMode: (mode: boolean) => void;
    handleChatSubmit: (e?: React.FormEvent) => void;
    handleHitlResponse: (interruptId: string, payload: any) => void;
    handleConfirmPlan: (plan: any[], mode: 'append' | 'replace') => void;
    chatEndRef: React.RefObject<HTMLDivElement>;
    textareaRef: React.RefObject<HTMLTextAreaElement>;
}

const AICoachOverlay: React.FC<AICoachOverlayProps> = ({
    isOpen,
    onClose,
    chatHistory,
    chatMessage,
    setChatMessage,
    isLoading,
    isPlanMode,
    setIsPlanMode,
    handleChatSubmit,
    handleHitlResponse,
    handleConfirmPlan,
    chatEndRef,
    textareaRef
}) => {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleChatSubmit();
        }
    };

    return (
        <div className={`
            fixed inset-0 z-50 flex flex-col h-[100dvh]
            transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]
            ${isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}
            bg-white/90 backdrop-blur-2xl
        `}>
            <div className="absolute top-[-20%] left-[-20%] w-[80vw] h-[80vw] bg-blue-50/50 rounded-full blur-[100px] pointer-events-none"></div>
            <div className="absolute bottom-[-20%] right-[-20%] w-[80vw] h-[80vw] bg-indigo-50/50 rounded-full blur-[100px] pointer-events-none"></div>

            {/* Header */}
            <div className="flex-shrink-0 z-20 px-6 pt-12 pb-4 flex justify-between items-center relative">
                <div className="flex items-center gap-2.5">
                    <span className={`w-2.5 h-2.5 rounded-full bg-blue-500 ${isLoading ? 'animate-pulse' : ''}`}></span>
                    <span className="font-bold text-lg text-gray-900 tracking-tight">
                        Starfit Agent
                    </span>
                </div>
                
                <button 
                    onClick={onClose}
                    className="w-9 h-9 rounded-full bg-gray-100/80 flex items-center justify-center text-gray-500 hover:bg-gray-200 hover:text-black transition-all backdrop-blur-md"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {/* Chat Body */}
            <div className="flex-1 overflow-y-auto px-6 relative z-10 custom-scrollbar">
                {chatHistory.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center -mt-8">
                        <div className={`
                            w-24 h-24 rounded-full flex items-center justify-center mb-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white
                            bg-gradient-to-tr from-blue-50 to-white text-blue-500
                        `}>
                           <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10">
                               <path fillRule="evenodd" d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813a3.75 3.75 0 002.576-2.576l.813-2.846A.75.75 0 019 4.5zM6.97 11.03a5.25 5.25 0 00-1.348-1.348l-.91-.26a.5.5 0 010-.96l.91-.26a5.25 5.25 0 001.348-1.348l.26-.91a.5.5 0 01.96 0l.26.91a5.25 5.25 0 001.348 1.348l.91.26a.5.5 0 010 .96l-.91.26a5.25 5.25 0 00-1.348 1.348l-.26.91a.5.5 0 01-.96 0l-.26-.91z" clipRule="evenodd" />
                           </svg>
                        </div>
                        
                        <h3 className="text-2xl font-black text-gray-800 mb-3 tracking-tight">AI Agent Ready</h3>
                        <p className="text-gray-400 text-sm max-w-[260px] text-center leading-relaxed mb-10">
                            已加载 MAS 多智能体架构。<br/>
                            <span className="text-xs text-gray-300">Strategy • History • Core • Memory</span>
                        </p>
                    </div>
                ) : (
                    <div className="space-y-6 pt-4 pb-4">
                        {chatHistory.map((msg, i) => (
                            <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2`}>
                                {msg.isThinking && (
                                    <div className="px-5 py-3 rounded-2xl bg-gray-100/50 text-gray-400 text-sm flex items-center gap-2 mb-2">
                                        <div className="w-2 h-2 rounded-full bg-gray-300 animate-bounce"></div>
                                        <span className="font-mono text-xs">AGENT PROCESSING</span>
                                    </div>
                                )}

                                {!msg.isThinking && (
                                    <div className={`
                                        px-4 py-3 rounded-2xl text-sm leading-7 max-w-[95%] shadow-sm overflow-hidden markdown-body
                                        ${msg.role === 'user' 
                                            ? 'bg-star-dark text-white rounded-tr-sm' 
                                            : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm'
                                        }
                                    `}>
                                        <ReactMarkdown 
                                            remarkPlugins={[remarkGfm, remarkMath]}
                                            rehypePlugins={[rehypeKatex]}
                                        >
                                            {msg.text || (msg.uiHint ? "智能教练为您准备了以下建议：" : "正在同步回复...")}
                                        </ReactMarkdown>
                                    </div>
                                )}

                                {msg.uiHint && (
                                    <div className="w-full mt-2">
                                        <ExerciseRenderer 
                                            uiHint={msg.uiHint} 
                                            onConfirm={(payload) => {
                                                if (msg.interruptId) {
                                                    handleHitlResponse(msg.interruptId, payload);
                                                } else if (msg.uiHint.type === 'workout_plan') {
                                                    handleConfirmPlan(msg.uiHint.data, payload.mode);
                                                }
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                        ))}
                        <div ref={chatEndRef} />
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-6 pb-8 flex-shrink-0 z-20">
                <div className="flex items-center justify-center gap-4 mb-6 px-1">
                    <button className="h-9 px-4 rounded-full bg-gray-100/50 hover:bg-gray-100 flex items-center gap-2 text-xs font-bold text-gray-500 transition-colors backdrop-blur-md border border-white/50">
                        视觉
                    </button>
                    <button className="h-9 px-4 rounded-full bg-gray-100/50 hover:bg-gray-100 flex items-center gap-2 text-xs font-bold text-gray-500 transition-colors backdrop-blur-md border border-white/50">
                        语音
                    </button>
                    <button 
                        onClick={() => setIsPlanMode(!isPlanMode)}
                        className={`
                            h-9 px-4 rounded-full flex items-center gap-2 text-xs font-bold transition-all backdrop-blur-md border border-white/50
                            ${isPlanMode 
                                ? 'bg-blue-500 text-white shadow-md shadow-blue-500/20' 
                                : 'bg-gray-100/50 text-gray-500 hover:bg-gray-100'}
                        `}
                    >
                        计划
                    </button>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); handleChatSubmit(); }} className="relative group">
                    <div className="absolute inset-0 bg-blue-100/20 rounded-[2rem] blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none"></div>
                    <textarea 
                        ref={textareaRef}
                        rows={1}
                        value={chatMessage}
                        onChange={e => setChatMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={isPlanMode ? "Agent Plan Mode Active..." : "Ask your Agent..."}
                        className="relative w-full min-h-[56px] py-4 bg-gray-50/80 border border-gray-100/50 backdrop-blur-md rounded-[2rem] pl-7 pr-16 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-100/50 focus:bg-white transition-all placeholder-gray-400 text-gray-800 shadow-sm resize-none custom-scrollbar"
                    />
                    <button 
                        type="submit" 
                        disabled={isLoading}
                        className="absolute right-2 bottom-2 w-10 h-10 bg-black text-white rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg shadow-gray-200 disabled:bg-gray-300 z-10"
                    >
                        {isLoading ? (
                            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                            </svg>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AICoachOverlay;
