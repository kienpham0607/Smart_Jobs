# SmartJob — Hệ thống tìm kiếm và gợi ý việc làm theo kiến trúc SOA

Đồ án môn **Phát triển hướng dịch vụ**, dùng React/Vite (JavaScript JSX), Tailwind CSS, Express, FastAPI, Supabase Postgres, JWT và bcrypt. Sáu service độc lập giao tiếp qua HTTP REST; frontend gọi API Gateway. AI Advisor phân tích CV PDF và tạo tư vấn qua Qwen3-4B chạy local; truy xuất tin dùng embedding local.

## Chạy nhanh trên máy hiện tại

Postgres của Supabase chạy local qua Docker tại cổng `54322`. Mở PowerShell tại thư mục dự án:

```powershell
Set-Location D:\LTW\SmartJob
npm.cmd ci
npm.cmd run setup
npm.cmd run db:up
npm.cmd run check:env
npm.cmd run check:db
npm.cmd run seed
python -m pip install -r ai-service/requirements.txt
npm.cmd run dev
```

Trên macOS/Linux hoặc terminal không chặn `npm.ps1`, thay `npm.cmd` bằng `npm`. Lệnh `setup` tạo `.env` với JWT secret, khóa dịch vụ và mật khẩu demo ngẫu nhiên; không ghi đè `.env` có sẵn. Cài Ollama, chạy `ollama pull qwen3:4b` và `ollama pull nomic-embed-text` để bật AI local, không cần API key. Dùng `npm ci` sau khi clone để cài đúng lockfile.

Mở **http://localhost:5173** hoặc **http://127.0.0.1:5173**. Nếu dependencies, `.env` và dữ liệu demo đã có như trên máy hiện tại, chỉ cần `npm.cmd run dev`. Lệnh tự chạy `check:env` và `check:db` trước khi khởi động tám tiến trình (cần cài `ai-service/requirements.txt`) và theo dõi thay đổi mã nguồn. Cấu hình sai hoặc Postgres chưa kết nối được sẽ dừng sớm với thông báo lỗi. Giữ terminal này mở; dừng bằng Ctrl+C. Sau khi sửa `.env`, dừng rồi chạy lại `dev` để tất cả service nạp cấu hình mới.

Mở PowerShell thứ hai để kiểm tra stack đang chạy:

```powershell
Set-Location D:\LTW\SmartJob
npm.cmd run health
npm.cmd run smoke
```

`smoke` kiểm tra frontend, đăng nhập cả hai role, tìm kiếm, gợi ý, lịch sử ứng tuyển và quyền xem hồ sơ trên API thật của cấu hình local hiện tại. Lệnh chỉ đọc dữ liệu và đăng nhập, không tạo/sửa/xóa hồ sơ hoặc tin. Nếu mật khẩu demo trong `.env` không trùng mật khẩu tài khoản đã tồn tại, smoke báo lỗi thay vì đổi mật khẩu. CRUD, gửi đơn và xét duyệt được kiểm tra riêng trên database test cô lập.

| Thành phần             | Địa chỉ               | Dữ liệu sở hữu          |
| ---------------------- | --------------------- | ----------------------- |
| Frontend               | http://localhost:5173 | Không truy cập database |
| API Gateway            | http://localhost:3000 | Không có database       |
| User Service           | http://localhost:3001 | `smartjob_users`        |
| Job Service            | http://localhost:3002 | `smartjob_jobs`         |
| Application Service    | http://localhost:3003 | `smartjob_applications` |
| Recommendation Service | http://localhost:3004 | Không có database       |
| Resume Service         | http://localhost:3005 | `smartjob_resumes`      |
| AI Service             | http://localhost:3006 | Không có database       |

Các server bind loopback để phục vụ demo local. Mỗi backend có `GET /health`; gateway health kiểm tra chính gateway, không đại diện sức khỏe tất cả service. Dùng `npm run health` để kiểm tra cả bảy backend.

## Supabase Postgres

Cần Node.js LTS (22.12 trở lên), npm và một Postgres tương thích Supabase. Chọn **một** cách dưới đây.

