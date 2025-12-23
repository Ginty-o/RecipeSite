import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import type { DiskStorageOptions } from 'multer';
import type { Prisma, Role } from '@prisma/client';
import type { Secret, SignOptions } from 'jsonwebtoken';
import { v2 as cloudinary } from 'cloudinary';
import { Storage } from '@google-cloud/storage';
import { prisma } from './prisma.js';
import { authOptional, clearAuthCookie, requireAuth, setAuthCookie } from './auth.js';
import { loginSchema, recipeUpsertSchema, registerSchema } from './validators.js';

const app = express();

const port = Number(process.env.PORT ?? 3000);
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

app.use(
  cors({
    origin: corsOrigin,
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(authOptional);

const uploadsDir = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const storage: DiskStorageOptions = {
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
};

const upload = multer({
  storage: multer.diskStorage(storage),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function googleStorageConfigured() {
  return !!(process.env.GCS_BUCKET && (process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS));
}

function createGoogleStorageClient(): Storage {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new Storage();
  }

  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing GCP_SERVICE_ACCOUNT_JSON');

  const creds = JSON.parse(raw) as { client_email?: string; private_key?: string; project_id?: string };
  const privateKey = creds.private_key?.replace(/\\n/g, '\n');

  return new Storage({
    projectId: creds.project_id,
    credentials: {
      client_email: creds.client_email,
      private_key: privateKey
    }
  });
}

function cloudinaryConfigured() {
  if (process.env.CLOUDINARY_URL) return true;
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function configureCloudinaryOnce() {
  if (!cloudinaryConfigured()) return;
  if (process.env.CLOUDINARY_URL) {
    cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL });
    return;
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

function signToken(user: { id: string; email: string; displayName: string; role: 'USER' | 'ADMIN' }) {
  const secret: Secret = process.env.JWT_SECRET ?? 'dev';
  const expiresIn = (process.env.JWT_EXPIRES_IN ?? '7d') as SignOptions['expiresIn'];
  return jwt.sign(user, secret, { expiresIn });
}

async function ensureAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return;

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      displayName: 'Admin',
      passwordHash,
      role: 'ADMIN'
    }
  });
  // eslint-disable-next-line no-console
  console.log(`Created admin user: ${email}`);
}

// Auth
app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const { email, displayName, password } = parsed.data;
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: 'Email already used' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, displayName, passwordHash, role: 'USER' }
    });

    const token = signToken({ id: user.id, email: user.email, displayName: user.displayName, role: user.role as Role });
    setAuthCookie(res, token);
    return res.json({ id: user.id, email: user.email, displayName: user.displayName, role: user.role });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken({ id: user.id, email: user.email, displayName: user.displayName, role: user.role as Role });
    setAuthCookie(res, token);
    return res.json({ id: user.id, email: user.email, displayName: user.displayName, role: user.role });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req: Request, res: Response) => {
  if (!req.user) return res.json(null);
  res.json(req.user);
});

