import dotenv from 'dotenv';

// Load .env
dotenv.config();

console.log('=== Environment Variable Check ===\n');
console.log('AI_PROVIDER:', process.env.AI_PROVIDER);
console.log('OPENAI_MODEL:', process.env.OPENAI_MODEL);
console.log('OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL);
console.log('GLOBAL_PROXY:', process.env.GLOBAL_PROXY);
console.log('GEMINI_PROXY:', process.env.GEMINI_PROXY);
console.log('HTTP_PROXY:', process.env.HTTP_PROXY);
console.log('HTTPS_PROXY:', process.env.HTTPS_PROXY);
console.log('\n=== Expected Proxy Behavior ===');
const provider = process.env.AI_PROVIDER || 'gemini';
const proxyUrl = provider === 'gemini'
  ? (process.env.GEMINI_PROXY || process.env.GLOBAL_PROXY || "")
  : "";
console.log('Provider:', provider);
console.log('Proxy URL will be:', proxyUrl || '(empty - no proxy)');
