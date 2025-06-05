// src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';
import { validator } from 'hono/validator';
import { z } from 'zod';

// Types
interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ADMIN_API_KEY: string;
}

interface Post {
  id: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  author: string;
  status: 'draft' | 'published';
  featured_image?: string;
  tags: string;
  created_at: string;
  updated_at: string;
  published_at?: string;
}

interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
  created_at: string;
}

interface Comment {
  id: number;
  post_id: number;
  author_name: string;
  author_email: string;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

// Validation schemas
const postSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  excerpt: z.string().max(500).optional(),
  author: z.string().min(1).max(100),
  status: z.enum(['draft', 'published']).default('draft'),
  featured_image: z.string().url().optional(),
  tags: z.string().optional(),
  category_id: z.number().optional(),
});

const categorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const commentSchema = z.object({
  post_id: z.number(),
  author_name: z.string().min(1).max(100),
  author_email: z.string().email(),
  content: z.string().min(1).max(1000),
});

// Utility functions
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function formatPost(post: any): Post {
  return {
    ...post,
    tags: post.tags || '',
    created_at: new Date(post.created_at).toISOString(),
    updated_at: new Date(post.updated_at).toISOString(),
    published_at: post.published_at ? new Date(post.published_at).toISOString() : undefined,
  };
}

// Database initialization
async function initializeDatabase(db: D1Database) {
  try {
    // Create posts table
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        excerpt TEXT,
        author TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        featured_image TEXT,
        tags TEXT,
        category_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        published_at DATETIME,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      )
    `).run();

    // Create categories table
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Create comments table
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        author_name TEXT NOT NULL,
        author_email TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      )
    `).run();

    // Create indexes
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id)').run();

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

