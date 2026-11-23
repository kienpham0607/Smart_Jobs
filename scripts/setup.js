import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const target = new URL('../.env', import.meta.url);

// Giá trị sinh tự động cho các khóa còn trống. Regex chấp nhận cả CRLF (Windows).
const generated = {
  JWT_SECRET: () => randomBytes(48).toString('hex'),
  INTERNAL_SERVICE_TOKEN: () => randomBytes(48).toString('hex'),
  DEMO_PASSWORD: () => `${randomBytes(12).toString('base64url')}!`,
};

function fillEmpty(env) {
  const filled = [];
  for (const [key, make] of Object.entries(generated)) {
    const pattern = new RegExp(`^(${key}=)[ \\t]*(?=\\r?$)`, 'm');
    if (pattern.test(env)) {
      env = env.replace(pattern, `$1${make()}`);
      filled.push(key);
    }
  }
  return { env, filled };
}

let existing = null;
try {
  existing = await readFile(target, 'utf8');
} catch {
  // .env chưa có, sẽ tạo từ .env.example.
}

if (existing === null) {
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  const { env } = fillEmpty(example);
  await writeFile(target, env, { flag: 'wx' });
  console.log(
    'Đã tạo .env với khóa ngẫu nhiên. Xem DEMO_PASSWORD trong .env để đăng nhập sau khi seed.',
  );
} else {
  const { env, filled } = fillEmpty(existing);
  if (filled.length > 0) {
    await writeFile(target, env);
    console.log(`.env đã tồn tại; đã sinh giá trị cho khóa còn trống: ${filled.join(', ')}.`);
  } else {
    console.log('.env đã tồn tại, giữ nguyên cấu hình.');
  }
}
