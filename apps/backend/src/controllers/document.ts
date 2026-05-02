import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';
import { uploadToStorage, deleteFromStorage, getSignedUrl } from '../services/storage';
import { extractTextFromFile } from '../utils/fileParser';
import { addDocumentProcessingJob } from '../queues/documentQueue';

// ── Upload Document ───────────────────────────────────────
export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    const userId = req.user!.userId;

    // 1. Extract text immediately to validate file
    const parsed = await extractTextFromFile(file.path, file.mimetype);

    if (!parsed.text || parsed.text.length < 50) {
      fs.unlinkSync(file.path);
      res.status(400).json({ error: 'File appears to be empty or unreadable' });
      return;
    }

    // 2. Save document record immediately with temp path
    const storagePath = `${userId}/${Date.now()}${path.extname(file.originalname)}`;
    const document = await prisma.document.create({
      data: {
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        storageUrl: storagePath,
        status: 'PENDING',
        userId,
      },
    });

    // 3. Queue processing job immediately
    await addDocumentProcessingJob({
      documentId: document.id,
      userId,
      storagePath: file.path,
      extractedText: parsed.text,
    });

    // 4. Respond to user immediately — don't wait for Supabase
    res.status(201).json({
      message: 'Document uploaded successfully. Processing started.',
      document: {
        id: document.id,
        fileName: document.fileName,
        fileSize: document.fileSize,
        status: document.status,
        createdAt: document.createdAt,
      },
    });

    // 5. Upload to Supabase Storage in background (non-blocking)
    uploadToStorage(file.path, userId, file.originalname)
      .then((url) =>
        prisma.document.update({
          where: { id: document.id },
          data: { storageUrl: url },
        })
      )
      .catch((err) => console.error('Background storage upload failed:', err))
      .finally(() => {
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });

  } catch (error) {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    console.error('Upload error FULL:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    res.status(500).json({
      error: 'Failed to upload document',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Get all documents for user ────────────────────────────
export async function getDocuments(req: Request, res: Response): Promise<void> {
  try {
    const documents = await prisma.document.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        fileType: true,
        status: true,
        chunkCount: true,
        createdAt: true,
        _count: { select: { queries: true } },
      },
    });

    res.json({ documents });
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
}

// ── Get single document ───────────────────────────────────
export async function getDocument(req: Request, res: Response): Promise<void> {
  try {
    const document = await prisma.document.findFirst({
      where: {
        id: req.params.id as string,
        userId: req.user!.userId,
      },
      include: {
        _count: { select: { queries: true, chunks: true } },
      },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const downloadUrl = await getSignedUrl(document.storageUrl);
    res.json({ document: { ...document, downloadUrl } });
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ error: 'Failed to fetch document' });
  }
}

// ── Delete document ───────────────────────────────────────
export async function deleteDocument(req: Request, res: Response): Promise<void> {
  try {
    const document = await prisma.document.findFirst({
      where: {
        id: req.params.id as string,
        userId: req.user!.userId,
      },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    await deleteFromStorage(document.storageUrl);
    await prisma.document.delete({ where: { id: document.id } });

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
}
