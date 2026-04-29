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
    provider: 'hf-inference',
  }) as number[] | number[][];

  // Flatten if nested array
  if (Array.isArray(result[0])) {
    return (result as number[][])[0];
  }
  return result as number[];
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    embeddings.push(await generateEmbedding(text));
  }
  return embeddings;
}
