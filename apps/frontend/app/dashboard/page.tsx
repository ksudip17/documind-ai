'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { formatFileSize, formatDate } from '@/lib/utils';

interface Document {
  id: string;
  fileName: string;
  fileSize: number;
  status: string;
  chunkCount: number | null;
  createdAt: string;
  _count: { queries: number };
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, hydrated } = useAuth();
  const { logout } = useAuthStore();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hydrated) fetchDocuments();
  }, [hydrated]);

  useEffect(() => {
    const hasPending = documents.some(
      (d) => d.status === 'PENDING' || d.status === 'PROCESSING'
    );
    if (!hasPending) return;
    const interval = setInterval(async () => {
      const { data } = await api.get('/documents');
      setDocuments(data.documents);
    }, 3000);
    return () => clearInterval(interval);
  }, [documents]);

  async function fetchDocuments() {
    try {
      const { data } = await api.get('/documents');
      setDocuments(data.documents);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await fetchDocuments();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function statusColor(status: string) {
    if (status === 'COMPLETED') return 'text-green-400 bg-green-400/10';
    if (status === 'PROCESSING') return 'text-yellow-400 bg-yellow-400/10';
    if (status === 'FAILED') return 'text-red-400 bg-red-400/10';
    return 'text-gray-400 bg-gray-400/10';
  }

  function fileIcon(fileName: string) {
    if (fileName.match(/\.(jpg|jpeg|png|webp)$/i)) return '🖼️';
    if (fileName.endsWith('.pdf')) return '📕';
    if (fileName.endsWith('.docx')) return '📘';
    return '📄';
  }

  if (!hydrated) return null;

  return (
    <div className="min-h-screen bg-gray-950 w-full overflow-x-hidden">
      {/* Navbar */}
      <nav className="border-b border-gray-800 px-4 py-3 w-full">
        <div className="max-w-5xl mx-auto flex justify-between items-center gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/logo.png"
              alt="DocuMind AI"
              className="w-7 h-7 rounded-lg object-cover shrink-0"
            />
            <span className="font-semibold text-sm sm:text-base truncate">
              DocuMind AI
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <span className="text-xs sm:text-sm text-gray-400 truncate max-w-[100px] sm:max-w-none">
              {user?.name}
            </span>
            <button
              onClick={() => { logout(); router.push('/'); }}
              className="text-xs sm:text-sm text-gray-400 hover:text-white transition"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-6 w-full">
        {/* Header */}
        <div className="flex justify-between items-start sm:items-center gap-3 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Your Documents</h1>
            <p className="text-gray-400 text-xs sm:text-sm mt-0.5">
              {documents.length} document{documents.length !== 1 ? 's' : ''} uploaded
            </p>
          </div>
          <div className="shrink-0">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.jpg,.jpeg,.png"
              className="hidden"
              onChange={handleUpload}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-3 py-2 sm:px-5 sm:py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-xl text-xs sm:text-sm font-medium transition"
            >
              {uploading ? 'Uploading...' : '+ Upload Document'}
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {documents.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: 'Documents', value: documents.length },
              { label: 'Completed', value: documents.filter(d => d.status === 'COMPLETED').length },
              { label: 'Queries', value: documents.reduce((a, d) => a + d._count.queries, 0) },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"
              >
                <p className="text-xl sm:text-2xl font-bold text-violet-400">{stat.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Document list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-gray-800 rounded-lg shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="w-3/4 h-3 bg-gray-800 rounded" />
                    <div className="w-1/2 h-2 bg-gray-800 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📄</div>
            <h3 className="text-base font-medium mb-1">No documents yet</h3>
            <p className="text-gray-500 text-sm mb-5">
              Upload a PDF, DOCX, TXT, or image file
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 rounded-xl text-sm font-medium transition"
            >
              Upload your first document
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                onClick={() =>
                  doc.status === 'COMPLETED' && router.push(`/dashboard/${doc.id}`)
                }
                className={`bg-gray-900 border border-gray-800 rounded-xl p-4 w-full
                  ${doc.status === 'COMPLETED'
                    ? 'cursor-pointer hover:border-violet-500/50 active:bg-gray-800 transition'
                    : 'opacity-80'
                  }`}
              >
                <div className="flex items-center gap-3 w-full min-w-0">
                  {/* Icon */}
                  <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center text-base shrink-0">
                    {fileIcon(doc.fileName)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{doc.fileName}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatFileSize(doc.fileSize)} · {formatDate(doc.createdAt)}
                      {doc.chunkCount ? ` · ${doc.chunkCount} chunks` : ''}
                    </p>
                  </div>

                  {/* Status + queries */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(doc.status)}`}
                    >
                      {doc.status === 'PROCESSING' && (
                        <span className="inline-block w-1.5 h-1.5 bg-yellow-400 rounded-full mr-1 animate-pulse" />
                      )}
                      {doc.status}
                    </span>
                    <span className="text-xs text-gray-500">
                      {doc._count.queries} {doc._count.queries === 1 ? 'query' : 'queries'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
