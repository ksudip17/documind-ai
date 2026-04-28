import { prisma } from '../config/database';
import { groq, GROQ_MODELS } from '../config/groq';
import { generateEmbedding } from './embeddings';

export interface RAGResult {
  answer: string;
  sources: Array<{
    content: string;
    chunkIndex: number;
  }>;
  confidenceScore: number;
  tokensUsed: number;
  responseTimeMs: number;
}

// ── Vector similarity search ──────────────────────────────
async function searchSimilarChunks(
  questionEmbedding: number[],
  documentId: string,
  topK: number = 5
) {
  const vectorString = `[${questionEmbedding.join(',')}]`;

  const chunks = await prisma.$queryRaw<Array<{
    id: string;
    content: string;
    chunkIndex: number;
    similarity: number;
  }>>`
    SELECT 
      id,
      content,
      "chunkIndex",
      1 - (embedding <=> ${vectorString}::vector) AS similarity
    FROM document_chunks
    WHERE "documentId" = ${documentId}
    ORDER BY embedding <=> ${vectorString}::vector
    LIMIT ${topK}
  `;

  return chunks;
}

// ── Generate answer using LLM ─────────────────────────────
async function generateAnswer(
  question: string,
  contextChunks: Array<{ content: string; chunkIndex: number }>
): Promise<{ answer: string; tokensUsed: number }> {
  const context = contextChunks
    .map((c, i) => `[Source ${i + 1}]:\n${c.content}`)
    .join('\n\n');

  const completion = await groq.chat.completions.create({
    model: GROQ_MODELS.CHAT,
    messages: [
      {
        role: 'system',
        content: `You are a helpful document assistant. Answer questions based ONLY on the provided context.
If the answer is not in the context, say "I couldn't find information about that in this document."
Always be concise and accurate. Cite which source(s) support your answer.`,
      },
      {
        role: 'user',
        content: `Context:\n${context}\n\nQuestion: ${question}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 1024,
  });

  const answer = completion.choices[0]?.message?.content || 'No answer generated';
  const tokensUsed = completion.usage?.total_tokens || 0;

  return { answer, tokensUsed };
}

// ── Confidence scoring (LLM-as-judge) ─────────────────────
async function scoreConfidence(
  question: string,
  answer: string,
  context: string
): Promise<number> {
  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODELS.FAST,
      messages: [
        {
          role: 'system',
          content: `You are an answer quality evaluator. 
Rate how well the answer is grounded in the provided context.
Respond with ONLY a decimal number between 0.0 and 1.0.
1.0 = perfectly grounded, 0.0 = completely ungrounded.`,
        },
        {
          role: 'user',
          content: `Context: ${context.slice(0, 1000)}\n\nQuestion: ${question}\n\nAnswer: ${answer}\n\nScore:`,
        },
      ],
      temperature: 0,
      max_tokens: 10,
    });

    const scoreText = completion.choices[0]?.message?.content?.trim() || '0.5';
    const score = parseFloat(scoreText);
    return isNaN(score) ? 0.5 : Math.min(1, Math.max(0, score));
  } catch {
    return 0.5;
  }
}

// ── Main RAG pipeline ─────────────────────────────────────
export async function queryDocument(
  question: string,
  documentId: string,
  userId: string
): Promise<RAGResult> {
  const startTime = Date.now();

  // 1. Verify document belongs to user and is processed
  const document = await prisma.document.findFirst({
    where: { id: documentId, userId, status: 'COMPLETED' },
  });

  if (!document) {
    throw new Error('Document not found or not yet processed');
  }

  // 2. Embed the question
  const questionEmbedding = await generateEmbedding(question);

  // 3. Find similar chunks
  const similarChunks = await searchSimilarChunks(questionEmbedding, documentId, 5);

  if (similarChunks.length === 0) {
    throw new Error('No relevant content found in document');
  }

  // 4. Generate answer
  const { answer, tokensUsed } = await generateAnswer(question, similarChunks);

  // 5. Score confidence
  const contextText = similarChunks.map(c => c.content).join(' ');
  const confidenceScore = await scoreConfidence(question, answer, contextText);

  const responseTimeMs = Date.now() - startTime;

  // 6. Log query to DB
  await prisma.queryLog.create({
    data: {
      question,
      answer,
      confidenceScore,
      tokensUsed,
      responseTimeMs,
      documentId,
      userId,
    },
  });

  return {
    answer,
    sources: similarChunks.map(c => ({
      content: c.content.slice(0, 200) + '...',
      chunkIndex: c.chunkIndex,
    })),
    confidenceScore,
    tokensUsed,
    responseTimeMs,
  };
}
