/**
 * Tab "Quà & Quyền lợi" của bảng điều khiển: cấu hình Gift ID -> quyền lợi (chỉ người vận hành thấy,
 * không bao giờ hiển thị trên màn hình sân khấu phát live).
 */
import React, { useState } from 'react';

type GiftAction = 'steal_seat' | 'skip_queue' | 'protect_answer';

export interface GiftsPayload {
  config: {
    giftId: string;
    name: string;
    image?: string;
    action: GiftAction;
    unitsPerPerk: number;
    enabled: boolean;
    description: string;
    updatedAt: number;
  }[];
  perks: {
    id: string;
    userId: string;
    nickname: string;
    giftName: string;
    action: GiftAction;
    state: string;
    createdAt: number;
    detail?: string;
  }[];
  recent: {
    at: number;
    eventId: string;
    userId: string;
    nickname: string;
    giftId: string;
    giftName: string;
    image?: string;
    count: number;
    configured: boolean;
    note: string;
  }[];
  progress: Record<string, number>;
}

const ACTION_LABEL: Record<GiftAction, string> = {
  skip_queue: '⚡ Vào ngay ghế chờ (ưu tiên trước hàng thường)',
  steal_seat: '👑 Cướp ghế nóng (thay người cấp thấp nhất, chơi bằng điểm của mình)',
  protect_answer: '🛡️ Bảo vệ 1 câu (sai/không trả lời vẫn giữ ghế)',
};
const ACTION_SHORT: Record<GiftAction, string> = {
  skip_queue: '⚡ Vào ngay ghế chờ',
  steal_seat: '👑 Cướp ghế nóng',
  protect_answer: '🛡️ Bảo vệ 1 câu',
};

const box: React.CSSProperties = { background: '#090d1a', border: '1px solid #1e293b', borderRadius: 10, padding: 10 };
const input: React.CSSProperties = {
  background: '#0b1224',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  padding: '6px 8px',
  fontSize: 12,
  width: '100%',
  boxSizing: 'border-box',
};
const btn = (bg: string): React.CSSProperties => ({
  background: bg,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 800,
  cursor: 'pointer',
});

