export type Role = 'USER' | 'ADMIN';

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
};

export type Tag = { id?: string; name: string; color: string };

export type RecipeListItem = {
  id: string;
  name: string;
  ownerId: string;
  ownerDisplayName: string;
  tags: Tag[];
  firstPhotoUrl: string | null;
};

export type RecipeBlock =
  | { id?: string; type: 'TEXT'; text: string }
  | { id?: string; type: 'PHOTO'; photoUrl: string };

export type Recipe = {
  id: string;
  name: string;
  ownerId: string;
  ownerDisplayName: string;
  tags: Tag[];
  blocks: Array<{ id: string; order: number } & RecipeBlock>;
};

async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    credentials: 'include'
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data?.error ?? msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return (await res.json()) as T;
}

export const api = {
  me: () => apiFetch<AuthUser | null>('/api/auth/me'),
  register: (payload: { email: string; displayName: string; password: string }) =>
    apiFetch<AuthUser>('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: { email: string; password: string }) =>
    apiFetch<AuthUser>('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => apiFetch<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  listRecipes: (q: string, tagIds: string[] = []) => {
    const params = new URLSearchParams();
    params.set('q', q);
    if (tagIds.length) params.set('tagIds', tagIds.join(','));
    return apiFetch<RecipeListItem[]>(`/api/recipes?${params.toString()}`);
  },
  getRecipe: (id: string) => apiFetch<Recipe>(`/api/recipes/${encodeURIComponent(id)}`),
  createRecipe: (payload: { name: string; tags: Tag[]; blocks: RecipeBlock[] }) =>
    apiFetch<{ id: string }>('/api/recipes', { method: 'POST', body: JSON.stringify(payload) }),
  updateRecipe: (id: string, payload: { name: string; tags: Tag[]; blocks: RecipeBlock[] }) =>
    apiFetch<{ ok: true }>(`/api/recipes/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteRecipe: (id: string) => apiFetch<{ ok: true }>(`/api/recipes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  uploadPhoto: async (file: File): Promise<{ url: string }> => {
    const fd = new FormData();
    fd.append('photo', file);
    const res = await fetch('/api/uploads', { method: 'POST', body: fd, credentials: 'include' });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        msg = data?.error ?? msg;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    return (await res.json()) as { url: string };
  }
  ,
  listTags: (q: string) => apiFetch<Tag[]>(`/api/tags?q=${encodeURIComponent(q)}`)
};