// Initialize Hono app
const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', cors({
  origin: ['http://localhost:3000', 'https://yourdomain.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Public routes
app.get('/', (c) => {
  return c.json({
    message: 'Blog API',
    version: '1.0.0',
    endpoints: {
      posts: '/api/posts',
      categories: '/api/categories',
      comments: '/api/comments',
    },
  });
});

// Health check
app.get('/health', async (c) => {
  try {
    const result = await c.env.DB.prepare('SELECT 1').first();
    return c.json({ status: 'healthy', database: 'connected' });
  } catch (error) {
    return c.json({ status: 'unhealthy', database: 'disconnected' }, 500);
  }
});

// Initialize database endpoint (admin only)
app.post('/api/init', bearerAuth({ token: (c) => c.env.ADMIN_API_KEY }), async (c) => {
  try {
    await initializeDatabase(c.env.DB);
    return c.json({ message: 'Database initialized successfully' });
  } catch (error) {
    return c.json({ error: 'Failed to initialize database' }, 500);
  }
});

// Posts endpoints
app.get('/api/posts', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '10');
    const status = c.req.query('status') || 'published';
    const category = c.req.query('category');
    const search = c.req.query('search');
    const offset = (page - 1) * limit;

    let query = `
      SELECT p.*, c.name as category_name, c.slug as category_slug
      FROM posts p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = ?
    `;
    const params: any[] = [status];

    if (category) {
      query += ' AND c.slug = ?';
      params.push(category);
    }

    if (search) {
      query += ' AND (p.title LIKE ? OR p.content LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY p.published_at DESC, p.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const posts = await c.env.DB.prepare(query).bind(...params).all();

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM posts p WHERE p.status = ?';
    const countParams: any[] = [status];

    if (category) {
      countQuery += ' AND EXISTS (SELECT 1 FROM categories c WHERE c.id = p.category_id AND c.slug = ?)';
      countParams.push(category);
    }

    if (search) {
      countQuery += ' AND (p.title LIKE ? OR p.content LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`);
    }

    const { total } = await c.env.DB.prepare(countQuery).bind(...countParams).first() as { total: number };

    return c.json({
      posts: posts.results?.map(formatPost) || [],
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    return c.json({ error: 'Failed to fetch posts' }, 500);
  }
});

app.get('/api/posts/:slug', async (c) => {
  try {
    const slug = c.req.param('slug');
    const includeComments = c.req.query('comments') === 'true';

    const post = await c.env.DB.prepare(`
      SELECT p.*, c.name as category_name, c.slug as category_slug
      FROM posts p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.slug = ? AND p.status = 'published'
    `).bind(slug).first();

    if (!post) {
      return c.json({ error: 'Post not found' }, 404);
    }

    const formattedPost = formatPost(post);

    if (includeComments) {
      const comments = await c.env.DB.prepare(`
        SELECT * FROM comments
        WHERE post_id = ? AND status = 'approved'
        ORDER BY created_at ASC
      `).bind(post.id).all();

      return c.json({
        post: formattedPost,
        comments: comments.results || [],
      });
    }

    return c.json({ post: formattedPost });
  } catch (error) {
    console.error('Error fetching post:', error);
    return c.json({ error: 'Failed to fetch post' }, 500);
  }
});

// Admin routes (require authentication)
app.use('/api/admin/*', bearerAuth({ token: (c) => c.env.ADMIN_API_KEY }));

app.post('/api/admin/posts', validator('json', (value, c) => {
  const result = postSchema.safeParse(value);
  if (!result.success) {
    return c.json({ error: 'Invalid input', details: result.error.issues }, 400);
  }
  return result.data;
}), async (c) => {
  try {
    const data = c.req.valid('json');
    const slug = generateSlug(data.title);
    const now = new Date().toISOString();

    const result = await c.env.DB.prepare(`
      INSERT INTO posts (title, slug, content, excerpt, author, status, featured_image, tags, category_id, created_at, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      data.title,
      slug,
      data.content,
      data.excerpt || data.content.substring(0, 200) + '...',
      data.author,
      data.status,
      data.featured_image || null,
      data.tags || '',
      data.category_id || null,
      now,
      now,
      data.status === 'published' ? now : null
    ).run();

    const post = await c.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(result.meta.last_row_id).first();

    return c.json({ post: formatPost(post) }, 201);
  } catch (error) {
    console.error('Error creating post:', error);
    if (error.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'A post with this title already exists' }, 409);
    }
    return c.json({ error: 'Failed to create post' }, 500);
  }
});

app.put('/api/admin/posts/:id', validator('json', (value, c) => {
  const result = postSchema.partial().safeParse(value);
  if (!result.success) {
    return c.json({ error: 'Invalid input', details: result.error.issues }, 400);
  }
  return result.data;
}), async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const data = c.req.valid('json');
    const now = new Date().toISOString();

    const updates: string[] = [];
    const values: any[] = [];

    Object.entries(data).forEach(([key, value]) => {
      if (key === 'title') {
        updates.push('title = ?', 'slug = ?');
        values.push(value, generateSlug(value as string));
      } else if (key !== 'id') {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    });

    updates.push('updated_at = ?');
    values.push(now);

    if (data.status === 'published') {
      updates.push('published_at = ?');
      values.push(now);
    }

    values.push(id);

    await c.env.DB.prepare(`
      UPDATE posts SET ${updates.join(', ')} WHERE id = ?
    `).bind(...values).run();

    const post = await c.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();

    if (!post) {
      return c.json({ error: 'Post not found' }, 404);
    }

    return c.json({ post: formatPost(post) });
  } catch (error) {
    console.error('Error updating post:', error);
    return c.json({ error: 'Failed to update post' }, 500);
  }
});

app.delete('/api/admin/posts/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));

    const result = await c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();

    if (result.changes === 0) {
      return c.json({ error: 'Post not found' }, 404);
    }

    return c.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    return c.json({ error: 'Failed to delete post' }, 500);
  }
});

// Categories endpoints
app.get('/api/categories', async (c) => {
  try {
    const categories = await c.env.DB.prepare(`
      SELECT c.*, COUNT(p.id) as post_count
      FROM categories c
      LEFT JOIN posts p ON c.id = p.category_id AND p.status = 'published'
      GROUP BY c.id
      ORDER BY c.name
    `).all();

    return c.json({ categories: categories.results || [] });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return c.json({ error: 'Failed to fetch categories' }, 500);
  }
});

app.post('/api/admin/categories', validator('json', (value, c) => {
  const result = categorySchema.safeParse(value);
  if (!result.success) {
    return c.json({ error: 'Invalid input', details: result.error.issues }, 400);
  }
  return result.data;
}), async (c) => {
  try {
    const data = c.req.valid('json');
    const slug = generateSlug(data.name);

    const result = await c.env.DB.prepare(`
      INSERT INTO categories (name, slug, description, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(data.name, slug, data.description || null, new Date().toISOString()).run();

    const category = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(result.meta.last_row_id).first();

    return c.json({ category }, 201);
  } catch (error) {
    console.error('Error creating category:', error);
    if (error.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'A category with this name already exists' }, 409);
    }
    return c.json({ error: 'Failed to create category' }, 500);
  }
});

// Comments endpoints
app.get('/api/posts/:postId/comments', async (c) => {
  try {
    const postId = parseInt(c.req.param('postId'));
    const status = c.req.query('status') || 'approved';

    const comments = await c.env.DB.prepare(`
      SELECT * FROM comments
      WHERE post_id = ? AND status = ?
      ORDER BY created_at ASC
    `).bind(postId, status).all();

    return c.json({ comments: comments.results || [] });
  } catch (error) {
    console.error('Error fetching comments:', error);
    return c.json({ error: 'Failed to fetch comments' }, 500);
  }
});

app.post('/api/posts/:postId/comments', validator('json', (value, c) => {
  const result = commentSchema.safeParse(value);
  if (!result.success) {
    return c.json({ error: 'Invalid input', details: result.error.issues }, 400);
  }
  return result.data;
}), async (c) => {
  try {
    const postId = parseInt(c.req.param('postId'));
    const data = c.req.valid('json');

    // Verify post exists
    const post = await c.env.DB.prepare('SELECT id FROM posts WHERE id = ? AND status = "published"').bind(postId).first();
    if (!post) {
      return c.json({ error: 'Post not found' }, 404);
    }

    const result = await c.env.DB.prepare(`
      INSERT INTO comments (post_id, author_name, author_email, content, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).bind(postId, data.author_name, data.author_email, data.content, new Date().toISOString()).run();

    const comment = await c.env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(result.meta.last_row_id).first();

    return c.json({ comment }, 201);
  } catch (error) {
    console.error('Error creating comment:', error);
    return c.json({ error: 'Failed to create comment' }, 500);
  }
});

// Admin comment management
app.get('/api/admin/comments', async (c) => {
  try {
    const status = c.req.query('status') || 'pending';
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = (page - 1) * limit;

    const comments = await c.env.DB.prepare(`
      SELECT c.*, p.title as post_title, p.slug as post_slug
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      WHERE c.status = ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(status, limit, offset).all();

    const { total } = await c.env.DB.prepare('SELECT COUNT(*) as total FROM comments WHERE status = ?').bind(status).first() as { total: number };

    return c.json({
      comments: comments.results || [],
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    return c.json({ error: 'Failed to fetch comments' }, 500);
  }
});

app.put('/api/admin/comments/:id/status', validator('json', (value, c) => {
  const schema = z.object({
    status: z.enum(['pending', 'approved', 'rejected']),
  });
  const result = schema.safeParse(value);
  if (!result.success) {
    return c.json({ error: 'Invalid status' }, 400);
  }
  return result.data;
}), async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { status } = c.req.valid('json');

    const result = await c.env.DB.prepare('UPDATE comments SET status = ? WHERE id = ?').bind(status, id).run();

    if (result.changes === 0) {
      return c.json({ error: 'Comment not found' }, 404);
    }

    return c.json({ message: 'Comment status updated successfully' });
  } catch (error) {
    console.error('Error updating comment status:', error);
    return c.json({ error: 'Failed to update comment status' }, 500);
  }
});

// Error handling
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

export default app;
