import './styles.css';
import { api, type AuthUser, type Recipe, type RecipeBlock, type RecipeListItem, type Tag } from './api';

type AppState = {
  user: AuthUser | null;
  query: string;
  recipes: RecipeListItem[];
  showThumbs: boolean;
};

const state: AppState = {
  user: null,
  query: '',
  recipes: [],
  showThumbs: false
};

let listHost: HTMLElement | null = null;
let userAreaHost: HTMLElement | null = null;
let searchInputEl: HTMLInputElement | null = null;

const THEME_KEY = 'theme';

function getTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

function setTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, any>, ...children: Array<Node | string>) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = String(v);
      else if (k.startsWith('on') && typeof v === 'function') (node as any)[k.toLowerCase()] = v;
      else if (v !== undefined && v !== null) node.setAttribute(k, String(v));
    }
  }
  for (const child of children) node.append(child instanceof Node ? child : document.createTextNode(child));
  return node;
}

function tagPill(t: Tag) {
  const span = el('span', { class: 'tag' }, t.name);
  span.style.borderColor = t.color;
  span.style.color = t.color;
  return span;
}

function modal(title: string, body: Node, actions: Node[] = []) {
  const overlay = el('div', { class: 'modalOverlay' });
  const card = el('div', { class: 'modal' });
  overlay.append(card);

  const header = el('div', { class: 'modalHeader' });
  const left = el('div', {}, title);
  const right = el('div', { class: 'row' });
  const closeBtn = el('button', { class: 'pill', onclick: () => overlay.remove(), type: 'button' }, 'Close');
  for (const a of actions) right.append(a);
  right.append(closeBtn);
  header.append(left, right);

  const content = el('div', { class: 'modalBody' });
  content.append(body);

  card.append(header, content);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.append(overlay);
  return overlay;
}

function renderTopbar(root: HTMLElement) {
  const theme = getTheme();
  const themeBtn = el(
    'button',
    {
      class: 'pill',
      type: 'button',
      onclick: () => {
        const next = getTheme() === 'dark' ? 'light' : 'dark';
        setTheme(next);
      }
    },
    theme === 'dark' ? 'Dark' : 'Light'
  );

  const searchInput = el('input', {
    class: 'search',
    placeholder: 'Search recipes or tags…',
    value: state.query,
    oninput: async (e: Event) => {
      state.query = (e.target as HTMLInputElement).value;
      await refreshRecipes();
      renderList();
    }
  }) as HTMLInputElement;

  searchInputEl = searchInput;

  const userArea = el('div', { class: 'right' });
  userAreaHost = userArea;

  const top = el('div', { class: 'topbar' },
    el('div', { class: 'brand' }, 'Recepies'),
    searchInput,
    userArea
  );

  root.append(top);
}

function renderUserArea() {
  if (!userAreaHost) return;
  userAreaHost.replaceChildren();

  const themeBtn = el(
    'button',
    {
      class: 'pill',
      type: 'button',
      onclick: () => {
        const next = getTheme() === 'dark' ? 'light' : 'dark';
        setTheme(next);
      }
    },
    getTheme() === 'dark' ? 'Dark' : 'Light'
  );

  if (!state.user) {
    const loginBtn = el('button', { class: 'pill primary', type: 'button', onclick: () => openLoginModal() }, 'Login');
    userAreaHost.append(themeBtn, loginBtn);
    return;
  }

  const name = el('div', {}, state.user.displayName);
  const plus = el('button', { class: 'pill primary', type: 'button', onclick: () => openRecipeEditorModal() }, '+');
  const logout = el(
    'button',
    {
      class: 'pill',
      type: 'button',
      onclick: async () => {
        await api.logout();
        state.user = null;
        renderUserArea();
      }
    },
    'Logout'
  );
  userAreaHost.append(themeBtn, name, plus, logout);
}

function renderList() {
  if (!listHost) return;
  listHost.replaceChildren();

  const controls = el('div', { class: 'row', style: 'justify-content: space-between; margin-top: 12px;' });
  controls.append(
    el('div', { class: 'small' }, `${state.recipes.length} recepies`),
    el(
      'button',
      {
        class: 'pill',
        type: 'button',
        onclick: () => {
          state.showThumbs = !state.showThumbs;
          renderList();
        }
      },
      state.showThumbs ? 'Hide first photo' : 'Show first photo'
    )
  );
  listHost.append(controls);

  const list = el('div', { class: 'list' });
  for (const r of state.recipes) {
    const left = el('div', {},
      el('div', { class: 'recipeTitle' }, r.name),
      el('div', { class: 'small' }, `By ${r.ownerDisplayName}`)
    );

    const tags = el('div', { class: 'tags' });
    for (const t of r.tags) tags.append(tagPill(t));
    left.append(tags);

    const right = el('div', { class: 'row' });
    if (state.showThumbs && r.firstPhotoUrl) {
      right.append(el('img', { class: 'thumb', src: r.firstPhotoUrl, alt: '' }));
    }

    const row = el('div', { class: 'recipeRow', onclick: () => openRecipeModal(r.id) }, left, right);
    const card = el('div', { class: 'card' }, row);
    list.append(card);
  }

  listHost.append(list);
}

