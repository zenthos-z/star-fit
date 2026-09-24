export const ChatFeatureFlags = {
  allowChatGuidanceUpdate:
    ((globalThis as any)?.localStorage?.getItem('STARFIT_ALLOW_CHAT_GUIDANCE_UPDATE') || 'false') === 'true'
}

