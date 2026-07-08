'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({ email: '', password: '' });
  const [globalError, setGlobalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setGlobalError('');
    setFieldErrors({});
    try {
      const { data } = await api.post('/auth/login', form);
      setAuth(data.user, data.token);
      router.push('/dashboard');
    } catch (err: any) {
      const resp = err.response?.data;
      if (resp?.fields && Array.isArray(resp.fields)) {
        const mapped: Record<string, string> = {};
        resp.fields.forEach((f: { field: string; message: string }) => {
          if (!mapped[f.field]) mapped[f.field] = f.message;
        });
        setFieldErrors(mapped);
        setGlobalError('Please check your details and try again.');
      } else {
        setGlobalError(resp?.error || 'Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  const inputClass = (field: string) =>
    `w-full bg-gray-800 border rounded-lg px-4 py-3 text-sm focus:outline-none transition ${
      fieldErrors[field]
        ? 'border-red-500 focus:border-red-400'
        : 'border-gray-700 focus:border-violet-500'
    }`;


  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="DocuMind AI" className="w-12 h-12 rounded-xl object-cover mx-auto mb-4" />
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="text-gray-400 mt-1">Sign in to your DocuMind account</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8 space-y-5">
          {globalError && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
              {globalError}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-2">Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputClass('email')}
              placeholder="samir@example.com"
            />
            {fieldErrors.email && (
              <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                <span>⚠</span> {fieldErrors.email}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className={`${inputClass('password')} pr-12`}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition text-lg"
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-3 text-sm font-medium transition"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <p className="text-center text-sm text-gray-500">
            No account?{' '}
            <Link href="/auth/register" className="text-violet-400 hover:text-violet-300">
              Create one
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
