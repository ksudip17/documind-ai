import { Request, Response, NextFunction } from 'express';
import { queryDocument } from '../services/ragService';
import { getCachedAnswer, setCachedAnswer } from '../services/cacheService';

// Note: question/documentId validation is handled upstream by querySchema middleware.
export async function query(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { question, documentId } = req.body;
    const userId = req.user!.userId;

    // 1. Check Redis cache first
    const cached = await getCachedAnswer(question, documentId);
    if (cached) {
      res.json({ ...cached, cached: true });
      return;
    }

    // 2. Run RAG pipeline
    const result = await queryDocument(question, documentId, userId);

    // 3. Cache the result
    await setCachedAnswer(question, documentId, result);

    res.json({ ...result, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Query failed';

    if (message.includes('not found or not yet processed')) {
      res.status(404).json({ error: message });
      return;
    }

    next(error);
  }
}

export async function getQueryHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prisma } = await import('../config/database');
    const { documentId } = req.params;

    const logs = await prisma.queryLog.findMany({
      where: {
        documentId: documentId as string,
        userId: req.user!.userId,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        question: true,
        answer: true,
        confidenceScore: true,
        tokensUsed: true,
        responseTimeMs: true,
        createdAt: true,
      },
    });

    res.json({ logs });
  } catch (error) {
    next(error);
  }
}
