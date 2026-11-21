import { relation } from '@smartjob/shared/db';
import { settings } from '../config/index.js';

export function toApplication(row) {
  return {
    _id: row.id,
    jobId: row.job_id,
    candidateId: row.candidate_id,
    coverLetter: row.cover_letter,
    status: row.status,
    jobSnapshot: row.job_snapshot,
    candidateSnapshot: row.candidate_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function applications() {
  return relation(settings().database, 'applications');
}

export async function insertApplication(input) {
  const { sql, from } = applications();
  const [row] = await sql`
    insert into ${from} (
      job_id, candidate_id, cover_letter, job_snapshot, candidate_snapshot
    ) values (
      ${input.jobId},
      ${input.candidateId},
      ${input.coverLetter || ''},
      ${sql.json(input.jobSnapshot)},
      ${sql.json(input.candidateSnapshot)}
    )
    returning *
  `;
  return toApplication(row);
}

export async function findApplicationById(id) {
  const { sql, from } = applications();
  const [row] = await sql`select * from ${from} where id = ${id} limit 1`;
  return row ? toApplication(row) : null;
}

export async function saveApplicationStatus(id, status) {
  const { sql, from } = applications();
  const [row] = await sql`
    update ${from} set status = ${status}, updated_at = now()
    where id = ${id}
    returning *
  `;
  return row ? toApplication(row) : null;
}

export async function pageApplications(filter, { page, limit }) {
  const { sql, from } = applications();
  const where = filter.jobId
    ? sql`job_id = ${filter.jobId}`
    : sql`candidate_id = ${filter.candidateId}`;
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
  return {
    items: rows.map(toApplication),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