### Cách 1: Postgres local trong Docker

```powershell
npm.cmd run db:up
```

`DATABASE_URL` mặc định là `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Bốn schema `smartjob_users`, `smartjob_jobs`, `smartjob_applications`, `smartjob_resumes` được tạo khi service khởi động. File SQL cùng nội dung nằm ở `supabase/migrations/20261121100000_init.sql`.

### Cách 2: Project Supabase trên cloud

Tạo project trên [Supabase](https://supabase.com/dashboard), mở **Project Settings → Database → Connection string** (session pooler) và gán vào `DATABASE_URL`. Chạy file migration trong SQL Editor, hoặc `supabase db push` nếu đã cài Supabase CLI và link project. Backend dùng connection string của role database, không dùng anon key. Row level security được bật và không có policy cho anon, nên Data API công khai không đọc được bảng.

### Cách 3: Docker Compose cả stack

Cần Docker Desktop đang chạy và file `.env` (đã có thì giữ nguyên; chưa có thì `npm.cmd run setup`). **Không** chạy đồng thời `npm run dev` trên cùng cổng `3000`.

```powershell
npm.cmd run docker:up
npm.cmd run docker:seed
```

| Thành phần | Địa chỉ |
| ---------- | ------- |
| Frontend (nginx) | http://localhost:8080 |
| API Gateway (tuỳ chọn gọi trực tiếp) | http://localhost:3000 |
| Postgres | `127.0.0.1:54322` |

Trong container, service gọi nhau qua tên Docker và Postgres qua `postgresql://postgres:postgres@db:5432/postgres`. Frontend build với `VITE_API_URL=/api`; nginx proxy `/api` tới gateway nên trình duyệt chỉ cần mở cổng **8080**. Dừng stack: `npm.cmd run docker:down` (không thêm `-v` nếu muốn giữ volume Postgres). Log: `npm.cmd run docker:logs`.

## Tài khoản demo

Chạy `npm run seed` sau khi Postgres sẵn sàng:

| Vai trò        | Email mặc định             | Mật khẩu                             |
| -------------- | -------------------------- | ------------------------------------ |
| Ứng viên       | `candidate@smartjob.local` | Giá trị `DEMO_PASSWORD` trong `.env` |
| Nhà tuyển dụng | `recruiter@smartjob.local` | Giá trị `DEMO_PASSWORD` trong `.env` |

Seed tạo hai tài khoản và chín tin mẫu được đánh dấu trong mô tả. Các công ty trong seed là ví dụ phục vụ đồ án; cùng một tài khoản recruiter sở hữu các tin này để thuận tiện demo. Giao diện và Recommendation Service luôn đọc dữ liệu qua API, không có danh sách job cố định dự phòng trong frontend.

Seed có thể chạy lại: giữ nguyên tài khoản, mật khẩu, hồ sơ và các tin đã tồn tại; không drop database. Khi đổi `DEMO_PASSWORD`, tài khoản đã tạo không tự đổi mật khẩu. Muốn tạo bộ demo khác, đổi hai email demo trong `.env` rồi seed. `.env.example` để trống secret/mật khẩu để không lưu bí mật vào source.

## Chức năng

- Công khai: trang chủ, tìm việc theo từ khóa/địa điểm/kỹ năng/khoảng lương, phân trang, chi tiết việc làm, đăng ký, đăng nhập.
- Ứng viên: cập nhật kỹ năng/kinh nghiệm/vị trí/địa điểm, xem việc phù hợp kèm điểm và lý do, gửi lời giới thiệu ứng tuyển, theo dõi trạng thái.
- Nhà tuyển dụng: cập nhật thông tin công ty, đăng/sửa/xóa/đóng/mở tin của mình, xem snapshot hồ sơ ứng viên, cập nhật trạng thái.
- Backend xác thực JWT/role/ownership; không tin ID do client gửi. Endpoint nội bộ có service token; gateway không expose `/internal`.
- Giao diện tiếng Việt có menu mobile, loading, empty state, lỗi có nút thử lại và toast. Token lưu trong `sessionStorage`; đăng xuất xóa token phía client.
- Khôi phục phiên gặp lỗi mạng/timeout/503 sẽ giữ JWT và cho phép thử lại; chỉ `401` mới xóa token và chuyển đăng nhập. Bộ lọc lương đảo ngược được API từ chối bằng `400`.

