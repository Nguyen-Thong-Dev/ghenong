/**
 * Quản lý cấu hình quà -> hành động và kho quyền lợi (perks) của GHẾ NÓNG.
 * - Bền vững: lưu trong meta 'gift_perks' (qua onSave do engine gắn) -> sống qua reload/khởi động lại.
 * - Combo & chống trùng do connector + engine đảm bảo trước khi gọi ingestGift().
 * - Thực thi hành động (ghế/hàng chờ) do engine làm, vì cần truy cập state.
 */
import type { GiftAction, GiftConfigEntry, GiftPerk, RecentGift } from './types';

export const GIFT_ACTIONS: GiftAction[] = ['steal_seat', 'skip_queue', 'protect_answer'];

export const GIFT_ACTION_LABELS: Record<GiftAction, string> = {
  steal_seat: 'Cướp ghế nóng',
  skip_queue: 'Vào ngay ghế chờ',
  protect_answer: 'Bỏ qua một câu, giữ ghế',
};

export const GIFT_ACTION_DEFAULT_DESC: Record<GiftAction, string> = {
  steal_seat: 'Nhận 1 lượt lên ghế nóng ngay (thay người điểm thấp nhất nếu đủ 5 ghế)',
  skip_queue: 'Vào ngay ghế chờ, ưu tiên trước hàng thường',
  protect_answer: 'Bảo vệ 1 câu: sai hoặc không trả lời vẫn giữ ghế, không bị trừ điểm',
};

export interface GiftIngest {
  eventId: string;
  userId: string;
  nickname: string;
  avatar: string;
  giftId: string;
  giftName: string;
  image?: string;
  count: number;
  groupId?: string;
  at: number;
}

export interface GiftPerkData {
  config: GiftConfigEntry[];
  perks: GiftPerk[];
  recent: RecentGift[];
  /** tiến độ tích quà theo `${userId}|${giftId}` */
  progress: Record<string, number>;
}

const MAX_RECENT = 50;
const MAX_PERKS = 800;

export class GiftPerksStore {
  data: GiftPerkData = { config: [], perks: [], recent: [], progress: {} };
  onSave: (() => void) | null = null;

