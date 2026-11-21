import { relation } from '@smartjob/shared/db';
import { settings } from '../config/index.js';

const COLUMNS = {
  name: 'name',
  skills: 'skills',
  experienceYears: 'experience_years',
  desiredPosition: 'desired_position',
  location: 'location',
  companyName: 'company_name',
  phone: 'phone',
  bio: 'bio',
  education: 'education',
  workExperience: 'work_experience',
  certifications: 'certifications',
  languages: 'languages',
  links: 'links',
};
const JSON_COLUMNS = new Set(['education', 'workExperience', 'languages', 'links']);

export function toUser(row, includePassword = false) {
  const user = {
    _id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    skills: row.skills || [],
    experienceYears: row.experience_years,
    desiredPosition: row.desired_position,
    location: row.location,
    companyName: row.company_name,
    phone: row.phone,
    bio: row.bio,
    education: row.education || [],
    workExperience: row.work_experience || [],
    certifications: row.certifications || [],
    languages: row.languages || [],
    links: row.links || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includePassword) user.passwordHash = row.password_hash;
  return user;
}

function users() {
  return relation(settings().database, 'users');
}

export async function findByEmail(email) {
  const { sql, from } = users();
  const [row] = await sql`select * from ${from} where email = ${email} limit 1`;
  return row ? toUser(row, true) : null;
}

export async function findById(id) {
  const { sql, from } = users();
  const [row] = await sql`select * from ${from} where id = ${id} limit 1`;
  return row ? toUser(row) : null;
}

export async function insertUser(input) {
  const { sql, from } = users();
  const [row] = await sql`
    insert into ${from} (name, email, password_hash, role)
    values (${input.name}, ${input.email}, ${input.passwordHash}, ${input.role})
    returning *
  `;
  return toUser(row);
}

export async function updateUser(id, patch) {
  const { sql, from } = users();
  const values = {};
  const columns = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMNS[key];
    if (!column) continue;
    values[column] = JSON_COLUMNS.has(key) ? sql.json(value) : value;
    columns.push(column);
  }
  const [row] = await sql`
    update ${from}
    set ${sql(values, columns)}, updated_at = now()
    where id = ${id}
    returning *
  `;
  return row ? toUser(row) : null;
}
