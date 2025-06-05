
-- Insert sample categories
INSERT OR IGNORE INTO categories (name, slug, description) VALUES
('Technology', 'technology', 'Articles about technology and programming'),
('Design', 'design', 'UI/UX design and creative content'),
('Business', 'business', 'Entrepreneurship and business insights');

-- Insert sample posts
INSERT OR IGNORE INTO posts (title, slug, content, excerpt, author, status, tags, category_id, published_at) VALUES
(
  'Getting Started with Cloudflare Workers',
  'getting-started-with-cloudflare-workers',
  'Cloudflare Workers provide a serverless execution environment that allows you to create entirely new applications or augment existing ones without configuring or maintaining infrastructure. This comprehensive guide will walk you through everything you need to know to get started with Cloudflare Workers.',
  'Learn how to build serverless applications with Cloudflare Workers',
  'John Doe',
  'published',
  'cloudflare,serverless,javascript',
  1,
  datetime('now')
),
(
  'Modern API Design Principles',
  'modern-api-design-principles',
  'APIs are the backbone of modern applications. In this article, we explore the fundamental principles of designing robust, scalable, and developer-friendly APIs that stand the test of time.',
  'Essential principles for designing modern, scalable APIs',
  'Jane Smith',
  'published',
  'api,design,rest,graphql',
  1,
  datetime('now')
);

-- Insert sample comments
INSERT OR IGNORE INTO comments (post_id, author_name, author_email, content, status) VALUES
(1, 'Alice Johnson', 'alice@example.com', 'Great introduction to Cloudflare Workers! Very helpful for beginners.', 'approved'),
(1, 'Bob Wilson', 'bob@example.com', 'Thanks for the detailed explanation. Looking forward to more tutorials.', 'approved'),
(2, 'Charlie Brown', 'charlie@example.com', 'Excellent coverage of API design principles. The examples are very clear.', 'approved');