  load(raw: string | null) {
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as Partial<GiftPerkData>;
      this.data = {
        config: Array.isArray(p.config) ? p.config : [],
        perks: Array.isArray(p.perks) ? p.perks : [],
        recent: Array.isArray(p.recent) ? p.recent.slice(-MAX_RECENT) : [],
        progress: p.progress && typeof p.progress === 'object' ? p.progress : {},
      };
    } catch {
      this.data = { config: [], perks: [], recent: [], progress: {} };
    }
  }

  save() {
    if (this.data.perks.length > MAX_PERKS) this.data.perks = this.data.perks.slice(-MAX_PERKS);
    if (this.data.recent.length > MAX_RECENT) this.data.recent = this.data.recent.slice(-MAX_RECENT);
    this.onSave?.();
  }

  // ---------- cấu hình ----------
  upsertConfig(entry: Omit<GiftConfigEntry, 'updatedAt'>): { accepted: boolean; reason: string } {
    const giftId = String(entry.giftId || '').trim();
    if (!giftId) return { accepted: false, reason: 'Thiếu Gift ID (phải là chuỗi số của quà TikTok)' };
    if (!GIFT_ACTIONS.includes(entry.action)) return { accepted: false, reason: 'Hành động không hợp lệ' };
    const units = Math.max(1, Math.floor(Number(entry.unitsPerPerk) || 1));
    const clean: GiftConfigEntry = {
      giftId,
      name: String(entry.name || '').trim() || `Quà ${giftId}`,
      image: entry.image?.trim() || undefined,
      action: entry.action,
      unitsPerPerk: units,
      enabled: Boolean(entry.enabled),
      description: String(entry.description || '').trim() || GIFT_ACTION_DEFAULT_DESC[entry.action],
      updatedAt: Date.now(),
    };
    const i = this.data.config.findIndex((c) => c.giftId === giftId);
    if (i >= 0) this.data.config[i] = clean;
    else this.data.config.push(clean);
    this.save();
    return { accepted: true, reason: `Đã lưu quà ${clean.name} (${giftId}) → ${GIFT_ACTION_LABELS[clean.action]}` };
  }

  removeConfig(giftId: string): { accepted: boolean; reason: string } {
    const i = this.data.config.findIndex((c) => c.giftId === giftId);
    if (i < 0) return { accepted: false, reason: 'Không tìm thấy cấu hình' };
    const removed = this.data.config.splice(i, 1)[0];
    for (const k of Object.keys(this.data.progress)) if (k.endsWith(`|${giftId}`)) delete this.data.progress[k];
    this.save();
    return { accepted: true, reason: `Đã xóa cấu hình ${removed.name} (${giftId})` };
  }

  configOf(giftId: string): GiftConfigEntry | null {
    return this.data.config.find((c) => c.giftId === giftId) ?? null;
  }

  // ---------- nhận quà ----------
  /**
   * Ghi nhận quà và cấp quyền theo cấu hình.
   * Trả về: { configured, granted: GiftPerk[] (quyền mới), progressNote }.
   * Không tự thực thi ghế — engine quyết định theo pha.
   */
  ingestGift(ev: GiftIngest): { configured: boolean; granted: GiftPerk[]; note: string } {
    const cfg = this.configOf(ev.giftId);
    if (!cfg || !cfg.enabled) {
      this.pushRecent(ev, false, 'Chỉ ghi nhận & cảm ơn (chưa cấu hình)');
      return { configured: false, granted: [], note: 'Chỉ cảm ơn' };
    }
    if (!ev.userId || !ev.count || ev.count <= 0) {
      this.pushRecent(ev, true, 'LỖI: thiếu người gửi hoặc số lượng → không cấp quyền');
      return { configured: true, granted: [], note: 'Lỗi dữ liệu, không cấp' };
    }

    const progKey = `${ev.userId}|${ev.giftId}`;
    let total = (this.data.progress[progKey] ?? 0) + ev.count;
    const granted: GiftPerk[] = [];
    while (total >= cfg.unitsPerPerk) {
      total -= cfg.unitsPerPerk;
      granted.push({
        id: `pk_${ev.at}_${ev.eventId.slice(-10)}_${granted.length}`,
        userId: ev.userId,
        nickname: ev.nickname,
        avatar: ev.avatar,
        giftId: ev.giftId,
        giftName: ev.giftName,
        action: cfg.action,
        state: 'unused',
        createdAt: ev.at,
      });
    }
    this.data.progress[progKey] = total;

    const note = granted.length
      ? `Cấp ${granted.length} quyền "${GIFT_ACTION_LABELS[cfg.action]}"`
      : `Tích ${total}/${cfg.unitsPerPerk} để nhận 1 quyền`;
    this.pushRecent(ev, true, note);
    if (granted.length) this.data.perks.push(...granted);
    this.save();
    return { configured: true, granted, note };
  }

  private pushRecent(ev: GiftIngest, configured: boolean, note: string) {
    this.data.recent.push({
      at: ev.at,
      eventId: ev.eventId,
      userId: ev.userId,
      nickname: ev.nickname,
      avatar: ev.avatar,
      giftId: ev.giftId,
      giftName: ev.giftName,
      image: ev.image,
      count: ev.count,
      groupId: ev.groupId,
      configured,
      note,
    });
  }

  // ---------- kho quyền ----------
  unusedOf(userId: string, action?: GiftAction): GiftPerk | null {
    const openStates = new Set(['unused', 'pending_steal', 'pending_queue_full']);
    return (
      this.data.perks.find(
        (p) => p.userId === userId && openStates.has(p.state) && (!action || p.action === action),
      ) ?? null
    );
  }

  take(userId: string, action: GiftAction): GiftPerk | null {
    const p = this.unusedOf(userId, action);
    if (!p) return null;
    this.data.perks = this.data.perks.filter((x) => x !== p);
    return p;
  }

  /** Quyền bảo vệ đã gắn cho một câu cụ thể (dùng khi chấm để miễn loại) */
  protectionFor(userId: string, runId: string): GiftPerk | null {
    return (
      this.data.perks.find((p) => p.userId === userId && p.action === 'protect_answer' && p.state === 'used' && p.detail === `run:${runId}`) ??
      null
    );
  }

  pendingSteals(): GiftPerk[] {
    return this.data.perks.filter((p) => p.action === 'steal_seat' && p.state === 'pending_steal');
  }

  clearUser(userId: string): number {
    const before = this.data.perks.length;
    this.data.perks = this.data.perks.filter((p) => p.userId !== userId);
    const n = before - this.data.perks.length;
    if (n) this.save();
    return n;
  }

  /** Tóm tắt công khai cho sân khấu: ảnh/tên quà -> quyền lợi từ cấu hình đang bật */
  publicRules() {
    return this.data.config
      .filter((c) => c.enabled)
      .map((c) => ({ giftId: c.giftId, name: c.name, image: c.image, action: c.action, description: c.description, unitsPerPerk: c.unitsPerPerk }));
  }
}
