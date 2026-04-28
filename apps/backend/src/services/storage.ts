import fs from 'fs';
import path from 'path';
import { supabase } from '../config/supabase';

const BUCKET = 'documents';

export async function uploadToStorage(
  localFilePath: string,
  userId: string,
  originalName: string
): Promise<string> {
  const fileBuffer = fs.readFileSync(localFilePath);
  const ext = path.extname(originalName);
  const storagePath = `${userId}/${Date.now()}${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: getContentType(ext),
      upsert: false,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  // Return the storage path (not public URL since bucket is private)
  return storagePath;
}

export async function deleteFromStorage(storagePath: string): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([storagePath]);

  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

export async function getSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600); // 1 hour expiry

  if (error || !data) throw new Error(`Failed to get signed URL: ${error?.message}`);
  return data.signedUrl;
}

function getContentType(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}
