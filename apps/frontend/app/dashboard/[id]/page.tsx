'use client';
import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

interface QueryResult {
  answer: string;
  sources: Array<{ content: string; chunkIndex: number }>;
  confidenceScore: number;
  tokensUsed: number;
  responseTimeMs: number;
  cached: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  result?: QueryResult;
}

export default function DocumentQueryPage() {
  const { id } = useParams();
  const router = useRouter();
  const { hydrated } = useAuth();
  const [document, setDocument] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (hydrated) fetchDocument();
  }, [hydrated, id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [question]);

  if (!hydrated) return null;

  async function fetchDocument() {
    try {
      const { data } = await api.get(`/documents/${id}`);
      setDocument(data.document);
    } catch {
      router.push('/dashboard');
    }
  }

  async function handleQuery(e?: React.FormEvent) {
    e?.preventDefault();
    if (!question.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: question };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion('');
    setLoading(true);

    try {
      const { data } = await api.post('/query', {
        question: userMsg.content,
        documentId: id,
      });

      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: data.answer,
        result: data,
      }]);
    } catch (err: any) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: err.response?.data?.error || 'Failed to get answer',
      }]);
    } finally {
      setLoading(false);
    }
  }

  function confidenceLabel(score: number) {
    if (score >= 0.8) return { text: 'High confidence', color: 'text-green-400' };
    if (score >= 0.5) return { text: 'Medium confidence', color: 'text-yellow-400' };
    return { text: 'Low confidence', color: 'text-red-400' };
  }

  return (
    <div className="fixed inset-0 bg-gray-950 flex flex-col overflow-hidden">
      {/* Navbar */}
      <nav className="border-b border-gray-800 px-4 py-3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-gray-400 hover:text-white transition text-sm shrink-0"
          >
            ← Back
          </button>
          <div className="w-px h-4 bg-gray-700 shrink-0" />
          <span className="text-sm font-medium truncate text-gray-200">
            {document?.fileName || 'Loading...'}
          </span>
        </div>
        {document && (
          <span className="text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded-full shrink-0 ml-2">
            {document.chunkCount} chunks
          </span>
        )}
      </nav>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 overscroll-contain">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🤖</div>
              <h3 className="font-medium mb-1 text-sm">Ask anything about this document</h3>
              <p className="text-gray-500 text-xs mb-5">Powered by Llama 3.3 + RAG</p>
              <div className="flex flex-col gap-2">
                {[
                  'What is this document about?',
                  'Summarize the key points',
                  'What are the main topics?',
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuestion(q)}
                    className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-violet-600 text-white max-w-[85%]'
                    : 'bg-gray-900 border border-gray-800 max-w-[95%]'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                {msg.result && (
                  <div className="mt-2 pt-2 border-t border-gray-700 flex flex-wrap gap-2 text-xs">
                    <span className={confidenceLabel(msg.result.confidenceScore).color}>
                      {confidenceLabel(msg.result.confidenceScore).text}
                    </span>
                    <span className="text-gray-500">{msg.result.tokensUsed} tokens</span>
                    <span className="text-gray-500">{msg.result.responseTimeMs}ms</span>
                    {msg.result.cached && (
                      <span className="text-violet-400">⚡ cached</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
                <div className="flex gap-1">
                  {[0, 150, 300].map((delay) => (
                    <div
                      key={delay}
                      className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input — fixed at bottom, mobile safe */}
      <div className="border-t border-gray-800 px-4 py-3 pb-safe shrink-0 bg-gray-950">
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleQuery();
              }
            }}
            placeholder="Ask a question..."
            rows={1}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500 transition resize-none overflow-hidden"
            disabled={loading}
            style={{ minHeight: '44px', maxHeight: '120px' }}
          />
          <button
            onClick={() => handleQuery()}
            disabled={loading || !question.trim()}
            className="px-4 py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-xl text-sm font-medium transition shrink-0"
            style={{ minHeight: '44px' }}
          >
            Ask
          </button>
        </div>
        {/* Safe area for mobile browsers with home indicator */}
        <div className="h-safe-bottom" />
      </div>
    </div>
  );
}
