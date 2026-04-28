import { Queue } from 'bullmq';
import { redis } from '../config/redis';

export interface DocumentJobData {
  documentId: string;
  userId: string;
  storagePath: string;
  extractedText: string;
}

export const documentQueue = new Queue<DocumentJobData>('document-processing', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export async function addDocumentProcessingJob(data: DocumentJobData) {
  const job = await documentQueue.add('process-document', data, {
    jobId: `doc-${data.documentId}`,
  });
  console.log(`📋 Queued document processing job: ${job.id}`);
  return job;
}
