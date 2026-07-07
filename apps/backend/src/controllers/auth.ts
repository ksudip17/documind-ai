import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { hashPassword, comparePassword } from '../utils/password';
import { signToken } from '../utils/jwt';
import { RegisterBody, LoginBody } from '../types/auth';

// ── Register ──────────────────────────────────────────────
// Note: Input validation (name/email/password rules) is handled upstream
// by the Zod registerSchema middleware in routes/auth.ts.
export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, password }: RegisterBody = req.body;

    // Check existing user — Prisma P2002 (unique constraint) is caught by
    // errorHandler and returns 409 automatically.
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    // Sign token
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user,
    });
  } catch (error) {
    next(error); // Central errorHandler handles logging + response
  }
}

// ── Login ─────────────────────────────────────────────────
// Note: email/password presence is validated upstream by loginSchema.
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password }: LoginBody = req.body;

    // Find user — return identical 401 whether user is missing or password wrong
    // to prevent user enumeration (timing-safe: always runs bcrypt compare)
    const user = await prisma.user.findUnique({ where: { email } });

    // Constant-time comparison even on missing user to prevent timing attacks
    const dummyHash = '$2b$12$invalidhashpaddingtomatchbcryptlength000000000000000000000';
    const valid = await comparePassword(password, user?.passwordHash ?? dummyHash);

    if (!user || !valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ── Get current user (protected) ─────────────────────────
export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            documents: true,
            queries: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
}
