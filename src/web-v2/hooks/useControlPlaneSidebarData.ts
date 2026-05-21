import { useEffect, useState } from 'react';
import { trpc, type ControlPlaneState } from '@web/api/client';

type ControlPlaneSidebarData = {
  sessions: ControlPlaneState['sessions'];
  tasks: ControlPlaneState['heartbeat']['tasks'];
};

// useControlPlaneSidebarData keeps the v2 sidebar wired to the server-owned
// control-plane view shape. Mock data should not live below this boundary.
export function useControlPlaneSidebarData(): ControlPlaneSidebarData {
  const [data, setData] = useState<ControlPlaneSidebarData>({
    sessions: [],
    tasks: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const state = await trpc.controlPlane.state.query();
      if (cancelled) {
        return;
      }

      setData({
        sessions: state.sessions,
        tasks: state.heartbeat.tasks,
      });
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
