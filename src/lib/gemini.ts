import { Type } from "@google/genai";

async function callGeminiProxy(prompt: string, config: any) {
  const res = await fetch("/api/gemini/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, config }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to call Gemini API");
  }
  const data = await res.json();
  return data;
}

function parseArrayRobust(text: string) {
  try {
    const parsed = JSON.parse(text || "[]");
    if (Array.isArray(parsed)) return parsed;
    // If it's an object, find the first array property (e.g. {"skills": [...]})
    const arrayProp = Object.values(parsed).find(Array.isArray);
    return arrayProp || [];
  } catch (e) {
    console.error("Failed to parse array:", e);
    return [];
  }
}

export async function getSkillRecommendations(userProfile: any) {
  const prompt = `Based on the following user profile, suggest 5 specific skills they should learn to improve their career prospects. 
  User Profile: ${JSON.stringify(userProfile)}
  Return the response as a JSON array of objects with 'skill' and 'reason' properties.`;

  const data = await callGeminiProxy(prompt, {
    model: "gemini-3-flash-preview",
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          skill: { type: Type.STRING },
          reason: { type: Type.STRING }
        },
        required: ["skill", "reason"]
      }
    }
  });

  return parseArrayRobust(data.text);
}

export async function getJobMatches(userProfile: any, jobs: any[]) {
  const prompt = `Match the following user profile with the list of available jobs. 
  User Profile: ${JSON.stringify(userProfile)}
  Jobs: ${JSON.stringify(jobs)}
  Return a JSON array of objects with 'jobId' and 'matchScore' (0-100) and 'reason'.`;

  const data = await callGeminiProxy(prompt, {
    model: "gemini-3-flash-preview",
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          jobId: { type: Type.STRING },
          matchScore: { type: Type.NUMBER },
          reason: { type: Type.STRING }
        },
        required: ["jobId", "matchScore", "reason"]
      }
    }
  });

  return parseArrayRobust(data.text);
}

export async function getResumeSuggestions(userProfile: any) {
  const prompt = `Analyze this user profile and provide 3-5 specific suggestions to improve their resume and profile visibility.
  User Profile: ${JSON.stringify(userProfile)}
  Return a JSON array of strings.`;

  const data = await callGeminiProxy(prompt, {
    model: "gemini-3-flash-preview",
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    }
  });

  return parseArrayRobust(data.text);
}

export async function generateATSResume(userProfile: any) {
  const prompt = `Generate a professional, ATS-friendly resume based on the following user profile. 
  User Profile: ${JSON.stringify(userProfile)}
  Focus on using strong action verbs and quantifiable achievements.
  Return a JSON object with 'summary', 'experience' (array of objects with title, company, period, bullets), and 'education' (array).`;

  const data = await callGeminiProxy(prompt, {
    model: "gemini-3-flash-preview",
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        experience: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              company: { type: Type.STRING },
              period: { type: Type.STRING },
              bullets: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["title", "company", "period", "bullets"]
          }
        },
        education: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      },
      required: ["summary", "experience", "education"]
    }
  });

  return JSON.parse(data.text || "{}");
}

export async function analyzeResumeATS(resumeText: string, targetJob?: string) {
  const prompt = `Analyze the following resume text for ATS (Applicant Tracking System) compatibility. 
  ${targetJob ? `Target Job: ${targetJob}` : ""}
  Resume Text: ${resumeText}
  Provide a score (0-100), a list of missing keywords, and 3-5 specific tips for improvement.
  Return as a JSON object.`;

  const data = await callGeminiProxy(prompt, {
    model: "gemini-3-flash-preview",
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER },
        missingKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        tips: { type: Type.ARRAY, items: { type: Type.STRING } },
        overallFeedback: { type: Type.STRING }
      },
      required: ["score", "missingKeywords", "tips", "overallFeedback"]
    }
  });

  return JSON.parse(data.text || "{}");
}
