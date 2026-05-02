import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-950 flex flex-col">
      {/* Navbar */}
      <nav className="border-b border-gray-800 px-4 py-4 w-full overflow-x-hidden">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="DocuMind AI" className="w-7 h-7 rounded-lg object-cover" />
            <span className="font-semibold text-sm sm:text-base">DocuMind AI</span>
          </div>
          <div className="flex gap-2 sm:gap-3">
            <Link href="/auth/login" className="px-3 py-1.5 text-xs sm:text-sm text-gray-300 hover:text-white transition">
              Login
            </Link>
            <Link href="/auth/register" className="px-3 py-1.5 text-xs sm:text-sm bg-violet-600 hover:bg-violet-700 rounded-lg transition">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 text-sm text-violet-400 mb-8">
          ✨ Powered by Llama 3.3 + RAG Pipeline
        </div>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 max-w-4xl">
          Ask questions to
          <span className="text-violet-400"> any document</span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mb-10">
          Upload PDFs, DOCX, or text files. Get instant AI-powered answers with source citations.
          Built on RAG pipeline with vector search.
        </p>
        <div className="flex gap-4">
          <Link href="/auth/register" className="px-8 py-3 bg-violet-600 hover:bg-violet-700 rounded-xl font-medium transition">
            Start for free
          </Link>
          <Link href="/auth/login" className="px-8 py-3 border border-gray-700 hover:border-gray-500 rounded-xl font-medium transition">
            Sign in
          </Link>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-3 mt-16">
          {[
            '📄 PDF & DOCX Support',
            '🔍 Vector Similarity Search',
            '🤖 Llama 3.3 70B',
            '⚡ Redis Caching',
            '🔐 JWT Auth',
            '📊 Confidence Scoring',
          ].map((f) => (
            <span key={f} className="px-4 py-2 bg-gray-900 border border-gray-800 rounded-full text-sm text-gray-300">
              {f}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}
