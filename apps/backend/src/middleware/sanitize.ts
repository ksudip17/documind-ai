/**
 * src/middleware/sanitize.ts
 *
 * Input sanitisation middleware for DocuMind AI.
 *
 * WHY SANITISE IN ADDITION TO ZOD VALIDATION:
 *  Zod validates *shape* — correct type, length, format.
 *  Sanitisation goes one step further and *cleans* the data:
 *   - Trim stray whitespace that slips through (padding attacks)
 *   - Normalise emails to lowercase before DB lookups
 *   - Strip prototype-pollution keys (__proto__, constructor, prototype)
 *     to prevent NoSQL-style injection via JSON body parsing
 *
 * FILE UPLOAD MAGIC-BYTE VALIDATION:
 *  Validates the actual binary content of uploaded files, not just the
 *  MIME type or extension reported by the client.
 *  A malicious user can rename a .exe to .pdf — checking magic bytes
 *  catches that. This runs as a multer fileFilter enhancement.
 *
 *  Supported signatures:
 *   - PDF:  %PDF  (25 50 44 46)
 *   - DOCX: PK    (50 4B 03 04) — DOCX/ZIP-based formats
 *   - TXT:  (no fixed signature — text heuristic)
 *   - JPEG: FF D8 FF
 *   - PNG:  89 50 4E 47 0D 0A 1A 0A
 *   - WebP: RIFF....WEBP
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// Body sanitisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively strips prototype-pollution keys from an object.
 * Prevents { "__proto__": { "isAdmin": true } } style attacks.
 */
function stripDangerousKeys(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return obj;
  }

  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    cleaned[key] = stripDangerousKeys(value);
  }

  return cleaned;
}

/**
 * Recursively trims string values in an object.
 * Prevents padding attacks where whitespace-wrapped values bypass validation.
 */
function deepTrimStrings(obj: unknown): unknown {
  if (typeof obj === 'string') return obj.trim();
  if (Array.isArray(obj)) return obj.map(deepTrimStrings);
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = deepTrimStrings(value);
    }
    return result;
  }
  return obj;
}

/**
 * sanitizeBody middleware
 *
 * Applies to all JSON body routes. Runs AFTER body parsing, BEFORE validation.
 * Order in index.ts: bodyParser → sanitizeBody → routes (which apply validate())
 */
export function sanitizeBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    // 1. Strip prototype-pollution keys
    req.body = stripDangerousKeys(req.body);
    // 2. Trim whitespace from all string values
    req.body = deepTrimStrings(req.body);
    // 3. Normalise email fields (belt-and-suspenders alongside Zod .toLowerCase())
    if (req.body.email && typeof req.body.email === 'string') {
      req.body.email = req.body.email.toLowerCase();
    }
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Magic-byte file validation
// ─────────────────────────────────────────────────────────────────────────────

interface MagicByteDef {
  offset: number;
  bytes: number[];
  description: string;
}

const MAGIC_BYTES: MagicByteDef[] = [
  { offset: 0,  bytes: [0x25, 0x50, 0x44, 0x46],              description: 'PDF'  }, // %PDF
  { offset: 0,  bytes: [0x50, 0x4B, 0x03, 0x04],              description: 'DOCX' }, // PK (ZIP)
  { offset: 0,  bytes: [0xFF, 0xD8, 0xFF],                    description: 'JPEG' }, // JPEG
  { offset: 0,  bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], description: 'PNG' }, // PNG
  { offset: 0,  bytes: [0x52, 0x49, 0x46, 0x46],              description: 'RIFF' }, // RIFF (WebP check below)
];

/**
 * Read the first N bytes of a file synchronously.
 * Returns null if the file cannot be read.
 */
function readMagicBytes(filePath: string, count: number): Buffer | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(count);
    fs.readSync(fd, buffer, 0, count, 0);
    fs.closeSync(fd);
    return buffer;
  } catch {
    return null;
  }
}

/**
 * validateFileMagicBytes
 *
 * Checks that the uploaded file's actual binary content matches one of the
 * known magic-byte signatures. Returns true if valid, false otherwise.
 *
 * Call this inside a multer fileFilter or after upload before processing.
 */
export function validateFileMagicBytes(filePath: string, mimeType: string): boolean {
  const header = readMagicBytes(filePath, 12);
  if (!header) return false;

  // Plain-text files have no fixed magic signature.
  // Trust the MIME + extension check from multer for .txt files.
  if (mimeType === 'text/plain') return true;

  for (const { offset, bytes, description } of MAGIC_BYTES) {
    const slice = header.slice(offset, offset + bytes.length);
    if (slice.every((b, i) => b === bytes[i])) {
      // Extra check for WebP: bytes 8-11 must be W E B P
      if (description === 'RIFF') {
        const webp = header.slice(8, 12);
        if (webp.toString('ascii') !== 'WEBP') return false;
      }
      return true;
    }
  }

  return false;
}

/**
 * validateUploadedFile middleware
 *
 * Run AFTER multer has saved the file to disk and BEFORE the controller
 * processes it. If magic bytes don't match, delete the temp file and reject.
 *
 * Usage in routes:
 *   router.post('/upload', upload.single('file'), validateUploadedFile, uploadDocument);
 */
export function validateUploadedFile(req: Request, res: Response, next: NextFunction): void {
  const file = req.file;

  if (!file) {
    // No file — let the controller handle missing-file logic
    next();
    return;
  }

  const isValid = validateFileMagicBytes(file.path, file.mimetype);

  if (!isValid) {
    // Delete the temp file immediately — don't leave it on disk
    try { fs.unlinkSync(file.path); } catch { /* ignore cleanup errors */ }

    res.status(400).json({
      error: 'Invalid file',
      message: 'File content does not match the declared file type. Only genuine PDF, DOCX, TXT, JPEG, PNG, and WebP files are accepted.',
    });
    return;
  }

  next();
}
