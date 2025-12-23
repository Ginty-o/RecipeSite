import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: 'USER' | 'ADMIN';
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const cookieName = 'auth_token';

export function setAuthCookie(res: Response, token: string) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(cookieName, { path: '/' });
}

export function authOptional(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[cookieName];
  if (!token) return next();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET ?? 'dev') as AuthUser;
    req.user = payload;
  } catch {
    // ignore
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  next();
}
