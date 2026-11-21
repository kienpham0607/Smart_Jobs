-- One Supabase Postgres database. Each service owns its own schema.
-- Row level security is on and has no anon/authenticated policy: the Data API stays closed.
-- Backend services connect with the database role (DATABASE_URL), which bypasses RLS.

create schema if not exists smartjob_users;
create schema if not exists smartjob_jobs;
create schema if not exists smartjob_applications;
create schema if not exists smartjob_resumes;

create table if not exists smartjob_users.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  password_hash text not null,
  role text not null check (role in ('CANDIDATE', 'RECRUITER')),
  skills text[] not null default '{}',
  experience_years integer not null default 0 check (experience_years >= 0),
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
);
alter table smartjob_users.users enable row level security;

create table if not exists smartjob_jobs.jobs (
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
);
create index if not exists jobs_status_created_idx on smartjob_jobs.jobs (status, created_at desc);
create index if not exists jobs_recruiter_idx on smartjob_jobs.jobs (recruiter_id);
alter table smartjob_jobs.jobs enable row level security;

create table if not exists smartjob_applications.applications (
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
);
create index if not exists applications_job_idx on smartjob_applications.applications (job_id);
create index if not exists applications_candidate_idx on smartjob_applications.applications (candidate_id);
alter table smartjob_applications.applications enable row level security;

create table if not exists smartjob_resumes.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  stored_name text not null,
  original_name text not null,
  size integer not null check (size >= 0),
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resumes_user_key unique (user_id)
);
alter table smartjob_resumes.resumes enable row level security;
