import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';

export interface ParsedFile {
  text: string;
  pageCount?: number;
  wordCount: number;
}

export async function extractTextFromFile(
  filePath: string,
  mimeType: string
): Promise<ParsedFile> {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // PDF
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    const data = await pdfParse(buffer);
    const text = data.text.trim();
    return {
      text,
      pageCount: data.numpages,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  }

  // DOCX
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.docx'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    return {
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  }

  // Plain text
  if (mimeType === 'text/plain' || ext === '.txt') {
    const text = buffer.toString('utf-8').trim();
    return {
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  }

  // Images — OCR via Tesseract
  if (
    ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mimeType) ||
    ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)
  ) {
    const { data } = await Tesseract.recognize(filePath, 'eng', {
      logger: () => {},
    });
    const text = data.text.trim();
    if (!text || text.length < 10) {
      throw new Error('Could not extract text from image. Make sure the image contains readable text.');
    }
    return {
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}
