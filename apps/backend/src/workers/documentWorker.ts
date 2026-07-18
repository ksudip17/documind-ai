import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { DocumentJobData } from '../queues/documentQueue';
import { splitTextIntoChunks } from '../services/textSplitter';
import { generateEmbedding } from '../services/embeddings';

export function startDocumentWorker() {
  const worker = new Worker<DocumentJobData>(
    'document-processing',
    async (job: Job<DocumentJobData>) => {
      const { documentId, extractedText } = job.data;

      console.log(`⚙️  Processing document: ${documentId}`);

      await prisma.document.update({
        where: { id: documentId },
        data: { status: 'PROCESSING' },
      });

      try {
        const chunks = splitTextIntoChunks(extractedText, 500, 50);
        console.log(`📄 Split into ${chunks.length} chunks`);

        await job.updateProgress(10);

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];

          // PostgreSQL UTF8 rejects the null byte (0x00) which can appear in
          // binary PDFs or corrupted documents. Strip it before DB insertion
          // to prevent: "ERROR: invalid byte sequence for encoding UTF8: 0x00"
          const safeContent = chunk.content.replace(/\0/g, '');

          const embedding = await generateEmbedding(safeContent);
          const vectorString = `[${embedding.join(',')}]`;

          await prisma.$executeRaw`
            INSERT INTO document_chunks (id, content, "chunkIndex", embedding, "documentId", "createdAt")
            VALUES (
              gen_random_uuid()::text,
              ${safeContent},
              ${chunk.index},
              ${vectorString}::vector,
              ${documentId},
              NOW()
            )
          `;

          const progress = 10 + Math.floor((i / chunks.length) * 85);
          await job.updateProgress(progress);
        }

        await prisma.document.update({
          where: { id: documentId },
          data: {
            status: 'COMPLETED',
            chunkCount: chunks.length,
          },
        });

        await job.updateProgress(100);
        console.log(`✅ Document processed: ${documentId} (${chunks.length} chunks)`);

      } catch (error) {
        await prisma.document.update({
          where: { id: documentId },
          data: { status: 'FAILED' },
        });
        throw error;
      }
    },
    {
      connection: redis,
      concurrency: 1,
      // stalledInterval: how often (ms) to check for stalled jobs
      // 5 min is already conservative
      stalledInterval: 300000,
      lockDuration: 120000,
      lockRenewTime: 60000,
      // drainDelay: how long (ms) the worker waits before re-polling Redis
      // when the queue is empty. Default is 5ms — on Upstash free tier
      // (500k commands/day) this causes ~12,000 evalsha calls/min just from
      // idle polling, exhausting the limit in under an hour.
      // 30s = ~2 polls/min when idle = ~2,880/day vs ~17,280,000 at default.
      drainDelay: 30000,
    }
  );

  worker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
  });

  console.log('👷 Document worker started');
  return worker;
}
