/**
 * Bộ kết nối TikTok LIVE và tự kết nối lại.
 * Tận dụng có chọn lọc từ server.ts của lop-hoc-chu (MIT License, workaipvlinh-byte).
 * Điều chỉnh cho Ghế Nóng:
 * - Chuẩn hóa sự kiện thành InboundEvent với định danh tài khoản ổn định (userId số của TikTok,
 *   dự phòng uniqueId) và mã sự kiện msgId để chống xử lý trùng (§2, §7, §16).
 * - Báo trạng thái nguồn bình luận khỏe/mất cho GameEngine (§14).
 */
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
import type { InboundEvent } from '../core/types';

export interface TikTokStats {
  isConnected: boolean;
  isConnecting: boolean;
  username: string;
  roomId: string;
  viewerCount: number;
  totalLikes: number;
  error: string;
  simMode: boolean;
  hasSignKey?: boolean;
}

const stableUserIdOf = (data: any): string => {
  const id = data?.user?.userId || data?.userId || data?.user?.uniqueId || data?.uniqueId || '';
  return String(id).trim();
};
const nickOf = (data: any): string => data?.user?.nickname || data?.nickname || data?.user?.uniqueId || '';
const avatarOf = (data: any): string => {
  // Ưu tiên URL ảnh trình duyệt đọc được (bỏ .heic); chỉ nhận http(s)
  const list: unknown[] = [...(data?.user?.avatarThumb?.urlList ?? []), ...(data?.user?.avatarMedium?.urlList ?? [])];
  const urls = list.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
  return urls.find((u) => !/\.heic(\?|$)/i.test(u)) ?? urls[0] ?? '';
};
let fallbackSeq = 0;
const eventIdOf = (prefix: string, data: any): string => {
  const msgId = data?.common?.msgId || data?.msgId;
  return msgId ? `tt_${prefix}_${msgId}` : `tt_${prefix}_${Date.now()}_${++fallbackSeq}`;
};

export class TikTokBridge {
  stats: TikTokStats = {
    isConnected: false,
    isConnecting: false,
    username: '',
    roomId: '',
    viewerCount: 0,
    totalLikes: 0,
    error: '',
    simMode: true,
  };
  private activeConn: InstanceType<typeof TikTokLiveConnection> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTries = 0;
  private wantUser = '';
  private signApiKey = String(
    process.env.TIKTOK_SIGN_API_KEY || process.env.SIGN_API_KEY || process.env.EULER_API_KEY || '',
  ).trim();

  constructor(
    private onEvent: (ev: InboundEvent) => void,
    private onHealth: (healthy: boolean, why?: string) => void,
    private onStatsChange: (stats: TikTokStats) => void,
  ) {
    this.stats.hasSignKey = Boolean(this.signApiKey);
  }

  setSignApiKey(key: string) {
    this.signApiKey = String(key || '').trim();
    this.stats.hasSignKey = Boolean(this.signApiKey);
    this.onStatsChange(this.stats);
  }

  setSimMode(enabled: boolean) {
    this.stats.simMode = enabled;
    if (enabled && !this.stats.isConnected) {
      this.onHealth(true, 'Chế độ giả lập cục bộ');
    } else if (!enabled && !this.stats.isConnected) {
      this.onHealth(false, 'Chưa kết nối TikTok LIVE');
    }
    this.onStatsChange(this.stats);
  }

  async connect(rawUser: string): Promise<{ roomId?: string }> {
    const cleanUser = String(rawUser || '').replace(/^@/, '').trim();
    if (!cleanUser) throw new Error('Chưa nhập username TikTok');
    this.stopReconnect();
    this.wantUser = cleanUser;
    return this.connectInternal(cleanUser);
  }

  disconnect() {
    this.stopReconnect();
    this.wantUser = '';
    try {
      this.activeConn?.disconnect();
    } catch {}
    this.activeConn = null;
    this.stats = {
      ...this.stats,
      isConnected: false,
      isConnecting: false,
      username: '',
      roomId: '',
      error: '',
    };
    this.onHealth(this.stats.simMode, 'Ngắt kết nối TikTok chủ động');
    this.onStatsChange(this.stats);
  }

