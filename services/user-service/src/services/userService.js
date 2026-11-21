import bcrypt from 'bcrypt';
import { findByEmail, findById, insertUser, updateUser } from '../models/User.js';
import { ApiError } from '@smartjob/shared/errors';
import { signToken } from '@smartjob/shared/auth';

export async function register(input) {
  if (await findByEmail(input.email))
    throw new ApiError(409, 'Email đã được sử dụng.', 'EMAIL_EXISTS');
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await insertUser({
    name: input.name,
    email: input.email,
    role: input.role,
    passwordHash,
  });
  return { user, token: signToken(user) };
}
export async function login({ email, password }) {
  const user = await findByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    throw new ApiError(401, 'Email hoặc mật khẩu không đúng.', 'INVALID_CREDENTIALS');
  delete user.passwordHash;
  return { user, token: signToken(user) };
}
export async function findUser(id) {
  const user = await findById(id);
  if (!user) throw new ApiError(404, 'Không tìm thấy người dùng.', 'USER_NOT_FOUND');
  return user;
}
export async function updateProfile(id, input) {
  const user = await findUser(id);
  const allowed =
    user.role === 'CANDIDATE'
      ? [
          'name',
          'skills',
          'experienceYears',
          'desiredPosition',
          'location',
          'phone',
          'bio',
          'education',
          'workExperience',
          'certifications',
          'languages',
          'links',
        ]
      : ['name', 'companyName', 'location', 'phone', 'bio'];
  const patch = {};
  for (const key of allowed) if (input[key] !== undefined) patch[key] = input[key];
  if (!Object.keys(patch).length) return user;
  return updateUser(id, patch);
}
