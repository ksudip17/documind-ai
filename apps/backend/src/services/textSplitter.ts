export interface TextChunk {
  content: string;
  index: number;
}

export function splitTextIntoChunks(
  text: string,
  chunkSize: number = 500,
  overlap: number = 50
): TextChunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: TextChunk[] = [];

  let i = 0;
  let index = 0;

  while (i < words.length) {
    const chunkWords = words.slice(i, i + chunkSize);
    const content = chunkWords.join(' ');

    if (content.trim().length > 20) {
      chunks.push({ content, index });
      index++;
    }

    i += chunkSize - overlap;
  }

  return chunks;
}
