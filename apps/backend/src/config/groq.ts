import Groq from 'groq-sdk';

if (!process.env.GROQ_API_KEY) {
  throw new Error('GROQ_API_KEY is missing from environment');
}

export const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Model constants — change here to update everywhere
export const GROQ_MODELS = {
  CHAT: 'llama-3.3-70b-versatile',      // main LLM for answers
  FAST: 'llama-3.1-8b-instant',          // fast model for confidence scoring
} as const;

// Embedding — Groq doesn't do embeddings, we use this helper
// We'll use a local sentence transformer via an API trick
// For now we define the embedding dimension
export const EMBEDDING_DIMENSION = 1536;