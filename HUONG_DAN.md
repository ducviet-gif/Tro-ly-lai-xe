# Trợ lý Lái xe — cách tạo file APK và cài đặt

## 1. Tạo file APK miễn phí bằng GitHub (khoảng 10 phút, không cần lập trình)

1. Vào https://github.com, đăng ký tài khoản (miễn phí) và đăng nhập.
2. Bấm dấu **+** góc trên bên phải → **New repository**. Đặt tên `TroLyLaiXe`, chọn **Private**, bấm **Create repository**.
3. Trên trang vừa tạo, bấm **uploading an existing file**.
4. Giải nén file zip trên máy tính, mở thư mục `TroLyLaiXe`, chọn **tất cả** file và thư mục bên trong (kể cả thư mục `.github`) rồi kéo thả vào trang GitHub. Bấm **Commit changes**.
   - Nếu Windows ẩn thư mục `.github`: trong File Explorer chọn View › Show › Hidden items.
   - Nếu GitHub không nhận thư mục `.github`: vào tab **Actions** › **set up a workflow yourself**, đặt tên `build-apk.yml`, dán nội dung file `.github/workflows/build-apk.yml` vào, bấm **Commit changes**.
5. Mở tab **Actions**, chờ dòng "Build APK" có dấu tích xanh (3–6 phút).
6. Bấm vào dòng đó, kéo xuống mục **Artifacts**, tải **TroLyLaiXe-APK** (file zip chứa `TroLyLaiXe.apk`).

## 2. Cài lên điện thoại / màn hình Android trên ô tô

1. Chép file `TroLyLaiXe.apk` sang thiết bị (Zalo, Google Drive, USB…).
2. Mở file, cho phép **Cài ứng dụng không rõ nguồn gốc** khi máy hỏi, bấm **Cài đặt**.
3. Mở app, cho phép **Vị trí** (để xem thời tiết, lưu chỗ đỗ xe).

Thiết bị cần có: ứng dụng **Google** (để nhận giọng nói), **Google Maps** (để dẫn đường), và giọng đọc tiếng Việt
(Cài đặt › Hệ thống › Ngôn ngữ › Chuyển văn bản thành giọng nói › Google › tải "Tiếng Việt").

## 3. Bật trợ lý AI

Vào bánh răng (Cài đặt) › chọn **Google Gemini** › dán **Khóa API**.
Lấy khóa miễn phí: https://aistudio.google.com/apikey → đăng nhập Google → **Create API key** → sao chép.

## 4. Lệnh giọng nói (bấm nút micro to ở giữa)

| Bạn nói | App làm |
|---|---|
| "Đọc tin thế giới" / "tin giáo dục" / "tin nóng" / "tin trong nước" | Đọc lần lượt các tin trong mục |
| "Tiếp theo", "đọc lại", "đọc cả bài", "dừng" | Điều khiển việc đọc tin |
| "Chỉ đường đến Hồ Gươm", "tôi muốn đi Hải Phòng" | Mở Google Maps dẫn đường bằng giọng nói |
| "Về nhà", "đến cơ quan" | Dẫn đường tới địa chỉ đã lưu |
| "Tìm cây xăng", "trạm sạc", "bãi đỗ xe", "gara", "ATM", "quán ăn" | Tìm quanh vị trí hiện tại |
| "Lưu chỗ đỗ xe", "xe tôi ở đâu" | Ghi nhớ và dẫn đường quay lại xe |
| "Thời tiết", "thời tiết ở Đà Nẵng", "có mưa không" | Đọc thời tiết hiện tại và ngày mai |
| "Mấy giờ rồi", "hôm nay âm lịch bao nhiêu" | Đọc giờ, ngày dương và âm lịch |
| "Mở nhạc Sơn Tùng" | Mở ứng dụng nhạc |
| "Gọi 0912…", "gọi cấp cứu", "gọi người thân" | Mở màn hình gọi điện |
| "Bắt đầu chuyến đi" | Đếm giờ lái, nhắc dừng nghỉ |
| Câu hỏi bất kỳ ("giá vàng hôm nay", "giá xăng"…) | Hỏi trợ lý AI và đọc câu trả lời |
