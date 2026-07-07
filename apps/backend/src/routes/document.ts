/**
 * src/routes/document.ts
 *
 * SECURITY LAYERS APPLIED:
 *  - authenticate:          All document routes require a valid JWT.
 *  - uploadLimiter:         10 uploads per 15 min per IP.
 *                           Prevents BullMQ queue saturation and Supabase
 *                           Storage bandwidth abuse.
 *  - multer fileFilter:     Validates MIME type and file extension at upload.
 *  - validateUploadedFile:  Validates actual file magic bytes after multer
 *                           saves the temp file. Catches renamed malicious files.
 *  - validate(params):      Ensures :id route params are valid UUIDs before
 *                           any database lookup.
 *  - searchLimiter:         100 reads per hour for GET /documents listing.
 */

import { Router } from 'express';
import multerPkg from 'multer';
import path from 'path';
import { authenticate } from '../middleware/auth';
import {
  uploadDocument,
  getDocuments,
  getDocument,
  deleteDocument,
} from '../controllers/document';
import { uploadLimiter, searchLimiter } from '../middleware/rateLimiter';
import { validateUploadedFile } from '../middleware/sanitize';
import { validate, documentIdParamSchema } from '../validation/schemas';

// ── Multer configuration — local temp storage before Supabase upload ──────────

const storage = multerPkg.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = process.env.NODE_ENV === 'production' ? '/tmp' : 'uploads/';
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

/**
 * Allowed MIME types and extensions.
 * Note: multer checks the client-reported MIME type and extension.
 * The validateUploadedFile middleware then checks actual magic bytes
 * to catch file-type spoofing attacks.
 */
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  // application/octet-stream is intentionally excluded — too broad
  // (previously accepted it, now we rely on magic bytes check instead)
]);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.webp']);

const upload = multerPkg({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 1,                    // one file per upload
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (ALLOWED_MIMES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOCX, TXT, JPEG, PNG, and WebP files are allowed'));
    }
  },
});

const router = Router();

// All document routes require authentication
router.use(authenticate);

// POST /api/documents/upload
//  1. uploadLimiter        — enforce upload quota before multer processes the file
//  2. upload.single('file') — parse multipart/form-data, save temp file
//  3. validateUploadedFile  — check magic bytes against saved temp file
//  4. uploadDocument        — business logic
router.post(
  '/upload',
  uploadLimiter,
  upload.single('file'),
  validateUploadedFile,
  uploadDocument
);

// GET /api/documents — list all documents for the authenticated user
router.get('/', searchLimiter, getDocuments);

// GET /api/documents/:id — validate :id is a UUID before DB lookup
router.get('/:id', validate(documentIdParamSchema, 'params'), getDocument);

// DELETE /api/documents/:id — validate :id is a UUID before DB lookup
router.delete('/:id', validate(documentIdParamSchema, 'params'), deleteDocument);

export default router;

