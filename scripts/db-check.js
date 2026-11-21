import { closeDatabase, pingDatabase } from '@smartjob/shared/db';
import '@smartjob/shared/config';
try {
  const ok = await pingDatabase();
  console.log(`Supabase Postgres ping: ${ok ? 'OK' : 'FAILED'}`);
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
