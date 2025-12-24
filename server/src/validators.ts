import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(50),
  password: z.string().min(8).max(200)
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const tagInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(40),
  color: z.string().min(1).max(40)
});

export const recipeBlockInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('TEXT'),
    text: z.string().min(0)
  }),
  z.object({
    type: z.literal('PHOTO'),
    photoUrl: z.string().min(1)
  })
]);

export const recipeUpsertSchema = z.object({
  name: z.string().min(1).max(120),
  tags: z.array(tagInputSchema).default([]),
  blocks: z.array(recipeBlockInputSchema).min(1)
});
