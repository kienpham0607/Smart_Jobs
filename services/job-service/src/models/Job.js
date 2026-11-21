import { relation } from '@smartjob/shared/db';
import { settings } from '../config/index.js';

export function toJob(row) {
  return {
    _id: row.id,
    title: row.title,
    description: row.description,
    companyName: row.company_name,
    recruiterId: row.recruiter_id,
    location: row.location,
    salaryMin: Number(row.salary_min),
    salaryMax: Number(row.salary_max),
    requiredSkills: row.required_skills || [],
    experienceMin: row.experience_min,
    jobType: row.job_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function jobs() {
  return relation(settings().database, 'jobs');
}

const like = (value) => `%${String(value).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

export async function findJobById(id) {
  const { sql, from } = jobs();
  const [row] = await sql`select * from ${from} where id = ${id} limit 1`;
  return row ? toJob(row) : null;
}

export async function jobExists(title, recruiterId) {
  const { sql, from } = jobs();
  const [row] = await sql`
    select 1 from ${from} where title = ${title} and recruiter_id = ${recruiterId} limit 1
  `;
  return Boolean(row);
}

export async function insertJob(input) {
  const { sql, from } = jobs();
  const [row] = await sql`
    insert into ${from} (
      title, description, company_name, recruiter_id, location,
      salary_min, salary_max, required_skills, experience_min, job_type, status
    ) values (
      ${input.title}, ${input.description}, ${input.companyName}, ${input.recruiterId}, ${input.location},
      ${input.salaryMin}, ${input.salaryMax}, ${input.requiredSkills}, ${input.experienceMin},
      ${input.jobType || 'FULL_TIME'}, ${input.status || 'open'}
    )
    returning *
  `;
  return toJob(row);
}

export async function saveJob(id, input) {
  const { sql, from } = jobs();
  const [row] = await sql`
    update ${from} set
      title = ${input.title},
      description = ${input.description},
      company_name = ${input.companyName},
      location = ${input.location},
      salary_min = ${input.salaryMin},
      salary_max = ${input.salaryMax},
      required_skills = ${input.requiredSkills},
      experience_min = ${input.experienceMin},
      job_type = ${input.jobType},
      status = ${input.status},
      updated_at = now()
    where id = ${id}
    returning *
  `;
  return row ? toJob(row) : null;
}

export async function removeJob(id) {
  const { sql, from } = jobs();
  await sql`delete from ${from} where id = ${id}`;
}

export async function searchJobs(input, recruiterId) {
  const { page, limit, q, location, skill, salaryMin, salaryMax } = input;
  const { sql, from } = jobs();
  const filters = [recruiterId ? sql`recruiter_id = ${recruiterId}` : sql`status = 'open'`];
  if (q) {
    const pattern = like(q);
    filters.push(sql`(
      title ilike ${pattern} escape '\\'
      or company_name ilike ${pattern} escape '\\'
      or description ilike ${pattern} escape '\\'
    )`);
  }
  if (location) filters.push(sql`location ilike ${like(location)} escape '\\'`);
  if (skill)
    filters.push(sql`exists (
      select 1 from unnest(required_skills) as skill
      where lower(skill) = lower(${skill})
    )`);
  if (salaryMin !== undefined) filters.push(sql`salary_max >= ${salaryMin}`);
  if (salaryMax !== undefined) filters.push(sql`salary_min <= ${salaryMax}`);
  const where = filters.flatMap((filter, index) => (index ? [sql` and `, filter] : [filter]));
  const offset = (page - 1) * limit;
  const [rows, count] = await Promise.all([
    sql`
      select * from ${from}
      where ${where}
      order by created_at desc, id desc
      limit ${limit} offset ${offset}
    `,
    sql`select count(*)::int as total from ${from} where ${where}`,
  ]);
  const total = count[0].total;
  return { items: rows.map(toJob), total, page, limit, totalPages: Math.ceil(total / limit) };
}
