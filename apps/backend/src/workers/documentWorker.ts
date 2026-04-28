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

      // 1. Update status to PROCESSING
      await prisma.document.update({
        where: { id: documentId },
        data: { status: 'PROCESSING' },
      });

      try {
        // 2. Split text into chunks
        const chunks = splitTextIntoChunks(extractedText, 500, 50);
        console.log(`📄 Split into ${chunks.length} chunks`);

        await job.updateProgress(10);

        // 3. Generate embeddings + store chunks
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];

          // Generate embedding
          const embedding = await generateEmbedding(chunk.content);
          const vectorString = `[${embedding.join(',')}]`;

          // Store chunk with embedding using raw SQL (PGVector)
          await prisma.$executeRaw`
            INSERT INTO document_chunks (id, content, "chunkIndex", embedding, "documentId", "createdAt")
            VALUES (
              gen_random_uuid()::text,
              ${chunk.content},
              ${chunk.index},
              ${vectorString}::vector,
              ${documentId},
              NOW()
            )
          `;

          // Update progress
          const progress = 10 + Math.floor((i / chunks.length) * 85);
          await job.updateProgress(progress);
        }

        // 4. Update document status to COMPLETED
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
        // Update status to FAILED
        await prisma.document.update({
          where: { id: documentId },
          data: { status: 'FAILED' },
        });
        throw error;
      }
    },
    {
      connection: redis,
      concurrency: 2,
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
