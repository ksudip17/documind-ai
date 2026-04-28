import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

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

  if (mimeType === 'application/pdf') {
    const data = await pdfParse(buffer);
    const text = data.text.trim();
    return {
      text,
      pageCount: data.numpages,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    path.extname(filePath).toLowerCase() === '.docx'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    return {
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  }

  if (mimeType === 'text/plain') {
    const text = buffer.toString('utf-8').trim();
    return {
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}