// Upload single photo
app.post(
  '/api/uploads',
  requireAuth,
  (req: Request, res: Response, next) => {
    upload.single('photo')(req, res, (err) => {
      if (!err) return next();

      // Multer uses 500 by default; make it user-friendly.
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Photo too large (max 10MB)' });
        return res.status(400).json({ error: 'Invalid upload' });
      }

      console.error('Upload middleware error:', err);
      return res.status(500).json({ error: 'Upload failed' });
    });
  },
  async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file' });

      if (cloudinaryConfigured()) {
        configureCloudinaryOnce();
        try {
          const folder = process.env.CLOUDINARY_FOLDER || 'recepies';
          const result = await cloudinary.uploader.upload(req.file.path, {
            folder,
            resource_type: 'image'
          });

          // best-effort cleanup of temp file
          try {
            await fs.promises.unlink(req.file.path);
          } catch {
            // ignore
          }

          return res.json({ url: result.secure_url });
        } catch (e) {
          console.error('Cloudinary upload failed:', e);
          return res.status(500).json({ error: 'Upload failed' });
        }
      }

      if (googleStorageConfigured()) {
        const bucketName = process.env.GCS_BUCKET as string;
        const storageClient = createGoogleStorageClient();
        const bucket = storageClient.bucket(bucketName);

        const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const folder = process.env.GCS_FOLDER || 'recepies';
        const objectName = `${folder}/${req.user?.id ?? 'anon'}/${Date.now()}_${safeName}`;

        await bucket.upload(req.file.path, {
          destination: objectName,
          resumable: false,
          contentType: req.file.mimetype,
          metadata: {
            cacheControl: 'public, max-age=31536000, immutable'
          }
        });

        // best-effort cleanup of temp file
        try {
          await fs.promises.unlink(req.file.path);
        } catch {
          // ignore
        }

        // NOTE: object readability depends on bucket IAM (recommended: bucket grants allUsers Storage Object Viewer)
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURI(objectName)}`;
        return res.json({ url: publicUrl });
      }

      // Fallback: serve from this server's filesystem (not reliable on many hosts)
      const url = `/uploads/${req.file.filename}`;
      return res.json({ url });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Upload failed' });
    }
  }
);

// Recipes list (search by name or tag)
app.get('/api/recipes', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim();

    const recipes = await prisma.recipe.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { recipeTags: { some: { tag: { name: { contains: q, mode: 'insensitive' } } } } }
            ]
          }
        : undefined,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        ownerId: true,
        owner: { select: { displayName: true } },
        recipeTags: { select: { tag: { select: { id: true, name: true, color: true } } } },
        blocks: { orderBy: { order: 'asc' }, take: 1, select: { type: true, photoUrl: true } }
      } satisfies Prisma.RecipeSelect
    });

    return res.json(
      recipes.map((r) => ({
        id: r.id,
        name: r.name,
        ownerId: r.ownerId,
        ownerDisplayName: r.owner.displayName,
        tags: r.recipeTags.map((rt) => rt.tag),
        firstPhotoUrl: r.blocks[0]?.type === 'PHOTO' ? r.blocks[0].photoUrl : null
      }))
    );
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/recipes/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    const recipeDetailSelect = {
      id: true,
      name: true,
      ownerId: true,
      owner: { select: { displayName: true } },
      recipeTags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      blocks: { orderBy: { order: 'asc' }, select: { id: true, order: true, type: true, text: true, photoUrl: true } }
    } satisfies Prisma.RecipeSelect;

    const recipe = await prisma.recipe.findUnique({
      where: { id },
      select: recipeDetailSelect
    });

    if (!recipe) return res.status(404).json({ error: 'Not found' });

    return res.json({
      id: recipe.id,
      name: recipe.name,
      ownerId: recipe.ownerId,
      ownerDisplayName: recipe.owner.displayName,
      tags: recipe.recipeTags.map((rt) => rt.tag),
      blocks: recipe.blocks
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

function canEdit(user: { id: string; role: 'USER' | 'ADMIN' } | undefined, ownerId: string) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  return user.id === ownerId;
}

app.post('/api/recipes', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = recipeUpsertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const { name, tags, blocks } = parsed.data;

    const created = await prisma.recipe.create({
      data: {
        name,
        ownerId: req.user!.id,
        recipeTags: {
          create: await Promise.all(
            tags.map(async (t) => {
              const tag = await prisma.tag.upsert({
                where: { name_color: { name: t.name, color: t.color } },
                update: {},
                create: { name: t.name, color: t.color }
              });
              return { tagId: tag.id };
            })
          )
        },
        blocks: {
          create: blocks.map((b, idx) =>
            b.type === 'TEXT'
              ? { order: idx, type: 'TEXT', text: b.text }
              : { order: idx, type: 'PHOTO', photoUrl: b.photoUrl }
          )
        }
      }
    });

    return res.json({ id: created.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/recipes/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const existing = await prisma.recipe.findUnique({ where: { id }, select: { ownerId: true } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!canEdit(req.user, existing.ownerId)) return res.status(403).json({ error: 'Forbidden' });

    const parsed = recipeUpsertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const { name, tags, blocks } = parsed.data;

    await prisma.recipe.update({
      where: { id },
      data: {
        name,
        recipeTags: {
          deleteMany: {},
          create: await Promise.all(
            tags.map(async (t) => {
              const tag = await prisma.tag.upsert({
                where: { name_color: { name: t.name, color: t.color } },
                update: {},
                create: { name: t.name, color: t.color }
              });
              return { tagId: tag.id };
            })
          )
        },
        blocks: {
          deleteMany: {},
          create: blocks.map((b, idx) =>
            b.type === 'TEXT'
              ? { order: idx, type: 'TEXT', text: b.text }
              : { order: idx, type: 'PHOTO', photoUrl: b.photoUrl }
          )
        }
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/recipes/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const existing = await prisma.recipe.findUnique({ where: { id }, select: { ownerId: true } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!canEdit(req.user, existing.ownerId)) return res.status(403).json({ error: 'Forbidden' });

    await prisma.recipe.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/health', (_req: Request, res: Response) => res.json({ ok: true }));

ensureAdminUser()
  .catch((e) => console.error(e))
  .finally(() => {
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Server listening on http://localhost:${port}`);
    });
  });
