import { ProxyAgent, request } from 'undici';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const API_KEY = process.env.GOOGLE_API_KEY || '';
const PROXY = process.env.GEMINI_PROXY || process.env.GLOBAL_PROXY || '';

async function listModels() {
  console.log('--- Listing Gemini Models ---');
  if (!API_KEY) {
    throw new Error('Missing GOOGLE_API_KEY');
  }
  let finalProxy = PROXY.trim();
  if (finalProxy && !finalProxy.includes('://')) {
    finalProxy = `http://${finalProxy}`;
  }
  const dispatcher = finalProxy ? new ProxyAgent(finalProxy) : undefined;
  
  // Try both v1 and v1beta
  for (const version of ['v1', 'v1beta']) {
    const url = `https://generativelanguage.googleapis.com/${version}/models?key=${API_KEY}`;
    console.log(`Checking ${version}...`);
    try {
      const response = await request(url, { dispatcher });
      const body = await response.body.text();
      const json = JSON.parse(body);
      if (response.statusCode === 200) {
        console.log(`✅ ${version} Success!`);
        console.log('Models found:', json.models.length);
        // Print ALL models
        json.models.forEach(m => console.log(` - ${m.name}`));
      } else {
        console.log(`❌ ${version} Failed (${response.statusCode}):`, json.error?.message || json);
      }
    } catch (e) {
      console.log(`❌ ${version} Error:`, e.message);
    }
  }
}

listModels();
