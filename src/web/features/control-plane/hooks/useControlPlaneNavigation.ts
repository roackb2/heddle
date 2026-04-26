import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { isKnownControlPlanePath, pathForSection, sectionFromPath, sessionIdFromPath, type ControlPlaneSection } from '../routes';

export function useControlPlaneNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const section = sectionFromPath(location.pathname);
  const routeSessionId = useMemo(() => {
    if (section !== 'sessions') {
      return undefined;
    }
    return sessionIdFromPath(location.pathname);
  }, [location.pathname, section]);

  const setSection = useCallback((nextSection: ControlPlaneSection) => {
    navigate(pathForSection(nextSection));
  }, [navigate]);

  const setRouteSessionId = useCallback((sessionId?: string) => {
    if (!sessionId) {
      if (section === 'sessions') {
        navigate('/sessions', { replace: true });
      }
      return;
    }
    navigate(`/sessions/${encodeURIComponent(sessionId)}`);
  }, [navigate, section]);

  const normalizeRoute = useCallback(() => {
    if (location.pathname === '/' || !isKnownControlPlanePath(location.pathname)) {
      navigate('/overview', { replace: true });
    }
  }, [location.pathname, navigate]);

  return useMemo(() => ({
    section,
    routeSessionId,
    setSection,
    setRouteSessionId,
    normalizeRoute,
  }), [normalizeRoute, routeSessionId, section, setRouteSessionId, setSection]);
}
