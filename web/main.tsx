import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { StageCanvas, StageFrame, type StageState } from './StageView';
import { DashboardView } from './DashboardView';

function StagePage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const mute = params.get('mute') === '1';
  const myStageId = useMemo(() => `st_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, []);
  const [data, setData] = useState<StageState | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      es = new EventSource(`/api/stage/stream?stageId=${encodeURIComponent(myStageId)}`);
      es.addEventListener('state', (ev) => {
        try {
          setData(JSON.parse((ev as MessageEvent).data));
        } catch {}
      });
      es.onerror = () => {
        es?.close();
        if (!closed) retryTimer = setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [myStageId]);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#03050c',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <StageFrame>
        <StageCanvas data={data} myStageId={myStageId} mute={mute} />
      </StageFrame>
    </div>
  );
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const isStage = params.get('view') === 'stage';
  return isStage ? <StagePage /> : <DashboardView />;
}

createRoot(document.getElementById('root')!).render(<App />);