  private stopReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectTries = 0;
  }

  private scheduleReconnect(why: string) {
    if (!this.wantUser || this.reconnectTimer) return;
    const delay = Math.min(120_000, 15_000 * 2 ** this.reconnectTries);
    this.reconnectTries++;
    this.stats = {
      ...this.stats,
      isConnected: false,
      isConnecting: false,
      error: `${why}. Tự kết nối lại sau ${delay / 1000} giây`,
    };
    this.onHealth(this.stats.simMode, why);
    this.onStatsChange(this.stats);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectInternal(this.wantUser).catch((err) =>
        this.scheduleReconnect(`Chưa kết nối lại được (${err instanceof Error ? err.message : err})`),
      );
    }, delay);
  }

  private async connectInternal(cleanUser: string): Promise<{ roomId?: string }> {
    if (this.activeConn) {
      try {
        this.activeConn.disconnect();
      } catch {}
      this.activeConn = null;
    }
    this.stats = { ...this.stats, isConnected: false, isConnecting: true, username: cleanUser, error: '' };
    this.onStatsChange(this.stats);

    const conn = new TikTokLiveConnection(cleanUser, {
      processInitialData: true,
      enableExtendedGiftInfo: false,
      ...(this.signApiKey ? { signApiKey: this.signApiKey } : {}),
    });

    conn.on(ControlEvent.CONNECTED, (state: { roomId?: string }) => {
      this.stats = {
        ...this.stats,
        isConnected: true,
        isConnecting: false,
        roomId: state?.roomId || '',
        error: '',
      };
      this.reconnectTries = 0;
      this.onHealth(true, `Đã kết nối TikTok @${cleanUser}`);
      this.onStatsChange(this.stats);
    });

    conn.on(ControlEvent.DISCONNECTED, () => {
      if (this.activeConn !== conn) return;
      this.scheduleReconnect('Mất kết nối TikTok');
    });

    conn.on(WebcastEvent.STREAM_END, () => {
      if (this.activeConn !== conn) return;
      this.scheduleReconnect('Phiên live đã kết thúc');
    });

    conn.on(WebcastEvent.CHAT, (data: any) => {
      this.onEvent({
        source: 'tiktok',
        eventId: eventIdOf('chat', data),
        type: 'chat',
        userId: stableUserIdOf(data),
        nickname: nickOf(data),
        avatar: avatarOf(data),
        text: data?.content || data?.comment || '',
        receivedAt: Date.now(),
      });
    });

    // Chống tính lặp chuỗi quà combo (§13)
    // Khóa theo groupId (phân biệt 2 combo khác nhau), dự phòng userId+giftId khi không có groupId.
    const streakCounts = new Map<string, number>();
    conn.on(WebcastEvent.GIFT, (data: any) => {
      const userId = stableUserIdOf(data);
      // ID quà PHẢI giữ dạng chuỗi (TikTok ID có thể vượt giới hạn số an toàn)
      const giftId = String(data?.giftId ?? data?.gift?.id ?? data?.giftDetails?.giftId ?? '').trim();
      const groupId = String(data?.groupId ?? '').trim();
      const key = groupId || `${userId}_${giftId}`;
      // comboCount là tổng tích lũy (1→2→3); repeatCount là số lần trong lần gửi này
      const total = Number(data?.comboCount ?? data?.repeatCount ?? 1) || 1;
      const delta = total - (streakCounts.get(key) || 0);
      if (!data?.repeatEnd) streakCounts.set(key, total);
      else streakCounts.delete(key);
      if (delta <= 0) return;

      const giftObj = data?.gift ?? {};
      const image =
        data?.extendedGiftInfo?.image?.urlList?.[0] ||
        giftObj?.image?.urlList?.[0] ||
        giftObj?.icon?.urlList?.[0] ||
        '';

      this.onEvent({
        source: 'tiktok',
        eventId: `${eventIdOf('gift', data)}_${total}`,
        type: 'gift',
        userId,
        nickname: nickOf(data),
        avatar: avatarOf(data),
        gift: {
          name: giftObj?.name || data?.giftDetails?.giftName || data?.giftName || 'Quà',
          count: delta,
          diamonds: Number(giftObj?.diamondCount ?? data?.diamondCount ?? 1) || 1,
          giftId,
          groupId: groupId || undefined,
          image: image || undefined,
        },
        receivedAt: Date.now(),
      });
    });

    conn.on(WebcastEvent.ROOM_USER, (data: any) => {
      if (typeof data?.viewerCount === 'number') {
        this.stats.viewerCount = data.viewerCount;
        this.onStatsChange(this.stats);
      }
    });

    conn.on(WebcastEvent.LIKE, (data: any) => {
      if (typeof data?.totalLikeCount === 'number') {
        this.stats.totalLikes = data.totalLikeCount;
        this.onStatsChange(this.stats);
      }
    });

    conn.on(ControlEvent.ERROR, (err: unknown) => {
      this.stats.error = err instanceof Error ? err.message : String(err);
      this.onStatsChange(this.stats);
    });

    this.activeConn = conn;
    try {
      const live = await conn.fetchIsLive().catch(() => true);
      if (!live) throw new Error('Tài khoản này CHƯA LIVE trên TikTok');
      return await Promise.race([
        conn.connect(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Quá 25 giây không vào được phòng live')), 25_000)),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.stats = { ...this.stats, isConnected: false, isConnecting: false, error: msg };
      this.onStatsChange(this.stats);
      if (this.activeConn === conn) {
        try {
          conn.disconnect();
        } catch {}
        this.activeConn = null;
      }
      throw err;
    }
  }
}