async function openRecipeModal(id: string) {
  let recipe: Recipe;
  try {
    recipe = await api.getRecipe(id);
  } catch (e: any) {
    modal('Error', el('div', {}, e?.message ?? 'Failed to load'));
    return;
  }

  const canEdit = !!state.user && (state.user.role === 'ADMIN' || state.user.id === recipe.ownerId);

  const body = el('div', {});
  body.append(el('div', { class: 'small' }, `By ${recipe.ownerDisplayName}`));

  const tags = el('div', { class: 'tags', style: 'margin-top: 10px;' });
  for (const t of recipe.tags) tags.append(tagPill(t));
  body.append(tags);

  body.append(el('div', { style: 'height: 12px;' }));

  for (const b of recipe.blocks) {
    if (b.type === 'TEXT') {
      body.append(el('div', { class: 'blockText', style: 'margin-bottom: 12px;' }, b.text ?? ''));
    } else {
      body.append(el('img', { class: 'blockPhoto', style: 'margin-bottom: 12px;', src: b.photoUrl ?? '', alt: '' }));
    }
  }

  const actions: Node[] = [];
  if (canEdit) {
    actions.push(el('button', { class: 'pill primary', type: 'button', onclick: () => { openRecipeEditorModal(recipe); } }, 'Edit'));
  }

  modal(recipe.name, body, actions);
}

function openLoginModal() {
  const email = el('input', { class: 'input', placeholder: 'Email', type: 'email' }) as HTMLInputElement;
  const displayName = el('input', { class: 'input', placeholder: 'Display name (register only)', type: 'text' }) as HTMLInputElement;
  const password = el('input', { class: 'input', placeholder: 'Password', type: 'password' }) as HTMLInputElement;

  const msg = el('div', { class: 'small' }, '');

  const body = el('div', {},
    el('div', { class: 'field' }, el('div', {}, 'Email'), email),
    el('div', { class: 'field' }, el('div', {}, 'Password'), password),
    el('div', { class: 'field' }, el('div', {}, 'Display name'), displayName),
    msg
  );

  const overlay = modal('Login / Register', body, [
    el('button', {
      class: 'pill',
      type: 'button',
      onclick: async () => {
        try {
          const user = await api.login({ email: email.value, password: password.value });
          state.user = user;
          overlay.remove();
          renderUserArea();
        } catch (e: any) {
          msg.textContent = e?.message ?? 'Login failed';
        }
      }
    }, 'Login'),
    el('button', {
      class: 'pill primary',
      type: 'button',
      onclick: async () => {
        try {
          const user = await api.register({ email: email.value, password: password.value, displayName: displayName.value || email.value });
          state.user = user;
          overlay.remove();
          renderUserArea();
        } catch (e: any) {
          msg.textContent = e?.message ?? 'Register failed';
        }
      }
    }, 'Register')
  ]);
}

