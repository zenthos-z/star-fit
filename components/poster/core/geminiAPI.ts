import { ExtractedWorkoutData } from './dataExtractor';

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
  }>;
}

export async function extractWorkoutData(rawLog: string): Promise<ExtractedWorkoutData> {
  const apiKey = "";
  const model = "gemini-2.5-flash-preview-09-2025";
  
  const today = new Date();
  const defaultDate = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
  
  const systemPrompt = `You are a data extractor for a fitness visualization tool.
Task: Analyze the user's unstructured training log.
Output: A strict JSON object.
Schema:
{
    "date": "YYYY.MM.DD string. If not mentioned in text, use '${defaultDate}'",
    "duration": "Total time string (e.g. '60 MINS'). If not mentioned, estimate or put '45 MINS'",
    "exercises": [
        {
            "name": "Exercise name in Chinese",
            "meta": "Performance details. CRITICAL: Capture Weight (KG), Reps (个/次), and Sets (组) if present. Format preferred: '[Weight · Reps · Sets]' (e.g., '[12.5KG · 10 · 3组]'). If no weight, use '[Reps · Sets]'. If cardio, use '[Time · HeartRate]'. Do not omit repetition counts."
        }
    ]
}
Limit exercises to top 6 items. If details are missing, use plausible placeholders like '[3 · 12rm]'.
Do not include markdown code blocks, just raw JSON.`;

  const userPrompt = `Log to analyze:
${rawLog}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: userPrompt }]
        }],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: GeminiResponse = await response.json();
    const rawJson = data.candidates[0].content.parts[0].text;
    const parsedData = JSON.parse(rawJson);

    return {
      nickname: '你的昵称',
      date: parsedData.date,
      duration: parsedData.duration,
      exercises: parsedData.exercises.map((ex: any) => ({
        name: ex.name,
        sets: ex.meta.match(/(\d+)组/)?.[1] || '3组',
        weight: ex.meta.match(/([\d.]+)KG/)?.[1],
        reps: ex.meta.match(/(\d+)个/)?.[1] || ex.meta.match(/(\d+) · /)?.[1],
        duration: ex.meta.match(/(\d+)MIN/)?.[1]
      }))
    };
  } catch (error) {
    console.error('Gemini API Error:', error);
    throw error;
  }
}
