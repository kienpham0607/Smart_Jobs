import { relation } from '@smartjob/shared/db';
import { settings } from '../config/index.js';

export function toResume(row) {
  return {
    _id: row.id,
    userId: row.user_id,
    storedName: row.stored_name,
    originalName: row.original_name,
    size: row.size,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resumes() {
  return relation(settings().database, 'resumes');
}

export async function findResumeByUser(userId) {
  const { sql, from } = resumes();
  const [row] = await sql`select * from ${from} where user_id = ${userId} limit 1`;
  return row ? toResume(row) : null;
}

export async function upsertResume(input) {
  const { sql, from } = resumes();
  const [row] = await sql`
    insert into ${from} (user_id, stored_name, original_name, size, mime_type)
    values (${input.userId}, ${input.storedName}, ${input.originalName}, ${input.size}, 'application/pdf')
    on conflict (user_id) do update set
      stored_name = excluded.stored_name,
      original_name = excluded.original_name,
      size = excluded.size,
      mime_type = excluded.mime_type,
      updated_at = now()
    returning *
  `;
  return toResume(row);
}

export async function deleteResumeByUser(userId) {
  const { sql, from } = resumes();
  const [row] = await sql`delete from ${from} where user_id = ${userId} returning *`;
  return row ? toResume(row) : null;
}