export function GiftPanel({
  gifts,
  callApi,
}: {
  gifts: GiftsPayload;
  callApi: (url: string, body?: unknown) => Promise<any>;
}) {
  const [giftId, setGiftId] = useState('');
  const [name, setName] = useState('');
  const [action, setAction] = useState<GiftAction>('skip_queue');
  const [units, setUnits] = useState(1);
  const [enabled, setEnabled] = useState(true);

  const save = async () => {
    const r = await callApi('/api/admin/gifts/config', {
      giftId: giftId.trim(),
      name: name.trim(),
      action,
      unitsPerPerk: units,
      enabled,
    });
    if (r?.accepted) {
      setGiftId('');
      setName('');
      setUnits(1);
    }
  };

  const edit = (c: GiftsPayload['config'][number]) => {
    setGiftId(c.giftId);
    setName(c.name);
    setAction(c.action);
    setUnits(c.unitsPerPerk);
    setEnabled(c.enabled);
  };

  // Mỗi Gift ID chỉ liệt kê 1 lần trong "quà gần đây" (mới nhất trước)
  const seen = new Set<string>();
  const recentUnique = [...gifts.recent].reverse().filter((g) => {
    if (!g.giftId || seen.has(g.giftId)) return false;
    seen.add(g.giftId);
    return true;
  });

  return (
    <div data-testid="gift-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 420, paddingRight: 4 }}>
      <div style={{ ...box, fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>
        <b style={{ color: '#fde047' }}>Cách dùng:</b> (1) Khi live, có người tặng thử quà → quà hiện ở mục <b>"Quà vừa nhận"</b> bên dưới kèm <b>Gift ID</b>. (2) Bấm <b>"Dùng ID này"</b>, chọn quyền lợi rồi <b>Lưu</b>.
        Quà <u>chưa cấu hình</u> chỉ hiện lời cảm ơn, không ảnh hưởng điểm hay luật chơi.
      </div>

      {/* Form thêm / sửa cấu hình */}
      <div style={box}>
        <div style={{ fontWeight: 800, color: '#fde047', marginBottom: 6, fontSize: 13 }}>➕ Thêm / sửa cấu hình quà</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px', gap: 8 }}>
          <label style={{ fontSize: 11, color: '#94a3b8' }}>
            Gift ID (chuỗi số)
            <input data-testid="gift-id-input" style={input} value={giftId} onChange={(e) => setGiftId(e.target.value)} placeholder="vd: 5655" />
          </label>
          <label style={{ fontSize: 11, color: '#94a3b8' }}>
            Tên quà (để dễ nhớ)
            <input data-testid="gift-name-input" style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="vd: Hoa hồng" />
          </label>
          <label style={{ fontSize: 11, color: '#94a3b8' }}>
            Số quà / 1 quyền
            <input
              data-testid="gift-units-input"
              style={input}
              type="number"
              min={1}
              value={units}
              onChange={(e) => setUnits(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </label>
        </div>
        <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginTop: 8 }}>
          Quyền lợi
          <select data-testid="gift-action-select" style={input} value={action} onChange={(e) => setAction(e.target.value as GiftAction)}>
            {(Object.keys(ACTION_LABEL) as GiftAction[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <label style={{ fontSize: 12, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Bật quyền lợi
          </label>
          <button data-testid="gift-save" style={btn('#16a34a')} onClick={save} disabled={!giftId.trim()}>
            💾 Lưu cấu hình
          </button>
        </div>
      </div>

      {/* Quà vừa nhận từ phòng live */}
      <div style={box}>
        <div style={{ fontWeight: 800, color: '#67e8f9', marginBottom: 6, fontSize: 13 }}>🎁 Quà vừa nhận (lấy Gift ID tại đây)</div>
        {recentUnique.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>Chưa nhận quà nào. Hãy nhờ người xem (hoặc tài khoản phụ) tặng thử 1 quà khi đang kết nối TikTok.</div>
        ) : (
          recentUnique.slice(0, 12).map((g) => (
            <div key={g.giftId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #1e293b', fontSize: 12 }}>
              {g.image ? <img src={g.image} alt="" referrerPolicy="no-referrer" style={{ width: 24, height: 24, borderRadius: 4 }} /> : <span>🎁</span>}
              <span style={{ flex: 1, minWidth: 0, color: '#e2e8f0' }}>
                <b>{g.giftName}</b> · ID <code style={{ color: '#fde047' }}>{g.giftId}</code> · {g.nickname} ×{g.count}
                <span style={{ color: g.configured ? '#34d399' : '#94a3b8' }}> — {g.configured ? 'đã cấu hình' : 'chưa cấu hình'}</span>
              </span>
              <button
                style={btn('#2563eb')}
                onClick={() => {
                  setGiftId(g.giftId);
                  setName(g.giftName);
                }}
              >
                Dùng ID này
              </button>
            </div>
          ))
        )}
      </div>

      {/* Danh sách đã cấu hình */}
      <div style={box}>
        <div style={{ fontWeight: 800, color: '#a7f3d0', marginBottom: 6, fontSize: 13 }}>⚙️ Quà đã cấu hình ({gifts.config.length})</div>
        {gifts.config.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>Chưa cấu hình quà nào → mọi quà chỉ hiện lời cảm ơn (đúng luật v1.0).</div>
        ) : (
          gifts.config.map((c) => (
            <div key={c.giftId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #1e293b', fontSize: 12 }}>
              <span style={{ flex: 1, minWidth: 0, color: c.enabled ? '#e2e8f0' : '#64748b' }}>
                <b>{c.name}</b> (ID <code style={{ color: '#fde047' }}>{c.giftId}</code>) → {ACTION_SHORT[c.action]} · {c.unitsPerPerk} quà/quyền
                {c.enabled ? '' : ' · ĐANG TẮT'}
              </span>
              <button style={btn('#475569')} onClick={() => edit(c)}>
                Sửa
              </button>
              <button
                style={btn(c.enabled ? '#b45309' : '#16a34a')}
                onClick={() => callApi('/api/admin/gifts/config', { ...c, enabled: !c.enabled })}
              >
                {c.enabled ? 'Tắt' : 'Bật'}
              </button>
              <button style={btn('#dc2626')} onClick={() => callApi('/api/admin/gifts/config/remove', { giftId: c.giftId })}>
                Xóa
              </button>
            </div>
          ))
        )}
      </div>

      {/* Quyền đang giữ */}
      <div style={box}>
        <div style={{ fontWeight: 800, color: '#fdba74', marginBottom: 6, fontSize: 13 }}>🎟️ Quyền đã cấp gần đây ({gifts.perks.length})</div>
        {gifts.perks.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>Chưa có quyền nào được cấp.</div>
        ) : (
          [...gifts.perks].reverse().slice(0, 10).map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', borderBottom: '1px solid #1e293b', fontSize: 12 }}>
              <span style={{ flex: 1, color: '#e2e8f0' }}>
                <b>{p.nickname}</b> — {ACTION_SHORT[p.action]} · <span style={{ color: '#fde047' }}>{p.state}</span>
                {p.detail ? <span style={{ color: '#94a3b8' }}> · {p.detail}</span> : null}
              </span>
              <button style={btn('#475569')} onClick={() => callApi('/api/admin/gifts/perks/clear', { userId: p.userId })}>
                Thu hồi
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
