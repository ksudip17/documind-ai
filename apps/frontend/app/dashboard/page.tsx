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

  async function fetchDocuments() {
    try {
      const { data } = await api.get('/documents');
      setDocuments(data.documents);
    } catch {
      // api interceptor handles 401 redirect
    } finally {
      setLoading(false);
    }
  }

  // Auto-poll while any document is pending/processing
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

  // Show nothing until hydration completes — prevents flash redirect
  if (!hydrated) return null;

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Navbar */}
      <nav className="border-b border-gray-800 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center text-sm font-bold">
            D
          </div>
          <span className="font-semibold">DocuMind AI</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{user?.name}</span>

          <button
            onClick={() => {
              logout();
              router.push('/');
            }}
            className="text-sm text-gray-400 hover:text-white transition"
          >
            Logout
          </button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold">Your Documents</h1>

            <p className="text-gray-400 text-sm mt-1">
              {documents.length} document
              {documents.length !== 1 ? 's' : ''} uploaded
            </p>
          </div>

          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              onChange={handleUpload}
            />

            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-xl text-sm font-medium transition"
            >
              {uploading ? 'Uploading...' : '+ Upload Document'}
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {documents.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              { label: 'Documents', value: documents.length },
              {
                label: 'Completed',
                value: documents.filter(
                  (d) => d.status === 'COMPLETED'
                ).length,
              },
              {
                label: 'Total Queries',
                value: documents.reduce(
                  (a, d) => a + d._count.queries,
                  0
                ),
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center"
              >
                <p className="text-2xl font-bold text-violet-400">
                  {stat.value}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Document list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-gray-900 border border-gray-800 rounded-xl p-5 animate-pulse"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gray-800 rounded-lg" />

                  <div className="space-y-2">
                    <div className="w-48 h-4 bg-gray-800 rounded" />
                    <div className="w-32 h-3 bg-gray-800 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">📄</div>

            <h3 className="text-lg font-medium mb-2">No documents yet</h3>

            <p className="text-gray-500 text-sm mb-6">
              Upload a PDF, DOCX, or TXT file to get started
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
                  doc.status === 'COMPLETED' &&
                  router.push(`/dashboard/${doc.id}`)
                }
                className={`bg-gray-900 border border-gray-800 rounded-xl p-5 flex justify-between items-center ${
                  doc.status === 'COMPLETED'
                    ? 'cursor-pointer hover:border-violet-500/50 transition'
                    : 'opacity-80'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center text-lg">
                    {doc.fileName.endsWith('.pdf')
                      ? '📕'
                      : doc.fileName.endsWith('.docx')
                      ? '📘'
                      : '📄'}
                  </div>

                  <div>
                    <p className="font-medium text-sm">{doc.fileName}</p>

                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatFileSize(doc.fileSize)} ·{' '}
                      {formatDate(doc.createdAt)}
                      {doc.chunkCount
                        ? ` · ${doc.chunkCount} chunks`
                        : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span className="text-xs text-gray-500">
                    {doc._count.queries} queries
                  </span>

                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColor(
                      doc.status
                    )}`}
                  >
                    {doc.status === 'PROCESSING' && (
                      <span className="inline-block w-1.5 h-1.5 bg-yellow-400 rounded-full mr-1.5 animate-pulse" />
                    )}

                    {doc.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}