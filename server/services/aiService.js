const aiCache = new Map();

// Production never uses synthetic AI responses; rate limits are surfaced directly to the user.
async function fetchWithRetry(url, options, cacheKey = null, retries = 3) {
  if (cacheKey && aiCache.has(cacheKey)) {
    console.log('[AI Cache Hit] for key: ' + cacheKey);
    return aiCache.get(cacheKey);
  }

  let delay = 2000;
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, options);
    const data = await res.json();
    
    if (res.status === 429 || (data.error && data.error.code === 429)) {
      console.log('[AI Rate Limited] 429 received. Attempt ' + (i + 1) + '/' + retries);
      let retrySeconds = 5;
      const resetHeader = res.headers.get('x-ratelimit-reset-requests') || res.headers.get('x-ratelimit-reset-tokens');
      if (resetHeader) {
        retrySeconds = parseFloat(resetHeader.replace('s', '')) || 5;
      }
      
      if (i === retries - 1) {
        throw new Error('AI is temporarily rate-limited, try again in ' + Math.ceil(retrySeconds) + ' seconds');
      }
      
      const waitMs = Math.max(retrySeconds * 1000, delay);
      console.log('Waiting ' + waitMs + 'ms before retry...');
      await new Promise(r => setTimeout(r, waitMs));
      delay *= 2;
      continue;
    }

    if (res.status === 503 || (data.error && data.error.code === 503)) {
      console.log('[AI Retry] Got 503, retrying (attempt ' + (i + 1) + '/' + retries + ')...');
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || JSON.stringify(data));
    }
    
    if (cacheKey) {
      aiCache.set(cacheKey, data);
    }
    return data;
  }
  
  const finalRes = await fetch(url, options);
  const finalData = await finalRes.json();
  if (finalRes.status === 429 || (finalData.error && finalData.error.code === 429)) {
    throw new Error('AI is temporarily rate-limited, try again in 5 seconds');
  }
  if (!finalRes.ok || finalData.error) {
    throw new Error(finalData.error?.message || JSON.stringify(finalData));
  }
  
  if (cacheKey) {
    aiCache.set(cacheKey, finalData);
  }
  return finalData;
}

async function suggestDependencies(newTask, allTasks) {
  const prompt = `You are a project management AI. I am creating a new task:
Title: ${newTask.title}
Description: ${newTask.description}

Here are the existing tasks:
${allTasks.map(t => '- ' + t.title).join('\n')}

Suggest which existing tasks should be predecessors to this new task.
Return strictly a JSON array of objects with keys: suggested_task_title, confidence (0 to 1), rationale.
No markdown, just JSON array.`;

  const cacheKey = 'suggest_' + newTask.title + '_' + newTask.description;

  try {
    const data = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    }, cacheKey, 2);
    
    if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
      let content = data.choices[0].message.content.trim();
      if (content.startsWith('```json')) {
        content = content.replace(/^```json\n/, '').replace(/\n```$/, '');
      } else if (content.startsWith('```')) {
        content = content.replace(/^```.*\n/, '').replace(/\n```$/, '');
      }
      const parsed = JSON.parse(content);
      // Ensure array is returned if object has it mapped by a key due to json_object enforcing objects
      return Array.isArray(parsed) ? parsed : (parsed.suggestions || parsed.tasks || parsed.dependencies || Object.values(parsed)[0] || []);
    }
    throw new Error('Invalid response from AI: ' + JSON.stringify(data));
  } catch (error) {
    console.error('AI Error:', error);
    throw error;
  }
}

async function extractWhatIf(query, allTasks) {
  const prompt = `User query: "${query}"
Existing tasks:
${allTasks.map(t => `ID: ${t.id} | Title: ${t.title}`).join('\n')}

Extract the task ID and the number of delta days the user is asking about.
If the user's phrasing is vague (e.g., "project"), pick the closest matching or most relevant task from the list (typically the first/main one).
Return strictly a JSON object with keys: task_id (integer), delta_days (integer).
No markdown, just JSON object.`;

  const cacheKey = 'whatif_' + query;

  try {
    const data = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    }, cacheKey, 2);
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      throw new Error('Invalid response from AI: ' + JSON.stringify(data));
    }
    let content = data.choices[0].message.content.trim();
    if (content.startsWith('```json')) {
      content = content.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (content.startsWith('```')) {
      content = content.replace(/^```.*\n/, '').replace(/\n```$/, '');
    }
    
    try {
      return JSON.parse(content);
    } catch (parseError) {
      throw new Error('Failed to parse AI response as JSON. Content was: ' + content);
    }
  } catch (error) {
    throw error;
  }
}

async function summarizeDiff(query, diff) {
  const prompt = `The user asked: "${query}"
The resulting schedule changes are:
${JSON.stringify(diff, null, 2)}

Write a one-paragraph plain-English summary of these impacts for the user. 
CRITICAL RULES:
1. State the exact day-shift numbers as given in the simulation diff data.
2. DO NOT round, approximate, or use vague phrasing like "about a week" or "a few days".
3. You MUST quote the exact delta_days value directly at least once in your summary using the exact number (e.g. "5 days"), not a paraphrase.`;

  const cacheKey = 'summary_' + query + '_' + JSON.stringify(diff);

  try {
    const data = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7
      })
    }, cacheKey, 2);
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      throw new Error('Invalid response: ' + JSON.stringify(data));
    }
    return data.choices[0].message.content.trim();
  } catch (error) {
    throw error;
  }
}

module.exports = { suggestDependencies, extractWhatIf, summarizeDiff };
