import postgres from 'postgres';
import { config } from './config.js';

const IDENT = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;
const TABLES = new Set(['users', 'jobs', 'applications', 'resumes']);

let sql;
let readyDatabase = '';

function quoteIdent(name) {
  if (!IDENT.test(name)) throw new Error('Tên schema không hợp lệ.');
  return `"${name}"`;
}

function sslFor(url) {
  const host = new URL(url).hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === 'db') return false;
  return 'require';
}

export function db() {
  if (!sql) {
    const url = config().databaseUrl;
    sql = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 5,
      prepare: false,
      ssl: sslFor(url),
      onnotice: () => {},
    });
  }
  return sql;
}

export function databaseStatus() {
  return readyDatabase;
}

export function relation(schema, table) {
  if (!IDENT.test(schema) || !TABLES.has(table)) throw new Error('Tên quan hệ không hợp lệ.');
  const query = db();
  return { sql: query, from: query`${query(schema)}.${query(table)}` };
}

function statements(schema, table) {
  const users = [
    `create table if not exists ${schema}.users (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      email text not null,
      password_hash text not null,
      role text not null check (role in ('CANDIDATE', 'RECRUITER')),
      skills text[] not null default '{}',
      experience_years real not null default 0 check (experience_years >= 0),
      desired_position text not null default '',
      location text not null default '',
      company_name text not null default '',
      phone text not null default '',
      bio text not null default '',
      education jsonb not null default '[]'::jsonb,
      work_experience jsonb not null default '[]'::jsonb,
      certifications text[] not null default '{}',
      languages jsonb not null default '[]'::jsonb,
      links jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint users_email_key unique (email)
    )`,
    `alter table ${schema}.users enable row level security`,
    // DB cũ tạo cột integer; form và AI dùng bước 0.5 năm.
    `alter table ${schema}.users alter column experience_years type real`,
  ];
  const jobs = [
    `create table if not exists ${schema}.jobs (
      id uuid primary key default gen_random_uuid(),
      title text not null,
      description text not null,
      company_name text not null,
      recruiter_id uuid not null,
      location text not null,
      salary_min bigint not null check (salary_min >= 0),
      salary_max bigint not null check (salary_max >= 0),
      required_skills text[] not null default '{}',
      experience_min integer not null default 0 check (experience_min >= 0),
      job_type text not null default 'FULL_TIME' check (job_type in ('FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT')),
      status text not null default 'open' check (status in ('open', 'closed')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create index if not exists jobs_status_created_idx on ${schema}.jobs (status, created_at desc)`,
    `create index if not exists jobs_recruiter_idx on ${schema}.jobs (recruiter_id)`,
    `alter table ${schema}.jobs enable row level security`,
  ];
  const applications = [
    `create table if not exists ${schema}.applications (
      id uuid primary key default gen_random_uuid(),
      job_id uuid not null,
      candidate_id uuid not null,
      cover_letter text not null default '',
      status text not null default 'pending' check (status in ('pending', 'reviewing', 'accepted', 'rejected')),
      job_snapshot jsonb not null,
      candidate_snapshot jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint applications_job_candidate_key unique (job_id, candidate_id)
    )`,
    `create index if not exists applications_job_idx on ${schema}.applications (job_id)`,
    `create index if not exists applications_candidate_idx on ${schema}.applications (candidate_id)`,
    `alter table ${schema}.applications enable row level security`,
  ];
  const resumes = [
    `create table if not exists ${schema}.resumes (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      stored_name text not null,
      original_name text not null,
      size integer not null check (size >= 0),
      mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint resumes_user_key unique (user_id)
    )`,
    `alter table ${schema}.resumes enable row level security`,
  ];
  const ddl = { users, jobs, applications, resumes };
  if (!ddl[table]) throw new Error('Loại dữ liệu không hợp lệ.');
  return ddl[table];
}

export async function ensureSchema(schema, table) {
  const quoted = quoteIdent(schema);
  const query = db();
  await query.unsafe(`create schema if not exists ${quoted}`);
  for (const statement of statements(quoted, table)) await query.unsafe(statement);
  readyDatabase = schema;
}

export async function dropSchema(schema) {
  const quoted = quoteIdent(schema);
  await db().unsafe(`drop schema if exists ${quoted} cascade`);
  if (readyDatabase === schema) readyDatabase = '';
}

export async function pingDatabase() {
  const [row] = await db()`select 1 as ok`;
  return row.ok === 1;
}

export async function closeDatabase() {
  readyDatabase = '';
  if (!sql) return;
  const current = sql;
  sql = undefined;
  await current.end({ timeout: 5 });
}
