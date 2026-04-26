import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { ControlPlaneTab } from '../mobile/MobileControlPlaneShell';
import { isKnownControlPlanePath, pathForTab, sessionIdFromPath, tabFromPath } from '../routes';

export function useControlPlaneRouting() {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = tabFromPath(location.pathname);
  const routeSessionId = useMemo(() => {
    if (tab !== 'sessions') {
      return undefined;
    }
    return sessionIdFromPath(location.pathname);
  }, [location.pathname, tab]);

  const setTab = useCallback((nextTab: ControlPlaneTab) => {
    navigate(pathForTab(nextTab));
  }, [navigate]);

  const setRouteSessionId = useCallback((sessionId?: string) => {
    if (!sessionId) {
      if (tab === 'sessions') {
        navigate('/sessions', { replace: true });
      }
      return;
    }
    navigate(`/sessions/${encodeURIComponent(sessionId)}`);
  }, [navigate, tab]);

  const normalizeRoute = useCallback(() => {
    if (location.pathname === '/' || !isKnownControlPlanePath(location.pathname)) {
      navigate('/overview', { replace: true });
    }
  }, [location.pathname, navigate]);

  return {
    tab,
    routeSessionId,
    setTab,
    setRouteSessionId,
    normalizeRoute,
  };
}
