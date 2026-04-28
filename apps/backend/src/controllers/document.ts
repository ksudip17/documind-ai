import { Request, Response } from 'express';
import fs from 'fs';
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

    // 1. Upload to Supabase Storage
    const storageUrl = await uploadToStorage(file.path, userId, file.originalname);

    // 2. Extract text to validate file is readable
    const parsed = await extractTextFromFile(file.path, file.mimetype);

    if (!parsed.text || parsed.text.length < 50) {
      fs.unlinkSync(file.path);
      await deleteFromStorage(storageUrl);
      res.status(400).json({ error: 'File appears to be empty or unreadable' });
      return;
    }

    // 3. Save document record to DB
    const document = await prisma.document.create({
      data: {
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        storageUrl,
        status: 'PENDING',
        userId,
      },
    });

    // 4. Queue background processing job
    await addDocumentProcessingJob({
      documentId: document.id,
      userId,
      storagePath: storageUrl,
      extractedText: parsed.text,
    });

    // 5. Clean up local temp file
    fs.unlinkSync(file.path);

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
  } catch (error) {
    // Clean up temp file on error
    if (file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload document' });
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

    // Get signed URL for download
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

    // Delete from storage + DB (cascade deletes chunks + queries)
    await deleteFromStorage(document.storageUrl);
    await prisma.document.delete({ where: { id: document.id } });

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
}