## Cấu hình cần kiểm tra thủ công

- Nếu chuyển máy, chạy `setup` để tạo `.env` rồi khởi động Postgres (`npm run db:up`) hoặc dán `DATABASE_URL` của project Supabase.
- Nếu thay cổng, sửa đồng thời `*_PORT`, `*_SERVICE_URL`, `VITE_API_URL` và `FRONTEND_ORIGIN` tương ứng. Backend port không được trùng, bốn schema phải khác tên.
- Service URL và origin dùng đúng dạng `http://host:port`, không path hoặc dấu `/` cuối. `VITE_API_URL` dùng path `/api`. Nhiều origin frontend phân cách bằng dấu phẩy.
- Thời hạn JWT dùng số dương và đơn vị, ví dụ `30m`, `8h`, `7d`. `GATEWAY_TIMEOUT_MS` phải lớn hơn `HTTP_TIMEOUT_MS`.
- Chỉ cần Chrome hoặc Edge khi chạy test UI. Chạy ứng dụng không phụ thuộc Playwright hay trình duyệt phục vụ test.

## Kiểm thử và build

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run build
npm.cmd run health
```

CV PDF được quản lý bởi Resume Service qua `PUT /api/resumes/me`, tối đa 5 MB. File lưu trong volume `smartjob_resumes` của Docker; khi chạy local, file nằm ở `.local/resumes`.

`npm test` chạy unit và integration bằng Node test runner. Integration tự khởi động gateway + các service bằng tiến trình riêng ở cổng ngẫu nhiên và gọi HTTP thật. Mỗi lần chạy dùng schema Postgres ngẫu nhiên, rồi xóa đúng schema đó khi kết thúc. Không cần `npm run dev` cho bộ test. Postgres local phải đang chạy.

Kết quả xác minh ngày 04/11/2026: **20/20 test backend** (3 cấu hình, 13 integration, 4 scoring), **3/3 test UI**, build production thành công. Các test mới tái hiện lỗi trước khi sửa, kiểm tra khoảng lương đảo ngược và khôi phục phiên khi mất kết nối. Xem chi tiết tại [PROGRESS.md](PROGRESS.md).

`npm run test:ui` dùng Playwright, tự khởi động một stack riêng (kể cả Vite), dùng ba schema test khác và dọn sau khi chạy. Mặc định sử dụng Google Chrome đã cài sẵn; muốn dùng Edge, đặt `$env:BROWSER_CHANNEL='msedge'` trước lệnh trên. Nếu chưa có hai trình duyệt này, cài Chrome/Edge rồi chạy lại. Không cần tải Chromium riêng. Các test giao diện kiểm tra luồng ứng viên và nhà tuyển dụng, trạng thái hồ sơ, chống ứng tuyển trùng, đăng xuất/đăng nhập, tìm kiếm, responsive và trang 404.

Postgres phải hoạt động để chạy integration và UI test. Đặt `DATABASE_TEST_URL` trong môi trường terminal nếu muốn dùng database riêng cho test; tài khoản kết nối cần quyền tạo và xóa schema. Các test không mock dữ liệu trong luồng sản phẩm.

`npm run build` tạo bản frontend production trong `frontend/dist`, ép `NODE_ENV=production` cho quá trình build. `npm run preview -w frontend` xem bản build trên cổng Vite preview; nếu cần gọi API, thêm chính xác origin preview vào `FRONTEND_ORIGIN`, rồi khởi động lại backend. Các backend vẫn cần chạy độc lập.

`npm run format` định dạng source bằng Prettier. Cấu hình `.prettierignore` loại trừ `.env`, build, node_modules và dữ liệu local.

## Cấu trúc và hướng đọc mã

```text
SmartJob/
  frontend/                    # React, pages, components, context, API client
  api-gateway/                 # Router chuyển tiếp các public namespace
  services/
    user-service/src/          # Tài khoản và hồ sơ; chỉ database users
    job-service/src/           # Tin tuyển dụng; chỉ database jobs
    application-service/src/   # Ứng tuyển + HTTP clients; chỉ database applications
    recommendation-service/src/ # HTTP clients + scoring, không có database
    resume-service/src/         # Upload/download PDF + metadata; file storage riêng
  ai-service/                  # FastAPI, local Qwen chat/embeddings, RAG và prompt
  packages/shared/src/         # Auth, errors, validation, HTTP, server, cấu hình chung
  scripts/                     # Setup, seed orchestration, health, kiểm tra Postgres
  tests/                       # Unit/integration + tests/ui
  docs/                        # Tài liệu báo cáo và hướng dẫn bảo vệ
  docker/nginx.conf            # Proxy /api → gateway trong image frontend
  Dockerfile                   # Multi-stage: backend Node + frontend nginx
  .env.example
  docker-compose.yml           # Postgres + 6 service + gateway + frontend
  PROGRESS.md
