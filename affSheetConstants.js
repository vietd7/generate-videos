/**
 * Hằng số dùng chung cho ingest + cập nhật aff link trên Google Sheet.
 * Đổi wording / alias cột tại đây cho dễ bảo trì.
 */

/** Tiền tố hiển thị trước URL trong ô HYPERLINK */
export const AFF_LINK_DISPLAY_PREFIX = "👉 Link mua hàng: ";

/**
 * Tên cột có thể gặp trên sheet (sau normalizeHeaderCell sẽ khớp).
 * Ví dụ: "Link aff" → "link aff"
 */
export const AFF_LINK_HEADER_ALIASES = [
  "aff_link",
  "link aff",
  "link_aff",
  "aff link",
];

/** Aliases cho cột trạng thái bài đăng */
export const STATUS_HEADER_ALIASES = ["status"];

/** Giá trị status khi ingest ghi vào sheet lần đầu */
export const STATUS_READY = "ready";
/** Giá trị status khi video pass TikTok violation check — chờ user thêm hashtag + aff_link */
export const STATUS_TIKTOK_OK = "tiktok_ok";
/** Giá trị status khi video vi phạm TikTok — không bao giờ upload */
export const STATUS_TIKTOK_BAD = "tiktok_bad";
/** Giá trị status khi post-reels đã chọn row và spawn uploader */
export const STATUS_QUEUED = "queued";
/** Giá trị status khi upload.js báo đăng thành công */
export const STATUS_POSTED = "posted";
/** Giá trị status sau khi đã lấy aff link + click Đã thích thành công */
export const STATUS_AFF_LINKED = "aff_linked";
/** Giá trị status sau khi đã upload + đăng video lên TikTok thành công */
export const STATUS_TIKTOK_POSTED = "tiktok_posted";
/** Giá trị status khi đã ghi metadata (product_url/title/video_url) nhưng chưa generate video */
export const STATUS_PENDING_GENERATE = "pending_generate";
/** Giá trị status khi GitHub Actions đã render xong video, chờ user download + import về local */
export const STATUS_CLOUD_GENERATED = "cloud_generated";

/** Các status không được pick lại khi tìm row để post */
export const BLOCKED_STATUSES = new Set([STATUS_TIKTOK_BAD, STATUS_QUEUED, STATUS_POSTED]);
