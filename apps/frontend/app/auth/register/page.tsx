'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

// Password requirements — mirrors the Zod registerSchema on the backend
const PASSWORD_RULES = [
  { label: 'At least 8 characters',       test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter (A–Z)',   test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter (a–z)',   test: (p: string) => /[a-z]/.test(p) },
  { label: 'One number (0–9)',             test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character (!@#…)', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [globalError, setGlobalError] = useState('');
  // fieldErrors: map of field name → error message from the API
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const passwordStrength = PASSWORD_RULES.filter((r) => r.test(form.password)).length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setGlobalError('');
    setFieldErrors({});

    try {
      const { data } = await api.post('/auth/register', form);
      setAuth(data.user, data.token);
      router.push('/dashboard');
    } catch (err: any) {
      const resp = err.response?.data;

      if (resp?.fields && Array.isArray(resp.fields)) {
        // Zod field-level errors — map to { fieldName: firstMessage }
        const mapped: Record<string, string> = {};
        resp.fields.forEach((f: { field: string; message: string }) => {
          if (!mapped[f.field]) mapped[f.field] = f.message;
        });
        setFieldErrors(mapped);
        setGlobalError('Please fix the errors below and try again.');
      } else {
        setGlobalError(resp?.error || 'Registration failed. Please try again.');
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
          <h1 className="text-2xl font-bold">Create account</h1>
          <p className="text-gray-400 mt-1">Start querying your documents with AI</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8 space-y-5">
          {/* Global error banner */}
          {globalError && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
              {globalError}
            </div>
          )}

          {/* Full name */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Full name</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass('name')}
              placeholder="Samir Thapa"
            />
            {fieldErrors.name && (
              <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                <span>⚠</span> {fieldErrors.name}
              </p>
            )}
          </div>

          {/* Email */}
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

          {/* Password */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                className={inputClass('password')}
                placeholder="Min 8 characters"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition text-lg"
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>

            {/* API error for password field */}
            {fieldErrors.password && (
              <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                <span>⚠</span> {fieldErrors.password}
              </p>
            )}

            {/* Live password strength checklist — shown when focused or has content */}
            {(passwordFocused || form.password.length > 0) && (
              <div className="mt-3 p-3 bg-gray-800/60 rounded-lg border border-gray-700/50 space-y-1.5">
                <p className="text-xs text-gray-400 font-medium mb-2">Password requirements:</p>
                {PASSWORD_RULES.map((rule) => {
                  const passed = rule.test(form.password);
                  return (
                    <div key={rule.label} className="flex items-center gap-2">
                      <span className={`text-xs font-bold transition-colors ${passed ? 'text-green-400' : 'text-gray-600'}`}>
                        {passed ? '✓' : '○'}
                      </span>
                      <span className={`text-xs transition-colors ${passed ? 'text-green-400' : 'text-gray-500'}`}>
                        {rule.label}
                      </span>
                    </div>
                  );
                })}

                {/* Strength bar */}
                <div className="mt-2 flex gap-1">
                  {PASSWORD_RULES.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                        i < passwordStrength
                          ? passwordStrength <= 2
                            ? 'bg-red-500'
                            : passwordStrength <= 3
                            ? 'bg-yellow-500'
                            : passwordStrength <= 4
                            ? 'bg-blue-500'
                            : 'bg-green-500'
                          : 'bg-gray-700'
                      }`}
                    />
                  ))}
                </div>
                <p className={`text-xs text-right font-medium ${
                  passwordStrength <= 2 ? 'text-red-400' :
                  passwordStrength <= 3 ? 'text-yellow-400' :
                  passwordStrength <= 4 ? 'text-blue-400' : 'text-green-400'
                }`}>
                  {passwordStrength <= 2 ? 'Weak' : passwordStrength <= 3 ? 'Fair' : passwordStrength <= 4 ? 'Good' : 'Strong'}
                </p>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg py-3 text-sm font-medium transition"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>

          <p className="text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-violet-400 hover:text-violet-300">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}


