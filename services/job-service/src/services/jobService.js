import { findJobById, insertJob, removeJob, saveJob, searchJobs } from '../models/Job.js';
import { ApiError } from '@smartjob/shared/errors';

export async function getJob(id) {
  const job = await findJobById(id);
  if (!job) throw new ApiError(404, 'Không tìm thấy công việc.', 'JOB_NOT_FOUND');
  return job;
}
export async function ownedJob(id, recruiterId) {
  const job = await getJob(id);
  if (job.recruiterId !== recruiterId)
    throw new ApiError(403, 'Bạn không sở hữu tin tuyển dụng này.', 'NOT_JOB_OWNER');
  return job;
}
export const listJobs = (input, recruiterId) => searchJobs(input, recruiterId);
export const createJob = (input, recruiterId) => insertJob({ ...input, recruiterId });
export async function updateJob(id, recruiterId, input) {
  await ownedJob(id, recruiterId);
  return saveJob(id, input);
}
export async function deleteJob(id, recruiterId) {
  await ownedJob(id, recruiterId);
  await removeJob(id);
}
export const openJobs = ({ page, limit }) => listJobs({ page, limit });
