import { HfInference } from '@huggingface/inference';

if (!process.env.HUGGINGFACE_API_KEY) {
  throw new Error('HUGGINGFACE_API_KEY is missing');
}

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

const MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

export async function generateEmbedding(text: string): Promise<number[]> {
  const result = await hf.featureExtraction({
    model: MODEL,
    inputs: text,
  });

  // Result is a nested array — flatten to 1D
  const embedding = Array.isArray(result[0])
    ? (result as number[][])[0]
    : (result as number[]);

  return embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    embeddings.push(embedding);
  }
  return embeddings;
}