function openRecipeEditorModal(existing?: Recipe) {
  const name = el('input', { class: 'input', placeholder: 'Recipe name', type: 'text' }) as HTMLInputElement;
  name.value = existing?.name ?? '';

  let blocks: RecipeBlock[] = existing
    ? existing.blocks.map((b) => (b.type === 'TEXT' ? { type: 'TEXT', text: b.text ?? '' } : { type: 'PHOTO', photoUrl: b.photoUrl ?? '' }))
    : [{ type: 'TEXT', text: '' }];

  let tags: Tag[] = existing ? existing.tags.map((t) => ({ name: t.name, color: t.color })) : [];

  const msg = el('div', { class: 'small' }, '');

  const blocksHost = el('div', {});

  const renderBlocks = () => {
    blocksHost.replaceChildren();
    blocks.forEach((b, idx) => {
      const row = el('div', { class: 'card', style: 'margin-bottom: 10px;' });

      const controls = el('div', { class: 'row', style: 'justify-content: space-between; margin-bottom: 8px;' });
      const left = el('div', { class: 'small' }, `Block ${idx + 1} (${b.type})`);
      const right = el('div', { class: 'row' });

      const up = el('button', {
        class: 'pill',
        type: 'button',
        onclick: () => {
          if (idx === 0) return;
          const tmp = blocks[idx - 1];
          blocks[idx - 1] = blocks[idx];
          blocks[idx] = tmp;
          renderBlocks();
        }
      }, 'Up');

      const down = el('button', {
        class: 'pill',
        type: 'button',
        onclick: () => {
          if (idx === blocks.length - 1) return;
          const tmp = blocks[idx + 1];
          blocks[idx + 1] = blocks[idx];
          blocks[idx] = tmp;
          renderBlocks();
        }
      }, 'Down');

      const del = el('button', {
        class: 'pill danger',
        type: 'button',
        onclick: () => {
          blocks.splice(idx, 1);
          if (blocks.length === 0) blocks.push({ type: 'TEXT', text: '' });
          renderBlocks();
        }
      }, 'Delete');

      right.append(up, down, del);
      controls.append(left, right);

      row.append(controls);

      if (b.type === 'TEXT') {
        const ta = el('textarea', { class: 'input', style: 'min-height: 120px;' }) as HTMLTextAreaElement;
        ta.value = b.text;
        ta.oninput = () => (b.text = ta.value);
        row.append(ta);
      } else {
        const current = el('div', { class: 'small' }, b.photoUrl ? `Uploaded: ${b.photoUrl}` : 'No photo uploaded');
        const file = el('input', { type: 'file', accept: 'image/*' }) as HTMLInputElement;
        file.onchange = async () => {
          const f = file.files?.[0];
          if (!f) return;
          msg.textContent = 'Uploading…';
          try {
            const { url } = await api.uploadPhoto(f);
            b.photoUrl = url;
            msg.textContent = '';
            renderBlocks();
          } catch (e: any) {
            msg.textContent = e?.message ?? 'Upload failed';
          }
        };
        row.append(current, el('div', { style: 'height: 8px;' }), file);
      }

      blocksHost.append(row);
    });
  };

  const tagsHost = el('div', { class: 'tags' });

  const renderTags = () => {
    tagsHost.replaceChildren();
    tags.forEach((t, idx) => {
      const pill = tagPill(t);
      pill.style.cursor = 'pointer';
      pill.title = 'Click to remove';
      pill.onclick = () => {
        tags.splice(idx, 1);
        renderTags();
      };
      tagsHost.append(pill);
    });
  };

  const tagName = el('input', { class: 'input', placeholder: 'Tag name', type: 'text' }) as HTMLInputElement;
  const tagColor = el('input', { class: 'input', type: 'color', value: '#2563eb' }) as HTMLInputElement;
  const addTag = el('button', {
    class: 'pill',
    type: 'button',
    onclick: () => {
      const n = tagName.value.trim();
      if (!n) return;
      tags.push({ name: n, color: tagColor.value });
      tagName.value = '';
      renderTags();
    }
  }, 'Add tag');

  const addText = el('button', {
    class: 'pill',
    type: 'button',
    onclick: () => {
      blocks.push({ type: 'TEXT', text: '' });
      renderBlocks();
    }
  }, 'Add text');

  const addPhoto = el('button', {
    class: 'pill',
    type: 'button',
    onclick: () => {
      blocks.push({ type: 'PHOTO', photoUrl: '' });
      renderBlocks();
    }
  }, 'Add photo');

  const body = el('div', {},
    el('div', { class: 'field' }, el('div', {}, 'Recipe name'), name),
    el('div', { class: 'field' },
      el('div', {}, 'Tags (click a tag to remove)'),
      el('div', { class: 'row' }, tagName, tagColor, addTag),
      tagsHost
    ),
    el('div', { class: 'row', style: 'justify-content: flex-start; margin-bottom: 10px;' }, addText, addPhoto),
    blocksHost,
    msg
  );

  renderTags();
  renderBlocks();

  const overlay = modal(existing ? 'Edit recipe' : 'Create recipe', body, [
    ...(existing
      ? [
          el(
            'button',
            {
              class: 'pill danger',
              type: 'button',
              onclick: async () => {
                if (!existing) return;
                const ok = window.confirm('Delete this recipe? This cannot be undone.');
                if (!ok) return;
                msg.textContent = '';
                try {
                  await api.deleteRecipe(existing.id);
                  await refreshRecipes();
                  overlay.remove();
                  renderList();
                } catch (e: any) {
                  msg.textContent = e?.message ?? 'Delete failed';
                }
              }
            },
            'Delete'
          )
        ]
      : []),
    el('button', {
      class: 'pill primary',
      type: 'button',
      onclick: async () => {
        msg.textContent = '';
        const payload = {
          name: name.value.trim(),
          tags,
          blocks
        };
        if (!payload.name) {
          msg.textContent = 'Recipe name is required.';
          return;
        }
        const photoMissing = payload.blocks.some((b) => b.type === 'PHOTO' && !b.photoUrl);
        if (photoMissing) {
          msg.textContent = 'Please upload photos for photo blocks.';
          return;
        }

        try {
          if (existing) await api.updateRecipe(existing.id, payload);
          else await api.createRecipe(payload);
          await refreshRecipes();
          overlay.remove();
          renderList();
        } catch (e: any) {
          msg.textContent = e?.message ?? 'Save failed';
        }
      }
    }, existing ? 'Save' : 'Create')
  ]);
}

async function refreshAuth() {
  try {
    state.user = await api.me();
  } catch {
    state.user = null;
  }
}

async function refreshRecipes() {
  state.recipes = await api.listRecipes(state.query);
}

function render() {
  const app = document.getElementById('app')!;
  app.replaceChildren();

  setTheme(getTheme());

  renderTopbar(app);
  const container = el('div', { class: 'container' });
  listHost = container;
  app.append(container);

  renderUserArea();
  renderList();
}

(async function boot() {
  await refreshAuth();
  await refreshRecipes();
  render();
})();
