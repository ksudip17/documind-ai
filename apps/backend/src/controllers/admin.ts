import { Request, Response } from 'express';
import { prisma } from '../config/database';

export async function getStats(req: Request, res: Response): Promise<void> {
  try {
    const [
      totalUsers,
      totalDocuments,
      totalQueries,
      avgConfidence,
      recentQueries,
      documentsByStatus,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.document.count(),
      prisma.queryLog.count(),
      prisma.queryLog.aggregate({
        _avg: { confidenceScore: true, responseTimeMs: true },
      }),
      prisma.queryLog.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          question: true,
          confidenceScore: true,
          tokensUsed: true,
          responseTimeMs: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
          document: { select: { fileName: true } },
        },
      }),
      prisma.document.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
    ]);

    res.json({
      stats: {
        totalUsers,
        totalDocuments,
        totalQueries,
        avgConfidenceScore: avgConfidence._avg.confidenceScore?.toFixed(2),
        avgResponseTimeMs: Math.round(avgConfidence._avg.responseTimeMs || 0),
      },
      documentsByStatus,
      recentQueries,
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
}

export async function getAllUsers(req: Request, res: Response): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        _count: {
          select: { documents: true, queries: true },
        },
      },
    });

    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
}