```

Trong service, đọc theo thứ tự `routes → middleware → controller → service → model/client`. Controller chỉ xử lý biên HTTP; nghiệp vụ nằm trong `services`. Các service không import model của nhau. Npm workspace shared chỉ chứa hạ tầng dùng chung; không chứa model nghiệp vụ. Seed gốc khởi chạy seed của từng service, truyền recruiter ID theo dữ liệu đầu ra, không truy cập database của service khác.

## Tài liệu và xử lý lỗi thường gặp

- [Tổng quan và yêu cầu](docs/01-tong-quan.md)
- [Kiến trúc SOA, use case và sequence Mermaid](docs/02-kien-truc-soa.md)
- [API contract và ví dụ Postman](docs/03-api.md)
- [Thuật toán gợi ý và ví dụ tính điểm](docs/04-recommendation.md)
- [Kịch bản demo, test case và bằng chứng kiểm tra](docs/05-demo-kiem-thu.md)
- [Các quyết định thiết kế và giới hạn](docs/06-quyet-dinh-gioi-han.md)

| Hiện tượng                                   | Cách xử lý                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm.ps1 cannot be loaded`                   | Dùng `npm.cmd`, không cần đổi execution policy.                                                                                                              |
| Postgres connection refused                      | Chạy `npm run db:up` hoặc kiểm tra `DATABASE_URL`, rồi `npm run check:db`.                                                                               |
| `EADDRINUSE` / port in use                   | Dừng tiến trình dự án cũ của bạn; kiểm tra cổng bằng `Get-NetTCPConnection -LocalPort 3000` hoặc công cụ hệ thống. Không dừng tiến trình không rõ nguồn gốc. |
| Giao diện có lỗi kết nối, health đạt         | Kiểm tra `VITE_API_URL`, Network tab và CORS. Origin thực tế phải nằm trong `FRONTEND_ORIGIN` (phân cách bằng dấu phẩy). Khởi động lại sau khi sửa env.      |
| Đăng nhập demo sai mật khẩu                  | Xem `DEMO_PASSWORD`; seed không đổi mật khẩu tài khoản đã tồn tại.                                                                                           |
| Service trả `503`/gateway `504`              | Chạy `npm run health`, kiểm tra URL service, timeout và log terminal tương ứng.                                                                              |
| JWT hết hạn                                  | Đăng nhập lại. Token cũ không còn được backend chấp nhận.                                                                                                    |

Tham khảo ý tưởng nghiệp vụ và tổ chức REST từ [JOBHUB](https://github.com/hungnm1911/JOBHUB), gồm README gốc và README của backend/frontend. SmartJob có kiến trúc và mã riêng, thu gọn cho bài tập SOA; không yêu cầu Cloudinary, SMTP, Socket.IO hay AI API trả phí.

