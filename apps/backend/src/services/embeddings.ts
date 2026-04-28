let pipeline: any = null;

async function getEmbeddingPipeline() {
  if (!pipeline) {
    // Dynamically import ESM module
    const { pipeline: createPipeline } = await import('@xenova/transformers');
    pipeline = await createPipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
    console.log('✅ Embedding model loaded');
  }
  return pipeline;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const extractor = await getEmbeddingPipeline();
  const output = await extractor(text, {
    pooling: 'mean',
    normalize: true,
  });
  return Array.from(output.data) as number[];
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    embeddings.push(embedding);
  }
  return embeddings;
}
