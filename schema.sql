-- SEGTEC · Lista de precios pública
-- Esquema de base de datos (Postgres / Neon)

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  empresa TEXT,
  whatsapp TEXT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | approved | rejected
  email_verified BOOLEAN NOT NULL DEFAULT false,
  accepted_terms_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS quote_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES public_users(id),
  nombre TEXT,
  telefono TEXT,
  email TEXT,
  comentario TEXT,
  items_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_upload_chunks (
  id SERIAL PRIMARY KEY,
  upload_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_data TEXT NOT NULL,
  filename TEXT,
  uploaded_by INTEGER REFERENCES admins(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (upload_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS catalog_pending (
  id SERIAL PRIMARY KEY,
  data JSONB NOT NULL,
  stats JSONB NOT NULL,
  filename TEXT,
  uploaded_by INTEGER REFERENCES admins(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_versions (
  id SERIAL PRIMARY KEY,
  data JSONB NOT NULL,
  stats JSONB NOT NULL,
  published_by INTEGER REFERENCES admins(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_versions_created ON catalog_versions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_users_status ON public_users(status);
CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_token ON password_reset_tokens(token);
